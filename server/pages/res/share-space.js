import { decryptSharePayload, ensureWebCrypto } from "/pages/res/share-crypto.js";

const CLOUD_SHARE_ROUTE_PATTERN = /^\/share\/space\/([A-Za-z0-9]{8})$/u;
const ENTER_TAB_ACCESS_KEY = "space.enter.tab-access";
const STATE_VERSION_HEADER = "Space-State-Version";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_MAX_COMMENT_BYTES = 65535;
const PREVIEW_WIDGET_PILL_LIMIT = 12;
const DEFAULT_PREVIEW_ICON = "🛰️";
const SESSION_READY_MAX_ATTEMPTS = 12;
const SESSION_READY_RETRY_DELAY_MS = 250;

const previewState = {
  archiveBytes: null,
  preview: null,
  rawShareBytes: null
};

const utf8Decoder = new TextDecoder("utf-8");
const latin1Decoder = new TextDecoder("latin1");

function getTokenFromLocation(locationLike = window.location) {
  const match = String(locationLike.pathname || "").match(CLOUD_SHARE_ROUTE_PATTERN);
  return match ? match[1] : "";
}

function getStatusElement() {
  return document.getElementById("share-status");
}

function getPasswordForm() {
  return document.getElementById("share-password-form");
}

function getPasswordInput() {
  return document.getElementById("share-password-input");
}

function getPasswordSubmit() {
  return document.getElementById("share-password-submit");
}

function getOpenButton() {
  return document.getElementById("share-open-button");
}

function setStatus(message, tone = "") {
  const statusElement = getStatusElement();

  if (!statusElement) {
    return;
  }

  const text = String(message || "").trim();

  statusElement.hidden = text.length === 0;
  statusElement.textContent = text;
  statusElement.className = tone && text ? "share-status " + tone : "share-status";
}

function clearStatus() {
  setStatus("");
}

