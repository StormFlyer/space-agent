import fs from "node:fs";
import path from "node:path";

import { normalizeAppProjectPath, normalizeEntityId, parseAppProjectPath } from "./layout.js";
import { createEmptyGroupIndex } from "./overrides.js";
import { globToRegExp, normalizePathSegment } from "../utils/app_files.js";

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function stripTrailingSlash(value) {
  const text = String(value || "");
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function resolveUserShorthandPath(inputPath, username) {
  const rawPath = String(inputPath || "").trim();

  if (!rawPath.startsWith("~")) {
    return rawPath;
  }

  if (!username) {
    throw createHttpError("User-relative paths require an authenticated user.", 400);
  }

  if (rawPath === "~") {
    return `L2/${username}/`;
  }

  if (rawPath.startsWith("~/")) {
    return `L2/${username}/${rawPath.slice(2)}`;
  }

  throw createHttpError(`Invalid user-relative path: ${rawPath}`, 400);
}

function toAppRelativePath(projectPath) {
  const normalizedProjectPath = normalizeAppProjectPath(projectPath, {
    allowAppRoot: true,
    isDirectory: String(projectPath || "").endsWith("/")
  });

  if (!normalizedProjectPath.startsWith("/app/")) {
    return "";
  }

  return normalizedProjectPath.slice("/app/".length);
}

function getGroupIndex(watchdog) {
  if (!watchdog || typeof watchdog.getIndex !== "function") {
    return createEmptyGroupIndex();
  }

  return watchdog.getIndex("group_index") || createEmptyGroupIndex();
}

function getPathIndex(watchdog) {
  if (!watchdog || typeof watchdog.getIndex !== "function") {
    return Object.create(null);
  }

  return watchdog.getIndex("path_index") || Object.create(null);
}

function getSortedProjectPaths(watchdog) {
  if (watchdog && typeof watchdog.getPaths === "function") {
    return watchdog.getPaths();
  }

  return Object.keys(getPathIndex(watchdog)).sort((left, right) => left.localeCompare(right));
}

function hasPath(pathIndex, projectPath) {
  return Boolean(pathIndex && projectPath && pathIndex[projectPath]);
}

function normalizeFilePathPattern(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    throw createHttpError("File pattern must not be empty.", 400);
  }

  try {
    const normalizedPattern = normalizePathSegment(rawValue);

    if (!normalizedPattern) {
      throw new Error("Empty file pattern.");
    }

    return normalizedPattern;
  } catch {
    throw createHttpError(`Invalid file pattern: ${rawValue}`, 400);
  }
}

function compileFilePathPatterns(patterns) {
  const compiledPatterns = [];
  const seenPatterns = new Set();

  for (const value of Array.isArray(patterns) ? patterns : []) {
    const sourcePattern = String(value ?? "").trim();
    const normalizedPattern = normalizeFilePathPattern(sourcePattern);

    if (seenPatterns.has(sourcePattern)) {
      continue;
    }

    seenPatterns.add(sourcePattern);
    compiledPatterns.push({
      matcher: globToRegExp(normalizedPattern),
      sourcePattern
    });
  }

  return compiledPatterns;
}

function listReadableGroupIds(username, groupIndex) {
  const normalizedUsername = normalizeEntityId(username);
  const orderedGroups =
    groupIndex && typeof groupIndex.getOrderedGroupsForUser === "function"
      ? groupIndex.getOrderedGroupsForUser(normalizedUsername)
      : [];
  const groupIds = [];

  if (
    groupIndex &&
    typeof groupIndex.isUserInGroup === "function" &&
    groupIndex.isUserInGroup(normalizedUsername, "_all")
  ) {
    groupIds.push("_all");
  }

  for (const groupId of orderedGroups) {
    if (groupId && groupId !== "_all") {
      groupIds.push(groupId);
    }
  }

  return groupIds;
}

