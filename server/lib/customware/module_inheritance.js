import path from "node:path";

import { isProjectPathWithinMaxLayer } from "./layer_limit.js";
import { normalizeModuleRequestPath, parseProjectModuleFilePath } from "./layout.js";
import { createEmptyGroupIndex, filterAccessibleModulePaths } from "./overrides.js";

function findCandidateModuleProjectPaths(watchdog, requestPath, maxLayer) {
  const filePaths = watchdog && typeof watchdog.getPaths === "function" ? watchdog.getPaths() : [];

  return filePaths.filter((projectPath) => {
    if (!isProjectPathWithinMaxLayer(projectPath, maxLayer)) {
      return false;
    }

    const modulePathInfo = parseProjectModuleFilePath(projectPath);
    return Boolean(modulePathInfo && modulePathInfo.requestPath === requestPath);
  });
}

function resolveInheritedModuleProjectPath({
  maxLayer,
  projectRoot,
  requestPath,
  username,
  watchdog
}) {
  const normalizedRequestPath = normalizeModuleRequestPath(requestPath);

  if (!normalizedRequestPath || !watchdog) {
    return null;
  }

  const groupIndex =
    typeof watchdog.getIndex === "function"
      ? watchdog.getIndex("group_index")
      : createEmptyGroupIndex();
  const candidatePaths = findCandidateModuleProjectPaths(watchdog, normalizedRequestPath, maxLayer);
  const accessiblePaths = filterAccessibleModulePaths(candidatePaths, username, groupIndex, {
    maxLayer
  });
  const selectedProjectPath = accessiblePaths.length > 0 ? accessiblePaths[accessiblePaths.length - 1] : "";

  if (!selectedProjectPath) {
    return null;
  }

  return {
    absolutePath: path.join(projectRoot, selectedProjectPath.slice(1)),
    candidatePaths,
    projectPath: selectedProjectPath,
    requestPath: normalizedRequestPath
  };
}

export {
  createEmptyGroupIndex,
  findCandidateModuleProjectPaths,
  filterAccessibleModulePaths,
  resolveInheritedModuleProjectPath
};
