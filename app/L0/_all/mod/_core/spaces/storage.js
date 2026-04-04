import {
  SPACE_ASSETS_DIR,
  SPACE_DATA_DIR,
  SPACE_MANIFEST_FILE,
  SPACE_WIDGETS_DIR,
  SPACES_ROOT_PATH,
  SPACES_SCHEMA
} from "/mod/_core/spaces/constants.js";
import {
  normalizeWidgetPosition,
  positionToToken,
  resolveSpaceLayout
} from "/mod/_core/spaces/layout.js";
import {
  DEFAULT_WIDGET_SIZE,
  normalizeWidgetSize,
  sizeToToken
} from "/mod/_core/spaces/widget-sdk-core.js";

function ensureSpaceRuntime() {
  if (!globalThis.space || !globalThis.space.api || !globalThis.space.utils?.yaml) {
    throw new Error("Spaces runtime requires the authenticated Space browser runtime.");
  }

  return globalThis.space;
}

function isNotFoundError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("status 404") || message.includes("file not found") || message.includes("path not found");
}

function slugifySegment(value, fallback = "item") {
  const normalizedValue = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
  const slug = normalizedValue
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || fallback;
}

function normalizeOptionalSpaceId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeSpaceId(rawValue) : "";
}

function normalizeOptionalWidgetId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeWidgetId(rawValue) : "";
}

