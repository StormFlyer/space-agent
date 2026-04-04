import fs from "node:fs";

import { createHttpError, getAppFolderDownloadInfo } from "../lib/customware/file_access.js";
import {
  createArchiveReadStream,
  createAttachmentDisposition,
  createDirectoryZipArchive
} from "../lib/tmp/archive_create.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

function readPath(context) {
  const payload = readPayload(context);
  return String(payload.path || context.params.path || "");
}

function resolveFolderInfo(context) {
  return getAppFolderDownloadInfo({
    path: readPath(context),
    projectRoot: context.projectRoot,
    runtimeParams: context.runtimeParams,
    username: context.user?.username,
    watchdog: context.watchdog
  });
}

async function handleDownload(context) {
  try {
    const folderInfo = resolveFolderInfo(context);
    const archiveInfo = await createDirectoryZipArchive({
      archiveBaseName: folderInfo.directoryName,
      downloadFilename: `${folderInfo.directoryName}.zip`,
      sourceAbsolutePath: folderInfo.absolutePath
    });
    const archiveStats = fs.statSync(archiveInfo.archivePath);

    return {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": createAttachmentDisposition(archiveInfo.downloadFilename),
        "Content-Length": String(archiveStats.size),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff"
      },
      stream: createArchiveReadStream(archiveInfo.archivePath)
    };
  } catch (error) {
    throw createHttpError(error.message || "Folder download failed.", Number(error.statusCode) || 500);
  }
}

export function head(context) {
  try {
    resolveFolderInfo(context);
    return {
      status: 204,
      headers: {
        "Cache-Control": "no-store"
      }
    };
  } catch (error) {
    throw createHttpError(error.message || "Folder download validation failed.", Number(error.statusCode) || 500);
  }
}

export function get(context) {
  return handleDownload(context);
}

export function post(context) {
  return handleDownload(context);
}
