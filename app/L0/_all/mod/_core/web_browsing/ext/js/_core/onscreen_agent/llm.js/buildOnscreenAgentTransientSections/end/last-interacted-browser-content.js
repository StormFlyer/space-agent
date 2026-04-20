import { setPromptItem } from "/mod/_core/agent_prompt/prompt-items.js";
import { getStore } from "/mod/_core/framework/js/AlpineStore.js";
import {
  normalizeBrowserTransientCell,
  normalizeBrowserTransientId
} from "./open-browsers.js";

const LAST_INTERACTED_BROWSER_CONTENT_HEADING = "last interacted web browser";
const LAST_INTERACTED_BROWSER_CONTENT_KEY = "last-interacted-web-browser-content";
const LAST_INTERACTED_BROWSER_CONTENT_TIMEOUT_MS = 1800;
const LAST_INTERACTED_BROWSER_CONTENT_RETRY_COUNT = 3;
const LAST_INTERACTED_BROWSER_CONTENT_RETRY_DELAY_MS = 120;

function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function buildBrowserStatusRow(browserWindow) {
  const id = normalizeBrowserTransientId(browserWindow?.id);
  const url = normalizeBrowserTransientCell(
    browserWindow?.currentUrl
    || browserWindow?.frameSrc
    || browserWindow?.addressValue
    || ""
  );
  const title = normalizeBrowserTransientCell(browserWindow?.title || "");

  if (!id) {
    return null;
  }

  return {
    id,
    title,
    url
  };
}

async function buildLastInteractedBrowserContentTransientSection(webBrowsingStore = getStore("webBrowsing")) {
  const browserId = String(webBrowsingStore?.lastInteractedBrowserId || "").trim();
  const browserInstanceKey = webBrowsingStore?.lastInteractedBrowserInstanceKey ?? null;
  if (!browserId) {
    return null;
  }

  const browserWindow = typeof webBrowsingStore?.getWindow === "function"
    ? webBrowsingStore.getWindow(browserId)
    : null;
  if (!browserWindow) {
    return null;
  }

  if (browserInstanceKey != null && browserWindow.instanceKey !== browserInstanceKey) {
    return null;
  }

  let documentContent = "";
  for (let attempt = 0; attempt < LAST_INTERACTED_BROWSER_CONTENT_RETRY_COUNT; attempt += 1) {
    if (typeof webBrowsingStore?.syncNavigationState === "function") {
      await webBrowsingStore.syncNavigationState(browserId, {
        allowUnready: true,
        attempts: attempt === 0 ? 1 : 2
      });
    }

    const contentPayload = typeof webBrowsingStore?.requestBridgePayload === "function"
      ? await webBrowsingStore.requestBridgePayload(browserId, "content", null, {
          timeoutMs: LAST_INTERACTED_BROWSER_CONTENT_TIMEOUT_MS
        })
      : null;
    documentContent = typeof contentPayload?.document === "string"
      ? contentPayload.document.trim()
      : "";
    if (documentContent) {
      break;
    }

    if (attempt < (LAST_INTERACTED_BROWSER_CONTENT_RETRY_COUNT - 1)) {
      await wait(LAST_INTERACTED_BROWSER_CONTENT_RETRY_DELAY_MS);
    }
  }

  if (!documentContent) {
    return null;
  }

  const row = buildBrowserStatusRow(
    typeof webBrowsingStore?.getWindow === "function"
      ? webBrowsingStore.getWindow(browserId)
      : browserWindow
  );
  if (!row) {
    return null;
  }

  return {
    heading: LAST_INTERACTED_BROWSER_CONTENT_HEADING,
    key: LAST_INTERACTED_BROWSER_CONTENT_KEY,
    order: 30,
    value: [
      "browser id|url|title",
      `${row.id}|${row.url}|${row.title}`,
      "",
      "page content↓",
      documentContent
    ].join("\n")
  };
}

export default async function injectLastInteractedBrowserContentTransientSection(hookContext) {
  const promptContext = hookContext?.result;

  if (!promptContext) {
    return;
  }

  const contentTransientSection = await buildLastInteractedBrowserContentTransientSection();

  if (!contentTransientSection) {
    return;
  }

  promptContext.transientItems = setPromptItem(
    promptContext.transientItems,
    LAST_INTERACTED_BROWSER_CONTENT_KEY,
    contentTransientSection
  );
}