function createReadableOwnerScopes(options = {}) {
  const normalizedUsername = normalizeEntityId(options.username);
  const groupIds = listReadableGroupIds(normalizedUsername, options.groupIndex || createEmptyGroupIndex());
  const ownerScopes = [];
  let rank = 0;

  for (const groupId of groupIds) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L0/${groupId}/`
    });
    rank += 1;
  }

  for (const groupId of groupIds) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L1/${groupId}/`
    });
    rank += 1;
  }

  if (normalizedUsername) {
    ownerScopes.push({
      rank,
      rootPath: `/app/L2/${normalizedUsername}/`
    });
  }

  return ownerScopes;
}

function findOwnerScope(projectPath, ownerScopes) {
  return ownerScopes.find((ownerScope) => projectPath.startsWith(ownerScope.rootPath)) || null;
}

function createAppAccessController(options = {}) {
  const groupIndex = options.groupIndex || createEmptyGroupIndex();
  const username = normalizeEntityId(options.username);
  const managedGroups = new Set(
    groupIndex && typeof groupIndex.getManagedGroupsForUser === "function"
      ? groupIndex.getManagedGroupsForUser(username)
      : []
  );
  const isAdmin = Boolean(
    username &&
      groupIndex &&
      typeof groupIndex.isUserInGroup === "function" &&
      groupIndex.isUserInGroup(username, "_admin")
  );

  function canReadProjectPath(projectPath) {
    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    if (pathInfo.ownerType === "user") {
      return Boolean(username && pathInfo.ownerId === username);
    }

    return Boolean(
      groupIndex &&
        typeof groupIndex.isUserInGroup === "function" &&
        groupIndex.isUserInGroup(username, pathInfo.ownerId)
    );
  }

  function canWriteProjectPath(projectPath) {
    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    if (pathInfo.layer === "L0") {
      return false;
    }

    if (isAdmin && (pathInfo.layer === "L1" || pathInfo.layer === "L2")) {
      return true;
    }

    if (pathInfo.ownerType === "user") {
      return Boolean(pathInfo.layer === "L2" && username && pathInfo.ownerId === username);
    }

    return Boolean(pathInfo.layer === "L1" && managedGroups.has(pathInfo.ownerId));
  }

  return {
    canReadProjectPath,
    canWriteProjectPath,
    isAdmin,
    managedGroups,
    username
  };
}

function ensureReadableProjectPath(projectPath, accessController) {
  if (!accessController.canReadProjectPath(projectPath)) {
    throw createHttpError("Read access denied.", 403);
  }
}

function ensureWritableProjectPath(projectPath, accessController) {
  if (!accessController.canWriteProjectPath(projectPath)) {
    throw createHttpError("Write access denied.", 403);
  }
}

function resolveExistingProjectPath(pathIndex, inputPath) {
  const rawInput = String(inputPath || "").trim();
  const fileProjectPath = normalizeAppProjectPath(rawInput);
  const directoryProjectPath = normalizeAppProjectPath(rawInput, {
    allowAppRoot: true,
    isDirectory: true
  });
  const prefersDirectory = rawInput.endsWith("/");

  if (prefersDirectory && directoryProjectPath && hasPath(pathIndex, directoryProjectPath)) {
    return {
      exists: true,
      isDirectory: true,
      projectPath: directoryProjectPath
    };
  }

  if (fileProjectPath && hasPath(pathIndex, fileProjectPath)) {
    return {
      exists: true,
      isDirectory: false,
      projectPath: fileProjectPath
    };
  }

  if (directoryProjectPath && hasPath(pathIndex, directoryProjectPath)) {
    return {
      exists: true,
      isDirectory: true,
      projectPath: directoryProjectPath
    };
  }

  return {
    exists: false,
    isDirectory: prefersDirectory,
    projectPath: prefersDirectory ? directoryProjectPath : fileProjectPath
  };
}

function createAbsolutePath(projectRoot, projectPath) {
  return path.join(projectRoot, stripTrailingSlash(String(projectPath || "").slice(1)));
}

function ensureValidReadEncoding(encoding) {
  if (encoding === "utf8" || encoding === "base64") {
    return encoding;
  }

  throw createHttpError(`Unsupported read encoding: ${String(encoding || "")}`, 400);
}