function formatTitleFromId(id) {
  return String(id || "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function uniqueList(values) {
  return [...new Set(values)];
}

const JSON_STRING_LITERAL_PATTERN = '"(?:\\\\.|[^"\\\\])*"';

function parseManifestSpaceId(path) {
  const match = String(path || "").match(/\/spaces\/([^/]+)\/space\.yaml$/u);
  return match ? match[1] : "";
}

function normalizeWidgetMap(source, parser = (value) => value) {
  const entries = source && typeof source === "object" && !Array.isArray(source) ? Object.entries(source) : [];
  const output = {};

  entries.forEach(([key, value]) => {
    const normalizedKey = normalizeOptionalWidgetId(key);

    if (!normalizedKey) {
      return;
    }

    output[normalizedKey] = parser(value);
  });

  return output;
}

function pickWidgetMap(source, widgetIds) {
  const widgetIdSet = new Set(Array.isArray(widgetIds) ? widgetIds : []);
  const output = {};

  Object.entries(source || {}).forEach(([widgetId, value]) => {
    if (!widgetIdSet.has(widgetId)) {
      return;
    }

    output[widgetId] = value;
  });

  return output;
}

function normalizeWidgetIdList(values) {
  const rawValues = Array.isArray(values) ? values : typeof values === "string" && values ? [values] : [];
  return uniqueList(
    rawValues
      .map((value) => normalizeOptionalWidgetId(value))
      .filter(Boolean)
  );
}

function cloneSpaceRecord(spaceRecord) {
  return {
    ...spaceRecord,
    widgetIds: [...spaceRecord.widgetIds],
    minimizedWidgetIds: [...spaceRecord.minimizedWidgetIds],
    widgetPositions: { ...spaceRecord.widgetPositions },
    widgetSizes: { ...spaceRecord.widgetSizes },
    widgetTitles: { ...spaceRecord.widgetTitles }
  };
}

function formatSpaceListEntry(spaceRecord) {
  return {
    ...spaceRecord,
    updatedAtLabel: spaceRecord.updatedAt ? new Date(spaceRecord.updatedAt).toLocaleString() : "Unknown update time",
    widgetCount: spaceRecord.widgetIds.length,
    widgetCountLabel: `${spaceRecord.widgetIds.length} ${spaceRecord.widgetIds.length === 1 ? "widget" : "widgets"}`
  };
}

function normalizeManifest(rawManifest, fallbackId = "") {
  const now = new Date().toISOString();
  const id = normalizeSpaceId(rawManifest?.id || fallbackId || rawManifest?.title || `space-${Date.now().toString(36)}`);
  const widgetIds = normalizeWidgetIdList(rawManifest?.widgets ?? rawManifest?.widgetIds);
  const minimizedWidgetIds = normalizeWidgetIdList(
    rawManifest?.minimized ?? rawManifest?.collapsed ?? rawManifest?.minimizedWidgetIds
  ).filter((widgetId) => widgetIds.includes(widgetId));
  const widgetPositions = pickWidgetMap(
    normalizeWidgetMap(rawManifest?.positions ?? rawManifest?.widgetPositions, (value) =>
      normalizeWidgetPosition(value, { col: 0, row: 0 })
    ),
    widgetIds
  );
  const widgetSizes = pickWidgetMap(
    normalizeWidgetMap(rawManifest?.sizes ?? rawManifest?.widgetSizes, (value) => normalizeWidgetSize(value, DEFAULT_WIDGET_SIZE)),
    widgetIds
  );
  const widgetTitles = pickWidgetMap(
    normalizeWidgetMap(rawManifest?.titles ?? rawManifest?.widgetTitles, (value) => String(value || "").trim()),
    widgetIds
  );

  return {
    createdAt: String(rawManifest?.created_at || rawManifest?.createdAt || now),
    id,
    manifestPath: buildSpaceManifestPath(id),
    minimizedWidgetIds,
    path: buildSpaceRootPath(id),
    schema: String(rawManifest?.schema || SPACES_SCHEMA),
    title: String(rawManifest?.title || formatTitleFromId(id) || "Untitled Space"),
    updatedAt: String(rawManifest?.updated_at || rawManifest?.updatedAt || now),
    widgetIds,
    widgetPositions,
    widgetSizes,
    widgetTitles,
    widgetsPath: buildSpaceWidgetsPath(id)
  };
}

function serializeManifest(spaceRecord) {
  const runtime = ensureSpaceRuntime();
  const yamlSource = {
    created_at: spaceRecord.createdAt,
    id: spaceRecord.id,
    schema: SPACES_SCHEMA,
    title: spaceRecord.title,
    updated_at: spaceRecord.updatedAt,
    widgets: [...spaceRecord.widgetIds]
  };

  const sizeEntries = spaceRecord.widgetIds
    .filter((widgetId) => spaceRecord.widgetSizes[widgetId])
    .map((widgetId) => [widgetId, sizeToToken(spaceRecord.widgetSizes[widgetId])]);

  if (sizeEntries.length) {
    yamlSource.sizes = Object.fromEntries(sizeEntries);
  }

  const positionEntries = spaceRecord.widgetIds
    .filter((widgetId) => spaceRecord.widgetPositions[widgetId])
    .map((widgetId) => [widgetId, positionToToken(spaceRecord.widgetPositions[widgetId])]);

  if (positionEntries.length) {
    yamlSource.positions = Object.fromEntries(positionEntries);
  }

  const minimizedWidgetIds = normalizeWidgetIdList(spaceRecord.minimizedWidgetIds);

  if (minimizedWidgetIds.length) {
    yamlSource.minimized = minimizedWidgetIds;
  }

  const titleEntries = spaceRecord.widgetIds
    .filter((widgetId) => spaceRecord.widgetTitles[widgetId])
    .map((widgetId) => [widgetId, spaceRecord.widgetTitles[widgetId]]);

  if (titleEntries.length) {
    yamlSource.titles = Object.fromEntries(titleEntries);
  }

  return runtime.utils.yaml.serialize(yamlSource);
}

async function readManifestFile(spaceId) {
  const runtime = ensureSpaceRuntime();
  const response = await runtime.api.fileRead(buildSpaceManifestPath(spaceId));
  const parsed = runtime.utils.yaml.parse(String(response?.content || ""));
  return normalizeManifest(parsed, spaceId);
}

async function writeManifestFile(spaceRecord) {
  const runtime = ensureSpaceRuntime();
  const normalizedRecord = normalizeManifest(spaceRecord, spaceRecord?.id);

  await runtime.api.fileWrite({
    content: serializeManifest(normalizedRecord),
    path: buildSpaceManifestPath(normalizedRecord.id)
  });

  return normalizedRecord;
}

async function spaceExists(spaceId) {
  const runtime = ensureSpaceRuntime();

  try {
    await runtime.api.fileInfo(buildSpaceManifestPath(spaceId));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function createUniqueSpaceId(baseId) {
  const normalizedBaseId = normalizeSpaceId(baseId, "space");
  let nextId = normalizedBaseId;
  let suffix = 2;

  while (await spaceExists(nextId)) {
    nextId = `${normalizedBaseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

export function normalizeSpaceId(value, fallback = "space") {
  const fallbackId = slugifySegment(fallback, "space");
  return slugifySegment(value, fallbackId);
}

export function normalizeWidgetId(value, fallback = "widget") {
  return slugifySegment(value, fallback);
}

export function buildSpaceRootPath(spaceId) {
  const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

  if (!normalizedSpaceId) {
    throw new Error("A spaceId is required.");
  }

  return `${SPACES_ROOT_PATH}${normalizedSpaceId}/`;
}

export function buildSpaceManifestPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_MANIFEST_FILE}`;
}

export function buildSpaceWidgetsPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_WIDGETS_DIR}`;
}

export function buildSpaceWidgetFilePath(spaceId, widgetId) {
  const normalizedWidgetId = normalizeOptionalWidgetId(widgetId);

  if (!normalizedWidgetId) {
    throw new Error("A widgetId is required.");
  }

  return `${buildSpaceWidgetsPath(spaceId)}${normalizedWidgetId}.js`;
}

export function buildSpaceDataPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_DATA_DIR}`;
}

export function buildSpaceAssetsPath(spaceId) {
  return `${buildSpaceRootPath(spaceId)}${SPACE_ASSETS_DIR}`;
}

export function resolveAppUrl(path) {
  const normalizedPath = String(path || "").trim();

  if (!normalizedPath) {
    throw new Error("A logical app path is required.");
  }

  if (normalizedPath === "~") {
    return "/~/";
  }

  if (normalizedPath.startsWith("~/")) {
    return `/${normalizedPath}`;
  }

  if (normalizedPath.startsWith("/app/")) {
    return resolveAppUrl(normalizedPath.slice("/app/".length));
  }

  if (normalizedPath.startsWith("/~/")) {
    return normalizedPath;
  }

  if (/^\/(L0|L1|L2)\//u.test(normalizedPath)) {
    return normalizedPath;
  }

  if (/^(L0|L1|L2)\//u.test(normalizedPath)) {
    return `/${normalizedPath}`;
  }

  throw new Error(`Unsupported app path "${normalizedPath}".`);
}

export function buildSpaceWidgetModuleUrl(spaceId, widgetId, cacheToken = "") {
  const widgetPath = buildSpaceWidgetFilePath(spaceId, widgetId);
  const widgetUrl = new URL(resolveAppUrl(widgetPath), globalThis.location.origin);

  if (cacheToken) {
    widgetUrl.searchParams.set("v", String(cacheToken));
  }

  return widgetUrl.toString();
}

export function createWidgetSource(options = {}) {
  const widgetTitle = String(options.title || "Untitled Widget").trim() || "Untitled Widget";
  const sizeValue =
    typeof options.size === "string" && options.size.trim()
      ? options.size.trim()
      : sizeToToken(normalizeWidgetSize(options.size, DEFAULT_WIDGET_SIZE));
  const htmlSource = String(
    options.html ||
      `<div class="spaces-raw-demo">\n  <p>Replace this block or swap it for higher-level primitives.</p>\n</div>`
  );

  return `import { defineWidget, rawHtml } from "/mod/_core/spaces/widget-sdk.js";

export default defineWidget({
  apiVersion: 1,
  title: ${JSON.stringify(widgetTitle)},
  size: ${JSON.stringify(sizeValue)},
  render() {
    return rawHtml(${JSON.stringify(htmlSource)});
  }
});
`;
}

function isLegacyGeneratedWidgetSource(source) {
  const normalizedSource = String(source || "");

  return (
    normalizedSource.includes('eyebrow: "Widget"') &&
    normalizedSource.includes("This widget is stored as a JS module in the current space.") &&
    normalizedSource.includes("return stack([") &&
    normalizedSource.includes("rawHtml(")
  );
}

function readJsonStringLiteral(source, pattern, fallback) {
  const match = String(source || "").match(pattern);

  if (!match) {
    return fallback;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return fallback;
  }
}

function migrateLegacyGeneratedWidgetSource(source) {
  if (!isLegacyGeneratedWidgetSource(source)) {
    return source;
  }

  const titlePattern = new RegExp(`^\\s*title:\\s*(${JSON_STRING_LITERAL_PATTERN})\\s*,`, "mu");
  const sizePattern = new RegExp(`^\\s*size:\\s*(${JSON_STRING_LITERAL_PATTERN})\\s*,`, "mu");
  const htmlPattern = new RegExp(`rawHtml\\(\\s*(${JSON_STRING_LITERAL_PATTERN})\\s*\\)`, "u");
  const title = readJsonStringLiteral(source, titlePattern, "Untitled Widget");
  const size = readJsonStringLiteral(source, sizePattern, sizeToToken(DEFAULT_WIDGET_SIZE));
  const html = readJsonStringLiteral(source, htmlPattern, '<div class="spaces-raw-demo"></div>');

  return createWidgetSource({
    html,
    size,
    title
  });
}

export async function maybeMigrateLegacyWidgetSource(spaceId, widgetId) {
  const runtime = ensureSpaceRuntime();
  const path = buildSpaceWidgetFilePath(spaceId, widgetId);
  const response = await runtime.api.fileRead(path);
  const source = String(response?.content || "");

  if (!isLegacyGeneratedWidgetSource(source)) {
    return {
      migrated: false,
      source
    };
  }

  const migratedSource = migrateLegacyGeneratedWidgetSource(source);

  if (migratedSource === source) {
    return {
      migrated: false,
      source
    };
  }

  await runtime.api.fileWrite({
    content: migratedSource,
    path
  });

  return {
    migrated: true,
    source: migratedSource
  };
}

export async function listSpaces() {
  const runtime = ensureSpaceRuntime();
  let matchedPaths = [];

  try {
    const listResult = await runtime.api.fileList(SPACES_ROOT_PATH, true);
    matchedPaths = Array.isArray(listResult?.paths)
      ? listResult.paths.filter((path) => /\/spaces\/[^/]+\/space\.yaml$/u.test(String(path || "")))
      : [];
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  if (!matchedPaths.length) {
    return [];
  }

  const readResult = await runtime.api.fileRead({
    files: matchedPaths
  });
  const files = Array.isArray(readResult?.files) ? readResult.files : [];

  return files
    .map((file) => {
      const fallbackId = parseManifestSpaceId(file?.path);
      const parsedContent = runtime.utils.yaml.parse(String(file?.content || ""));
      return formatSpaceListEntry(normalizeManifest(parsedContent, fallbackId));
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");

      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return left.title.localeCompare(right.title, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
}

export async function readSpace(spaceId) {
  return readManifestFile(spaceId);
}

export async function createSpace(options = {}) {
  const runtime = ensureSpaceRuntime();
  const title = String(options.title || "Untitled Space").trim() || "Untitled Space";
  const id = await createUniqueSpaceId(options.id || title);
  const timestamp = new Date().toISOString();
  const manifest = normalizeManifest(
    {
      created_at: timestamp,
      id,
      schema: SPACES_SCHEMA,
      title,
      updated_at: timestamp,
      minimized: [],
      positions: {},
      widgets: [],
      sizes: {},
      titles: {}
    },
    id
  );

  await runtime.api.fileWrite({
    files: [
      { path: buildSpaceRootPath(id) },
      { path: buildSpaceWidgetsPath(id) },
      { path: buildSpaceDataPath(id) },
      { path: buildSpaceAssetsPath(id) }
    ]
  });

  const files = [
    {
      content: serializeManifest(manifest),
      path: buildSpaceManifestPath(id)
    }
  ];

  await runtime.api.fileWrite({ files });
  return manifest;
}

export async function removeSpace(spaceIdOrOptions = {}) {
  const runtime = ensureSpaceRuntime();
  const requestedSpaceId =
    typeof spaceIdOrOptions === "string"
      ? spaceIdOrOptions
      : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
        ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id
        : "";
  const spaceId = normalizeOptionalSpaceId(requestedSpaceId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to remove a space.");
  }

  const spacePath = buildSpaceRootPath(spaceId);
  await runtime.api.fileDelete(spacePath);

  return {
    id: spaceId,
    path: spacePath
  };
}

export async function saveSpaceMeta(options = {}) {
  const currentSpace = cloneSpaceRecord(await readSpace(options.id));
  const nextSpace = cloneSpaceRecord(currentSpace);

  if (options.title !== undefined) {
    nextSpace.title = String(options.title || "").trim() || currentSpace.title;
  }

  nextSpace.updatedAt = new Date().toISOString();
  return writeManifestFile(nextSpace);
}

export async function saveSpaceLayout(options = {}) {
  const currentSpace = cloneSpaceRecord(await readSpace(options.id));
  const nextSpace = cloneSpaceRecord(currentSpace);

  if (Array.isArray(options.widgetIds)) {
    nextSpace.widgetIds = normalizeWidgetIdList(options.widgetIds);
  }

  if (options.widgetPositions && typeof options.widgetPositions === "object") {
    nextSpace.widgetPositions = normalizeWidgetMap(options.widgetPositions, (value) =>
      normalizeWidgetPosition(value, { col: 0, row: 0 })
    );
  }

  if (options.widgetSizes && typeof options.widgetSizes === "object") {
    nextSpace.widgetSizes = normalizeWidgetMap(options.widgetSizes, (value) =>
      normalizeWidgetSize(value, DEFAULT_WIDGET_SIZE)
    );
  }

  if (Array.isArray(options.minimizedWidgetIds)) {
    nextSpace.minimizedWidgetIds = normalizeWidgetIdList(options.minimizedWidgetIds);
  }

  const resolvedLayout = resolveSpaceLayout({
    minimizedWidgetIds: nextSpace.minimizedWidgetIds,
    widgetIds: nextSpace.widgetIds,
    widgetPositions: nextSpace.widgetPositions,
    widgetSizes: nextSpace.widgetSizes
  });

  nextSpace.widgetPositions = resolvedLayout.positions;
  nextSpace.updatedAt = new Date().toISOString();

  return writeManifestFile(nextSpace);
}

export async function upsertWidget(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);

  if (!spaceId) {
    throw new Error("A target spaceId is required to upsert a widget.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));
  const widgetId = normalizeWidgetId(options.widgetId || options.title || "widget");
  const hasExistingWidget = currentSpace.widgetIds.includes(widgetId);
  const nextSpace = cloneSpaceRecord(currentSpace);

  if (!hasExistingWidget) {
    nextSpace.widgetIds.push(widgetId);
  }

  if (options.size !== undefined) {
    nextSpace.widgetSizes[widgetId] = normalizeWidgetSize(options.size, currentSpace.widgetSizes[widgetId] || DEFAULT_WIDGET_SIZE);
  } else if (!nextSpace.widgetSizes[widgetId] && !hasExistingWidget) {
    nextSpace.widgetSizes[widgetId] = DEFAULT_WIDGET_SIZE;
  }

  if (options.title === null) {
    delete nextSpace.widgetTitles[widgetId];
  } else if (options.title !== undefined) {
    nextSpace.widgetTitles[widgetId] = String(options.title || "").trim();
  }

  if (!nextSpace.widgetPositions[widgetId]) {
    nextSpace.widgetPositions[widgetId] = { col: 0, row: 0 };
  }

  const resolvedLayout = resolveSpaceLayout({
    anchorPosition: options.position,
    anchorSize: nextSpace.widgetSizes[widgetId],
    anchorWidgetId: widgetId,
    minimizedWidgetIds: nextSpace.minimizedWidgetIds,
    widgetIds: nextSpace.widgetIds,
    widgetPositions: {
      ...nextSpace.widgetPositions,
      ...(options.position !== undefined
        ? {
            [widgetId]: normalizeWidgetPosition(options.position, nextSpace.widgetPositions[widgetId])
          }
        : {})
    },
    widgetSizes: nextSpace.widgetSizes
  });

  nextSpace.widgetPositions = resolvedLayout.positions;

  nextSpace.updatedAt = new Date().toISOString();

  const source =
    options.source !== undefined
      ? String(options.source)
      : hasExistingWidget
        ? null
        : createWidgetSource({
            html: options.html,
            size: options.size,
            title: options.title || formatTitleFromId(widgetId)
          });

  const files = [
    {
      content: serializeManifest(nextSpace),
      path: buildSpaceManifestPath(spaceId)
    }
  ];

  if (source !== null) {
    files.push({
      content: source,
      path: buildSpaceWidgetFilePath(spaceId, widgetId)
    });
  }

  await runtime.api.fileWrite({ files });

  return {
    space: nextSpace,
    widgetId,
    widgetPath: buildSpaceWidgetFilePath(spaceId, widgetId)
  };
}

export async function removeWidget(options = {}) {
  const runtime = ensureSpaceRuntime();
  const spaceId = normalizeOptionalSpaceId(options.spaceId);
  const widgetId = normalizeOptionalWidgetId(options.widgetId);

  if (!spaceId || !widgetId) {
    throw new Error("Both spaceId and widgetId are required to remove a widget.");
  }

  const currentSpace = cloneSpaceRecord(await readSpace(spaceId));

  if (!currentSpace.widgetIds.includes(widgetId)) {
    throw new Error(`Widget "${widgetId}" was not found in space "${spaceId}".`);
  }

  currentSpace.widgetIds = currentSpace.widgetIds.filter((entry) => entry !== widgetId);
  currentSpace.minimizedWidgetIds = currentSpace.minimizedWidgetIds.filter((entry) => entry !== widgetId);
  delete currentSpace.widgetPositions[widgetId];
  delete currentSpace.widgetSizes[widgetId];
  delete currentSpace.widgetTitles[widgetId];
  currentSpace.updatedAt = new Date().toISOString();

  await runtime.api.fileWrite({
    content: serializeManifest(currentSpace),
    path: buildSpaceManifestPath(spaceId)
  });
  await runtime.api.fileDelete(buildSpaceWidgetFilePath(spaceId, widgetId));

  return {
    space: currentSpace,
    widgetId
  };
}