async function readJson(pathname) {
  const response = await fetch(pathname, {
    credentials: "same-origin",
    method: "GET"
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function readShareArchive(token) {
  const response = await fetch("/api/cloud_share_download?token=" + encodeURIComponent(token), {
    credentials: "same-origin",
    method: "GET"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Request failed.");
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function cloneShareArchive(token, payloadBytes) {
  const response = await fetch("/api/cloud_share_clone?token=" + encodeURIComponent(token), {
    credentials: "same-origin",
    method: "POST",
    headers: {
      "Content-Type": "application/zip"
    },
    body: payloadBytes
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return {
    ...payload,
    stateVersion: normalizeStateVersion(response.headers.get(STATE_VERSION_HEADER))
  };
}

function normalizeStateVersion(value) {
  const candidate = Math.floor(Number(value));
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function togglePasswordPrompt(visible) {
  const prompt = getPasswordForm();

  if (!prompt) {
    return;
  }

  prompt.hidden = !visible;
}

function toggleOpenButton(visible) {
  const button = getOpenButton();

  if (!button) {
    return;
  }

  button.hidden = !visible;
}

function setButtonBusy(button, isBusy) {
  if (!button) {
    return;
  }

  button.disabled = Boolean(isBusy);
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripInlineYamlComment(value) {
  const candidate = String(value || "");

  if (!candidate || candidate.startsWith('"') || candidate.startsWith("'")) {
    return candidate;
  }

  return candidate.replace(/\s+#.*$/u, "");
}

function normalizeYamlScalar(value) {
  const candidate = String(value || "").trim();

  if (!candidate || candidate === "|" || candidate === ">" || candidate.startsWith("|") || candidate.startsWith(">")) {
    return "";
  }

  if (candidate.startsWith('"') && candidate.endsWith('"') && candidate.length >= 2) {
    return candidate
      .slice(1, -1)
      .replace(/\\"/gu, '"')
      .replace(/\\n/gu, "\n")
      .replace(/\\\\/gu, "\\")
      .trim();
  }

  if (candidate.startsWith("'") && candidate.endsWith("'") && candidate.length >= 2) {
    return candidate.slice(1, -1).replace(/''/gu, "'").trim();
  }

  return stripInlineYamlComment(candidate).trim();
}

function extractSimpleYamlScalar(sourceText, key) {
  const matcher = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "u");
  const lines = String(sourceText || "").split(/\r?\n/gu);

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(matcher);

    if (!match) {
      continue;
    }

    return normalizeYamlScalar(match[1]);
  }

  return "";
}

function formatTitleFromId(value) {
  return String(value || "")
    .replace(/\.[^.]+$/u, "")
    .replace(/[_-]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}

function createDataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findZipEndOfCentralDirectory(bytes) {
  const view = createDataView(bytes);
  const startOffset = Math.max(0, bytes.length - (ZIP_MAX_COMMENT_BYTES + 22));

  for (let offset = bytes.length - 22; offset >= startOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("The shared archive is not a valid ZIP.");
}

function decodeZipText(bytes, flags = 0) {
  try {
    return (flags & ZIP_UTF8_FLAG ? utf8Decoder : latin1Decoder).decode(bytes);
  } catch {
    return utf8Decoder.decode(bytes);
  }
}

function parseZipEntries(bytes) {
  const view = createDataView(bytes);
  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 shared archives are not supported here.");
  }

  if (
    centralDirectoryOffset < 0 ||
    centralDirectorySize < 0 ||
    centralDirectoryOffset + centralDirectorySize > bytes.length
  ) {
    throw new Error("The shared archive central directory is invalid.");
  }

  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
      throw new Error("The shared archive entry list is invalid.");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > bytes.length) {
      throw new Error("The shared archive contains an invalid file name.");
    }

    entries.push({
      compressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
      name: decodeZipText(bytes.subarray(fileNameStart, fileNameEnd), flags).replace(/\\/gu, "/"),
      uncompressedSize
    });

    offset = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

async function inflateRawBytes(compressedBytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot preview compressed shared spaces.");
  }

  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntryBytes(archiveBytes, entry) {
  const view = createDataView(archiveBytes);
  const localOffset = Number(entry?.localHeaderOffset);

  if (!Number.isInteger(localOffset) || localOffset < 0 || localOffset + 30 > archiveBytes.length) {
    throw new Error("The shared archive contains an invalid entry offset.");
  }

  if (view.getUint32(localOffset, true) !== ZIP_LOCAL_HEADER_SIGNATURE) {
    throw new Error("The shared archive contains an invalid local entry header.");
  }

  const fileNameLength = view.getUint16(localOffset + 26, true);
  const extraFieldLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + Number(entry.compressedSize || 0);

  if (dataStart < 0 || dataEnd > archiveBytes.length) {
    throw new Error("The shared archive entry data is truncated.");
  }

  const compressedBytes = archiveBytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === ZIP_METHOD_STORED) {
    return compressedBytes;
  }

  if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
    const inflatedBytes = await inflateRawBytes(compressedBytes);

    if (
      Number.isFinite(entry.uncompressedSize) &&
      Number(entry.uncompressedSize) >= 0 &&
      inflatedBytes.length !== Number(entry.uncompressedSize)
    ) {
      throw new Error("The shared archive preview size check failed.");
    }

    return inflatedBytes;
  }

  throw new Error("This shared archive uses an unsupported ZIP compression method.");
}

function resolveZipSpaceRoot(entries) {
  const normalizedEntries = entries
    .map((entry) => String(entry?.name || "").replace(/\/+$/u, ""))
    .filter(Boolean);
  const nonAuxiliaryEntries = normalizedEntries.filter(
    (name) => name !== "__MACOSX" && !name.startsWith("__MACOSX/")
  );

  if (nonAuxiliaryEntries.includes("space.yaml")) {
    return "";
  }

  const candidateManifests = nonAuxiliaryEntries.filter((name) => /^[^/]+\/space\.yaml$/u.test(name));

  if (candidateManifests.length !== 1) {
    throw new Error("The shared archive does not contain exactly one previewable space.");
  }

  const rootSegment = candidateManifests[0].slice(0, candidateManifests[0].indexOf("/"));
  const ownsAllEntries = nonAuxiliaryEntries.every(
    (name) => name === rootSegment || name.startsWith(rootSegment + "/")
  );

  if (!ownsAllEntries) {
    throw new Error("The shared archive contains multiple top-level spaces.");
  }

  return rootSegment + "/";
}

function buildZipEntryMap(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    const name = String(entry?.name || "");

    if (name) {
      map.set(name, entry);
    }
  });

  return map;
}

function createWidgetPillList(widgetNames) {
  const names = Array.from(
    new Set(
      (Array.isArray(widgetNames) ? widgetNames : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )
  );
  const visibleNames = names.slice(0, PREVIEW_WIDGET_PILL_LIMIT);

  if (names.length > visibleNames.length) {
    visibleNames.push("+" + String(names.length - visibleNames.length) + " more");
  }

  return visibleNames;
}

async function buildSharePreviewFromArchive(archiveBytes) {
  const entries = parseZipEntries(archiveBytes);
  const rootPrefix = resolveZipSpaceRoot(entries);
  const entryMap = buildZipEntryMap(entries);
  const manifestEntry = entryMap.get(rootPrefix + "space.yaml");

  if (!manifestEntry) {
    throw new Error("The shared archive does not include a previewable manifest.");
  }

  const manifestSource = utf8Decoder.decode(await readZipEntryBytes(archiveBytes, manifestEntry));
  const widgetEntries = entries.filter((entry) => {
    const name = String(entry?.name || "");
    const widgetPrefix = rootPrefix + "widgets/";

    if (!name.startsWith(widgetPrefix) || !/\.(yaml|js)$/u.test(name)) {
      return false;
    }

    return !name.slice(widgetPrefix.length).includes("/");
  });

  const widgetNames = [];

  for (const entry of widgetEntries) {
    let widgetName = formatTitleFromId(entry.name.slice((rootPrefix + "widgets/").length));

    if (entry.name.endsWith(".yaml")) {
      const widgetSource = utf8Decoder.decode(await readZipEntryBytes(archiveBytes, entry));
      widgetName =
        extractSimpleYamlScalar(widgetSource, "name") ||
        widgetName;
    }

    if (widgetName) {
      widgetNames.push(widgetName);
    }
  }

  const thumbnailEntry =
    entryMap.get(rootPrefix + "thumbnail.webp") ||
    entryMap.get(rootPrefix + "thumbnail.jpg");
  let thumbnailUrl = "";

  if (thumbnailEntry) {
    const thumbnailBytes = await readZipEntryBytes(archiveBytes, thumbnailEntry);
    const type = thumbnailEntry.name.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    thumbnailUrl = URL.createObjectURL(new Blob([thumbnailBytes], { type }));
  }

  return {
    icon: extractSimpleYamlScalar(manifestSource, "icon") || DEFAULT_PREVIEW_ICON,
    iconColor: extractSimpleYamlScalar(manifestSource, "icon_color"),
    thumbnailUrl,
    title: extractSimpleYamlScalar(manifestSource, "title") || "Untitled",
    widgetPills: createWidgetPillList(widgetNames)
  };
}

function revokeCurrentPreview() {
  const currentPreview = previewState.preview;

  if (currentPreview?.thumbnailUrl) {
    URL.revokeObjectURL(currentPreview.thumbnailUrl);
  }

  previewState.preview = null;
}

function clearPreparedArchive() {
  previewState.archiveBytes = null;
  revokeCurrentPreview();
  renderPreview(null);
  toggleOpenButton(false);
}

function renderWidgetPills(widgetPills) {
  const pillsRoot = document.getElementById("share-preview-pills");

  if (!pillsRoot) {
    return;
  }

  pillsRoot.replaceChildren();

  (Array.isArray(widgetPills) ? widgetPills : []).forEach((label) => {
    const pill = document.createElement("span");
    pill.className = "share-pill";
    pill.textContent = String(label || "");
    pillsRoot.append(pill);
  });
}

function renderPreview(preview) {
  const previewRoot = document.getElementById("share-preview");
  const previewTitle = document.getElementById("share-preview-title");
  const previewImage = document.getElementById("share-preview-image");
  const previewFallback = document.getElementById("share-preview-fallback");
  const previewIcon = document.getElementById("share-preview-icon");

  if (!previewRoot || !previewTitle || !previewImage || !previewFallback || !previewIcon) {
    return;
  }

  if (!preview) {
    previewRoot.hidden = true;
    previewTitle.textContent = "Untitled";
    previewImage.hidden = true;
    previewImage.removeAttribute("src");
    previewFallback.hidden = false;
    previewIcon.textContent = DEFAULT_PREVIEW_ICON;
    previewIcon.style.color = "";
    renderWidgetPills([]);
    return;
  }

  previewRoot.hidden = false;
  previewTitle.textContent = String(preview.title || "Untitled");
  previewIcon.textContent = String(preview.icon || DEFAULT_PREVIEW_ICON);
  previewIcon.style.color = String(preview.iconColor || "").trim();
  renderWidgetPills(preview.widgetPills);

  if (preview.thumbnailUrl) {
    previewImage.src = preview.thumbnailUrl;
    previewImage.hidden = false;
    previewFallback.hidden = true;
  } else {
    previewImage.hidden = true;
    previewImage.removeAttribute("src");
    previewFallback.hidden = false;
  }
}

function grantTabAccess() {
  try {
    window.sessionStorage.setItem(ENTER_TAB_ACCESS_KEY, "1");
  } catch {
    // Ignore storage failures and continue navigation.
  }
}

async function waitForGuestSessionReady(minimumStateVersion = 0) {
  for (let attempt = 0; attempt < SESSION_READY_MAX_ATTEMPTS; attempt += 1) {
    const headers = new Headers();

    if (minimumStateVersion > 0) {
      headers.set(STATE_VERSION_HEADER, String(minimumStateVersion));
    }

    const response = await fetch("/api/login_check", {
      cache: "no-store",
      credentials: "same-origin",
      headers,
      method: "GET"
    });

    if (response.status === 503) {
      await wait(SESSION_READY_RETRY_DELAY_MS);
      continue;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(String(payload.error || "Could not confirm the guest session."));
    }

    if (payload.authenticated === true) {
      return payload;
    }

    await wait(SESSION_READY_RETRY_DELAY_MS);
  }

  throw new Error("The guest session did not become ready in time. Try opening the shared space again.");
}

async function ensureRawShareBytes(token) {
  if (previewState.rawShareBytes instanceof Uint8Array && previewState.rawShareBytes.length > 0) {
    return previewState.rawShareBytes;
  }

  previewState.rawShareBytes = await readShareArchive(token);
  return previewState.rawShareBytes;
}

async function prepareSharePreview({ token, encryption = null, password = "" }) {
  clearPreparedArchive();
  setStatus("Preparing shared space...");
  const shareBytes = await ensureRawShareBytes(token);
  let archiveBytes = shareBytes;

  if (encryption?.encrypted === true) {
    try {
      archiveBytes = await decryptSharePayload(shareBytes, encryption, password);
    } catch {
      throw new Error("Incorrect password or corrupted share.");
    }
  }

  const preview = await buildSharePreviewFromArchive(archiveBytes);
  previewState.archiveBytes = archiveBytes;
  previewState.preview = preview;
  renderPreview(preview);
  toggleOpenButton(true);
  clearStatus();
  return preview;
}

async function openSharedSpace(token) {
  if (!(previewState.archiveBytes instanceof Uint8Array) || previewState.archiveBytes.length === 0) {
    throw new Error("The shared space is not ready yet.");
  }

  setStatus("Creating guest space...");
  const cloneResult = await cloneShareArchive(token, previewState.archiveBytes);
  setStatus("Preparing guest session...");
  await waitForGuestSessionReady(cloneResult.stateVersion);
  grantTabAccess();
  setStatus("Opening shared space...", "ok");
  window.location.replace(String(cloneResult.redirectUrl || "/"));
}

async function init() {
  const token = getTokenFromLocation();
  const passwordForm = getPasswordForm();
  const passwordInput = getPasswordInput();
  const passwordSubmit = getPasswordSubmit();
  const openButton = getOpenButton();
  const backdropRoot = document.querySelector("[data-space-backdrop]");

  window.SpaceBackdrop?.install?.(backdropRoot, {
    canvas: document.body,
    motionQuery: window.matchMedia("(prefers-reduced-motion: reduce)")
  });

  if (!token) {
    setStatus("Cloud share not found.", "error");
    return;
  }

  let shareInfo;

  try {
    setStatus("Preparing shared space...");
    shareInfo = await readJson("/api/cloud_share_info?token=" + encodeURIComponent(token));
  } catch (error) {
    setStatus(error.message || "Cloud share not found.", "error");
    return;
  }

  const encryption =
    shareInfo.encrypted === true && shareInfo.encryption && typeof shareInfo.encryption === "object"
      ? {
          ...shareInfo.encryption,
          encrypted: true
        }
      : null;

  openButton?.addEventListener("click", async () => {
    setButtonBusy(openButton, true);
    setButtonBusy(passwordSubmit, true);

    try {
      await openSharedSpace(token);
    } catch (error) {
      setStatus(error.message || "Could not open the shared space.", "error");
      setButtonBusy(openButton, false);
      setButtonBusy(passwordSubmit, false);
    }
  });

  if (shareInfo.encrypted === true) {
    try {
      ensureWebCrypto();
    } catch (error) {
      setStatus(error.message || "Password-protected cloud shares are not supported in this browser.", "error");
      return;
    }

    togglePasswordPrompt(true);
    clearStatus();
    passwordInput?.focus();
    passwordForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = String(passwordInput?.value || "");

      if (!password) {
        setStatus("Enter the share password.", "error");
        passwordInput?.focus();
        return;
      }

      setButtonBusy(passwordSubmit, true);
      setButtonBusy(openButton, true);

      try {
        await prepareSharePreview({
          encryption,
          password,
          token
        });
        togglePasswordPrompt(false);
        passwordInput.value = "";
        openButton?.focus();
      } catch (error) {
        setStatus(error.message || "Could not prepare the shared space.", "error");
        setButtonBusy(passwordSubmit, false);
        setButtonBusy(openButton, false);
        passwordInput?.select();
        return;
      }

      setButtonBusy(passwordSubmit, false);
      setButtonBusy(openButton, false);
    });
    return;
  }

  try {
    await prepareSharePreview({ token });
  } catch (error) {
    setStatus(error.message || "Could not prepare the shared space.", "error");
    return;
  }

  setButtonBusy(openButton, false);
}

if (typeof window !== "undefined") {
  void init();
}

export {
  buildSharePreviewFromArchive
};