function ensureValidWriteEncoding(encoding) {
  if (encoding === "utf8" || encoding === "base64") {
    return encoding;
  }

  throw createHttpError(`Unsupported write encoding: ${String(encoding || "")}`, 400);
}

function readAppFile(options = {}) {
  const projectRoot = String(options.projectRoot || "");
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog),
    username: options.username
  });
  const resolvedPath = resolveExistingProjectPath(
    pathIndex,
    resolveUserShorthandPath(options.path, accessController.username)
  );

  if (!resolvedPath.projectPath || !resolvedPath.exists) {
    throw createHttpError("File not found.", 404);
  }

  if (resolvedPath.isDirectory) {
    throw createHttpError("Expected a file path.", 400);
  }

  ensureReadableProjectPath(resolvedPath.projectPath, accessController);

  const encoding = ensureValidReadEncoding(String(options.encoding || "utf8").toLowerCase());
  const buffer = fs.readFileSync(createAbsolutePath(projectRoot, resolvedPath.projectPath));

  return {
    content: encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8"),
    encoding,
    path: toAppRelativePath(resolvedPath.projectPath)
  };
}

function writeAppFile(options = {}) {
  const projectRoot = String(options.projectRoot || "");
  const normalizedProjectPath = normalizeAppProjectPath(
    resolveUserShorthandPath(options.path, normalizeEntityId(options.username))
  );

  if (!normalizedProjectPath || normalizedProjectPath.endsWith("/")) {
    throw createHttpError("Expected a writable file path.", 400);
  }

  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog),
    username: options.username
  });

  ensureWritableProjectPath(normalizedProjectPath, accessController);

  const encoding = ensureValidWriteEncoding(String(options.encoding || "utf8").toLowerCase());
  const content = options.content;
  const absolutePath = createAbsolutePath(projectRoot, normalizedProjectPath);
  const buffer =
    encoding === "base64"
      ? Buffer.from(String(content || ""), "base64")
      : Buffer.from(String(content ?? ""), "utf8");

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);

  return {
    bytesWritten: buffer.length,
    encoding,
    path: toAppRelativePath(normalizedProjectPath)
  };
}

function isDescendantPath(ancestorDirectoryPath, candidatePath) {
  const ancestorBase = stripTrailingSlash(ancestorDirectoryPath);
  const candidateBase = stripTrailingSlash(candidatePath);

  return Boolean(
    ancestorBase &&
      candidateBase &&
      candidateBase !== ancestorBase &&
      candidateBase.startsWith(`${ancestorBase}/`)
  );
}

function getDirectChildPath(directoryPath, descendantPath, pathIndex) {
  const directorySegments = stripTrailingSlash(directoryPath).split("/").filter(Boolean);
  const descendantSegments = stripTrailingSlash(descendantPath).split("/").filter(Boolean);

  if (descendantSegments.length <= directorySegments.length) {
    return "";
  }

  const childBasePath = `/${descendantSegments.slice(0, directorySegments.length + 1).join("/")}`;
  const childDirectoryPath = `${childBasePath}/`;

  return hasPath(pathIndex, childDirectoryPath) ? childDirectoryPath : childBasePath;
}

function collectAncestorDirectories(targetDirectoryPath, descendantPath, pathIndex) {
  const targetSegments = stripTrailingSlash(targetDirectoryPath).split("/").filter(Boolean);
  const descendantSegments = stripTrailingSlash(descendantPath).split("/").filter(Boolean);
  const output = [];

  for (let length = targetSegments.length + 1; length < descendantSegments.length; length += 1) {
    const candidatePath = `/${descendantSegments.slice(0, length).join("/")}/`;

    if (hasPath(pathIndex, candidatePath)) {
      output.push(candidatePath);
    }
  }

  return output;
}

