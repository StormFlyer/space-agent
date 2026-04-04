import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

import { SERVER_TMP_DIR } from "../../config.js";
import { ensureServerTmpDir } from "./tmp_watch.js";

function createArchiveError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeArchiveBaseName(value) {
  const candidate = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || "download";
}

function createAsciiFilename(value) {
  const candidate = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return candidate || "download.zip";
}

function ensureZipFilename(value) {
  const candidate = String(value || "").trim() || "download";
  return candidate.toLowerCase().endsWith(".zip") ? candidate : `${candidate}.zip`;
}

function createArchiveToken() {
  return `${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function createArchivePath(baseName, options = {}) {
  const tmpDir = ensureServerTmpDir(options.tmpDir || SERVER_TMP_DIR);
  return path.join(tmpDir, `${sanitizeArchiveBaseName(baseName)}-${createArchiveToken()}.zip`);
}

function removeArchiveQuietly(archivePath) {
  fs.rm(archivePath, { force: true }, () => {});
}

function createArchiveFailureMessage(stderrText, code, signal) {
  const detail = String(stderrText || "").trim();

  if (detail) {
    return `ZIP archive creation failed: ${detail}`;
  }

  if (signal) {
    return `ZIP archive creation was interrupted by signal ${signal}.`;
  }

  return `ZIP archive creation failed with exit code ${code}.`;
}

function runZipProcess(options = {}) {
  const archivePath = String(options.archivePath || "");
  const sourceName = String(options.sourceName || "");
  const workingDirectory = String(options.workingDirectory || "");

  return new Promise((resolve, reject) => {
    const zipProcess = spawn("zip", ["-r", "-q", "-1", "-y", archivePath, sourceName], {
      cwd: workingDirectory,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderrText = "";

    zipProcess.stderr.on("data", (chunk) => {
      if (stderrText.length >= 8192) {
        return;
      }

      stderrText += String(chunk);
    });

    zipProcess.once("error", (error) => {
      removeArchiveQuietly(archivePath);
      reject(createArchiveError(`ZIP archiver is not available on this host: ${error.message}`));
    });

    zipProcess.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      removeArchiveQuietly(archivePath);
      reject(createArchiveError(createArchiveFailureMessage(stderrText, code, signal)));
    });
  });
}

function createDirectoryZipArchive(options = {}) {
  const sourceAbsolutePath = path.resolve(String(options.sourceAbsolutePath || ""));

  if (!sourceAbsolutePath) {
    throw createArchiveError("Folder archive source path must not be empty.", 400);
  }

  let stats;

  try {
    stats = fs.statSync(sourceAbsolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createArchiveError("Folder archive source path was not found.", 404);
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    throw createArchiveError("Folder archive source path must be a directory.", 400);
  }

  const sourceName = path.basename(sourceAbsolutePath);
  const archivePath = createArchivePath(options.archiveBaseName || sourceName, options);

  return runZipProcess({
    archivePath,
    sourceName,
    workingDirectory: path.dirname(sourceAbsolutePath)
  }).then(() => ({
    archivePath,
    downloadFilename: ensureZipFilename(options.downloadFilename || sourceName)
  }));
}

function createArchiveReadStream(archivePath) {
  const stream = fs.createReadStream(archivePath);
  let cleaned = false;

  function cleanup() {
    if (cleaned) {
      return;
    }

    cleaned = true;
    removeArchiveQuietly(archivePath);
  }

  stream.once("close", cleanup);
  stream.once("error", cleanup);
  return stream;
}

function createAttachmentDisposition(filename) {
  const normalizedFilename = ensureZipFilename(filename);
  const asciiFilename = createAsciiFilename(normalizedFilename);
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(normalizedFilename)}`;
}

export {
  createArchiveReadStream,
  createAttachmentDisposition,
  createDirectoryZipArchive
};