function listAppPaths(options = {}) {
  const pathIndex = getPathIndex(options.watchdog);
  const accessController = createAppAccessController({
    groupIndex: getGroupIndex(options.watchdog),
    username: options.username
  });
  const resolvedPath = resolveExistingProjectPath(
    pathIndex,
    resolveUserShorthandPath(options.path || "/app/", accessController.username)
  );

  if (!resolvedPath.projectPath || !resolvedPath.exists) {
    throw createHttpError("Path not found.", 404);
  }

  if (!resolvedPath.isDirectory) {
    ensureReadableProjectPath(resolvedPath.projectPath, accessController);

    return {
      path: toAppRelativePath(resolvedPath.projectPath),
      paths: [toAppRelativePath(resolvedPath.projectPath)],
      recursive: false
    };
  }

  const targetPathInfo = parseAppProjectPath(resolvedPath.projectPath);

  if (targetPathInfo && targetPathInfo.kind === "owner-path") {
    ensureReadableProjectPath(resolvedPath.projectPath, accessController);
  }

  const recursive = Boolean(options.recursive);
  const allPaths = Object.keys(pathIndex).sort((left, right) => left.localeCompare(right));
  const accessibleDescendants = allPaths.filter((projectPath) => {
    if (!isDescendantPath(resolvedPath.projectPath, projectPath)) {
      return false;
    }

    const pathInfo = parseAppProjectPath(projectPath);

    if (!pathInfo || pathInfo.kind !== "owner-path") {
      return false;
    }

    return accessController.canReadProjectPath(projectPath);
  });
  const outputPaths = new Set();

  if (recursive) {
    for (const projectPath of accessibleDescendants) {
      outputPaths.add(projectPath);

      for (const ancestorPath of collectAncestorDirectories(resolvedPath.projectPath, projectPath, pathIndex)) {
        outputPaths.add(ancestorPath);
      }
    }
  } else {
    for (const projectPath of accessibleDescendants) {
      const directChildPath = getDirectChildPath(resolvedPath.projectPath, projectPath, pathIndex);

      if (directChildPath) {
        outputPaths.add(directChildPath);
      }
    }
  }

  return {
    path: toAppRelativePath(resolvedPath.projectPath),
    paths: [...outputPaths]
      .sort((left, right) => left.localeCompare(right))
      .map((projectPath) => toAppRelativePath(projectPath)),
    recursive
  };
}

function listAppPathsByPatterns(options = {}) {
  const compiledPatterns = compileFilePathPatterns(options.patterns);
  const output = Object.create(null);

  for (const { sourcePattern } of compiledPatterns) {
    output[sourcePattern] = [];
  }

  if (compiledPatterns.length === 0) {
    return output;
  }

  const ownerScopes = createReadableOwnerScopes({
    groupIndex: getGroupIndex(options.watchdog),
    username: options.username
  });

  if (ownerScopes.length === 0) {
    return output;
  }

  const pathBuckets = new Map();

  for (const projectPath of getSortedProjectPaths(options.watchdog)) {
    const ownerScope = findOwnerScope(projectPath, ownerScopes);

    if (!ownerScope) {
      continue;
    }

    const relativePath = projectPath.slice(ownerScope.rootPath.length);

    if (!relativePath) {
      continue;
    }

    if (!pathBuckets.has(ownerScope.rank)) {
      pathBuckets.set(ownerScope.rank, []);
    }

    pathBuckets.get(ownerScope.rank).push({
      projectPath,
      relativePath
    });
  }

  for (const ownerScope of ownerScopes) {
    const pathEntries = pathBuckets.get(ownerScope.rank) || [];

    for (const pathEntry of pathEntries) {
      const appRelativePath = toAppRelativePath(pathEntry.projectPath);

      for (const compiledPattern of compiledPatterns) {
        if (compiledPattern.matcher.test(pathEntry.relativePath)) {
          output[compiledPattern.sourcePattern].push(appRelativePath);
        }
      }
    }
  }

  return output;
}

export {
  createAppAccessController,
  createHttpError,
  listAppPaths,
  listAppPathsByPatterns,
  readAppFile,
  toAppRelativePath,
  writeAppFile
};
