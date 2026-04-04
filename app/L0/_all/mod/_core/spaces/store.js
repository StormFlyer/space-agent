import {
  DEFAULT_WIDGET_POSITION,
  MAX_WIDGET_COLS,
  MAX_WIDGET_ROWS,
  SPACES_ROUTE_PATH,
  WIDGET_API_VERSION
} from "/mod/_core/spaces/constants.js";
import {
  clampWidgetPosition,
  getRenderedWidgetSize,
  normalizeWidgetPosition,
  resolveSpaceLayout
} from "/mod/_core/spaces/layout.js";
import {
  buildSpaceRootPath,
  buildSpaceWidgetFilePath,
  buildSpaceWidgetModuleUrl,
  createSpace,
  createWidgetSource,
  listSpaces,
  maybeMigrateLegacyWidgetSource,
  normalizeSpaceId,
  readSpace,
  removeSpace,
  removeWidget,
  resolveAppUrl,
  saveSpaceLayout,
  saveSpaceMeta,
  upsertWidget
} from "/mod/_core/spaces/storage.js";
import {
  DEFAULT_WIDGET_SIZE,
  defineWidget,
  fragment,
  group,
  html,
  keyValue,
  list,
  markdown,
  metric,
  normalizeWidgetSize,
  notice,
  primitives,
  rawHtml,
  sizeToToken,
  stack,
  table,
  text
} from "/mod/_core/spaces/widget-sdk-core.js";
import { renderWidgetOutput } from "/mod/_core/spaces/widget-render.js";

let activeSpacesStore = null;
const SPACES_STORE_NAME = "spacesPage";
const TAU = Math.PI * 2;
const GRID_BASE_HALF_COLS = 0;
const GRID_BASE_HALF_ROWS = 0;
const GRID_CONTENT_BUFFER_COLS = 6;
const GRID_CONTENT_BUFFER_ROWS = 6;
const GRID_CAMERA_BUFFER_COLS = 2;
const GRID_CAMERA_BUFFER_ROWS = 2;
const GRID_EDGE_SCROLL_THRESHOLD = 72;
const GRID_EDGE_SCROLL_SPEED = 8;
const EMPTY_SPACE_FLOAT_PROFILE = Object.freeze({
  orbitPeriodMs: 12400,
  rotationAmplitude: 3.2,
  rotationPeriodMs: 17600,
  xRadius: 7.2,
  yRadius: 8.2
});

function positiveModulo(value, divisor) {
  if (!Number.isFinite(divisor) || divisor === 0) {
    return 0;
  }

  return ((value % divisor) + divisor) % divisor;
}

function clampNumber(value, min, max) {
  if (min > max) {
    return (min + max) / 2;
  }

  return Math.min(max, Math.max(min, value));
}

function ensureSpacesRuntimeNamespace() {
  const runtime = globalThis.space;

  if (!runtime) {
    throw new Error("Space runtime is not available.");
  }

  const previousNamespace = runtime.spaces && typeof runtime.spaces === "object" ? runtime.spaces : {};
  const namespace = {
    ...previousNamespace,
    createSpace: async (options = {}) => {
      const createdSpace = await createSpace(options);

      if (options.open !== false && globalThis.space.router) {
        await namespace.openSpace(createdSpace.id, {
          replace: options.replace !== false
        });
      }

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(createdSpace.id);
      }

      return createdSpace;
    },
    createWidgetSource,
    defineWidget,
    fragment,
    getCurrentSpace() {
      return activeSpacesStore?.currentSpace || null;
    },
    group,
    html,
    keyValue,
    list,
    listSpaces,
    markdown,
    metric,
    notice,
    openSpace(spaceId, options = {}) {
      const normalizedSpaceId = normalizeOptionalSpaceId(spaceId);

      if (!normalizedSpaceId) {
        throw new Error("A valid spaceId is required.");
      }

      if (!globalThis.space.router) {
        throw new Error("Router runtime is not available.");
      }

      return options.replace
        ? globalThis.space.router.replaceTo(SPACES_ROUTE_PATH, { params: { id: normalizedSpaceId } })
        : globalThis.space.router.goTo(SPACES_ROUTE_PATH, { params: { id: normalizedSpaceId } });
    },
    primitives,
    rawHtml,
    readSpace,
    reloadCurrentSpace: async () => {
      if (!activeSpacesStore) {
        throw new Error("The spaces view is not currently mounted.");
      }

      await activeSpacesStore.reloadCurrentSpace();
      return activeSpacesStore.currentSpace;
    },
    removeSpace: async (spaceIdOrOptions = undefined) => {
      const requestedSpaceId =
        typeof spaceIdOrOptions === "string"
          ? spaceIdOrOptions
          : spaceIdOrOptions && typeof spaceIdOrOptions === "object"
            ? spaceIdOrOptions.spaceId ?? spaceIdOrOptions.id ?? activeSpacesStore?.currentSpaceId
            : activeSpacesStore?.currentSpaceId;
      const targetSpaceId = normalizeOptionalSpaceId(requestedSpaceId);

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove a space.");
      }

      const result = await removeSpace({
        ...(spaceIdOrOptions && typeof spaceIdOrOptions === "object" ? spaceIdOrOptions : {}),
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleRemovedSpace(targetSpaceId);
      }

      return result;
    },
    removeWidget: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to remove a widget.");
      }

      const result = await removeWidget({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      return result;
    },
    resolveAppUrl,
    saveSpaceLayout: async (options = {}) => {
      const savedSpace = await saveSpaceLayout(options);

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(savedSpace.id);
      }

      return savedSpace;
    },
    saveSpaceMeta: async (options = {}) => {
      const savedSpace = await saveSpaceMeta(options);

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(savedSpace.id);
      }

      return savedSpace;
    },
    sizeToToken,
    stack,
    table,
    text,
    upsertWidget: async (options = {}) => {
      const targetSpaceId = options.spaceId || activeSpacesStore?.currentSpaceId;

      if (!targetSpaceId) {
        throw new Error("A target spaceId is required to save a widget.");
      }

      const result = await upsertWidget({
        ...options,
        spaceId: targetSpaceId
      });

      if (activeSpacesStore) {
        await activeSpacesStore.handleExternalMutation(targetSpaceId);
      }

      return result;
    },
    widgetApiVersion: WIDGET_API_VERSION,
    widgetSdkUrl: "/mod/_core/spaces/widget-sdk.js"
  };

  runtime.spaces = namespace;
  return namespace;
}

const spacesRuntime = ensureSpacesRuntimeNamespace();

function createElement(tagName, className = "", textContent = "") {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent) {
    element.textContent = textContent;
  }

  return element;
}

function formatErrorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

function logSpacesError(context, error, details = undefined) {
  if (details === undefined) {
    console.error(`[spaces] ${context}`, error);
    return;
  }

  console.error(`[spaces] ${context}`, details, error);
}

function normalizeOptionalSpaceId(value) {
  const rawValue = String(value ?? "").trim();
  return rawValue ? normalizeSpaceId(rawValue) : "";
}

function isTruthyRouteParam(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function createWidgetPlaceholder(textValue) {
  const root = createElement("div", "spaces-widget-placeholder");
  root.appendChild(createElement("p", "spaces-widget-placeholder-copy", textValue));
  return root;
}

function createGridStateCard(titleValue, bodyValue, tone = "info") {
  const root = createElement("section", `spaces-grid-state is-${tone}`);
  root.appendChild(createElement("h2", "spaces-grid-state-title", titleValue));
  root.appendChild(createElement("p", "spaces-grid-state-copy", bodyValue));
  return root;
}

function createEmptyCanvasState() {
  const examplePrompts = [
    "What's the weather here?",
    "Make me a Tetris game",
    "Flip the space upside down slowly",
    "What's the Bitcoin and ETH price?"
  ];
  const root = createElement("section", "spaces-empty-canvas");
  const content = createElement("div", "spaces-empty-canvas-content");
  const title = createElement("h2", "spaces-empty-canvas-title");
  const firstLine = createElement("span", "spaces-empty-canvas-line", "Just an empty space here,");
  const secondLine = createElement("span", "spaces-empty-canvas-line", "tell the Space Agent what to do...");
  const examples = createElement("div", "spaces-empty-canvas-examples");

  title.append(firstLine, secondLine);
  examplePrompts.forEach((promptText) => {
    const button = createElement("button", "spaces-empty-canvas-example", promptText);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        if (!globalThis.space?.onscreenAgent?.submitPrompt) {
          throw new Error("space.onscreenAgent.submitPrompt(...) is not available.");
        }

        await globalThis.space.onscreenAgent.submitPrompt(promptText);
      } catch (error) {
        logSpacesError("empty canvas example click failed", error, {
          promptText
        });
      } finally {
        button.disabled = false;
      }
    });
    examples.appendChild(button);
  });

  content.append(title, examples);
  root.appendChild(content);

  return { root, title };
}

function applyFloatingTitlePose(element, x, y, rotation) {
  if (!element) {
    return;
  }

  element.style.setProperty("--spaces-empty-title-float-x", `${x.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-title-float-y", `${y.toFixed(1)}px`);
  element.style.setProperty("--spaces-empty-title-rotate", `${rotation.toFixed(1)}deg`);
}

function startFloatingTitleAnimation(element, motionQuery = null) {
  if (!element) {
    return () => {};
  }

  let frame = 0;
  let startTime = 0;

  const resetPose = () => {
    applyFloatingTitlePose(element, 0, 0, 0);
  };

  const step = (timestamp) => {
    if (!element.isConnected) {
      frame = 0;
      return;
    }

    if (motionQuery?.matches) {
      frame = 0;
      startTime = 0;
      resetPose();
      return;
    }

    if (!startTime) {
      startTime = timestamp;
    }

    const elapsed = timestamp - startTime;
    const orbitAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.orbitPeriodMs) * TAU) + 0.45;
    const rotationAngle = ((elapsed / EMPTY_SPACE_FLOAT_PROFILE.rotationPeriodMs) * TAU) + 1.1;

    applyFloatingTitlePose(
      element,
      Math.cos(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.xRadius,
      Math.sin(orbitAngle) * EMPTY_SPACE_FLOAT_PROFILE.yRadius,
      Math.sin(rotationAngle) * EMPTY_SPACE_FLOAT_PROFILE.rotationAmplitude
    );

    frame = window.requestAnimationFrame(step);
  };

  const start = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    startTime = 0;
    resetPose();

    if (!element.isConnected || motionQuery?.matches) {
      return;
    }

    frame = window.requestAnimationFrame(step);
  };

  const handleMotionPreferenceChange = () => {
    start();
  };

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", handleMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(handleMotionPreferenceChange);
    }
  }

  start();

  return () => {
    window.cancelAnimationFrame(frame);
    frame = 0;

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === "function") {
        motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      } else if (typeof motionQuery.removeListener === "function") {
        motionQuery.removeListener(handleMotionPreferenceChange);
      }
    }

    resetPose();
  };
}

function applyWidgetCardSize(cardElement, size) {
  cardElement.style.setProperty("--spaces-widget-cols", String(size.cols));
  cardElement.style.setProperty("--spaces-widget-rows", String(size.rows));
}

function normalizeCanvasBounds(bounds) {
  const minCol = Number.isFinite(bounds?.minCol) ? Math.floor(bounds.minCol) : -GRID_BASE_HALF_COLS;
  const maxCol = Number.isFinite(bounds?.maxCol) ? Math.ceil(bounds.maxCol) : GRID_BASE_HALF_COLS;
  const minRow = Number.isFinite(bounds?.minRow) ? Math.floor(bounds.minRow) : -GRID_BASE_HALF_ROWS;
  const maxRow = Number.isFinite(bounds?.maxRow) ? Math.ceil(bounds.maxRow) : GRID_BASE_HALF_ROWS;

  return {
    colCount: Math.max(1, maxCol - minCol),
    maxCol,
    maxRow,
    minCol,
    minRow,
    rowCount: Math.max(1, maxRow - minRow)
  };
}

function createLogicalRect(position, size) {
  const normalizedPosition = normalizeWidgetPosition(position, DEFAULT_WIDGET_POSITION);
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);

  return {
    bottom: normalizedPosition.row + normalizedSize.rows,
    left: normalizedPosition.col,
    right: normalizedPosition.col + normalizedSize.cols,
    top: normalizedPosition.row
  };
}

function parsePixelValue(value, fallback = 0) {
  const parsedValue = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function resolveCssLength(value, contextElement, fallback = 0) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return fallback;
  }

  if (/^-?\d+(\.\d+)?$/u.test(normalizedValue)) {
    return Number.parseFloat(normalizedValue);
  }

  if (/^-?\d+(\.\d+)?px$/u.test(normalizedValue)) {
    return Number.parseFloat(normalizedValue);
  }

  if (/^-?\d+(\.\d+)?rem$/u.test(normalizedValue)) {
    const rootFontSize = parsePixelValue(window.getComputedStyle(document.documentElement).fontSize, 16);
    return Number.parseFloat(normalizedValue) * rootFontSize;
  }

  if (/^-?\d+(\.\d+)?em$/u.test(normalizedValue)) {
    const elementFontSize = parsePixelValue(window.getComputedStyle(contextElement).fontSize, 16);
    return Number.parseFloat(normalizedValue) * elementFontSize;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.inlineSize = normalizedValue;
  probe.style.blockSize = "0";
  probe.style.pointerEvents = "none";
  contextElement.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();

  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function readGridMetrics(gridElement) {
  const computedStyle = window.getComputedStyle(gridElement);
  const columnGap = resolveCssLength(computedStyle.getPropertyValue("--spaces-grid-gap"), gridElement, 16);
  const rowGap = columnGap;
  const rowHeight = resolveCssLength(computedStyle.getPropertyValue("--spaces-grid-row-height"), gridElement, 74);
  const rect = gridElement.getBoundingClientRect();
  const canvasElement = activeSpacesStore?.refs?.canvas || gridElement.parentElement;
  const viewportWidth = Math.max(1, canvasElement?.clientWidth || rect.width);
  const viewportHeight = Math.max(1, canvasElement?.clientHeight || rect.height);
  const paddingLeft = parsePixelValue(computedStyle.paddingLeft, 20);
  const paddingRight = parsePixelValue(computedStyle.paddingRight, 20);
  const paddingTop = parsePixelValue(computedStyle.paddingTop, 20);
  const paddingBottom = parsePixelValue(computedStyle.paddingBottom, 20);
  const colWidth = rowHeight;

  return {
    colStep: colWidth + columnGap,
    columnGap,
    colWidth,
    paddingBlock: Math.max(paddingTop, paddingBottom),
    paddingInline: Math.max(paddingLeft, paddingRight),
    rect,
    rowGap,
    rowHeight,
    rowStep: rowHeight + rowGap,
    viewportHeight,
    viewportWidth
  };
}

function resolveCanvasBounds(resolvedLayout, metrics) {
  const bounds = {
    maxCol: GRID_BASE_HALF_COLS,
    maxRow: GRID_BASE_HALF_ROWS,
    minCol: -GRID_BASE_HALF_COLS,
    minRow: -GRID_BASE_HALF_ROWS
  };

  Object.entries(resolvedLayout?.positions || {}).forEach(([widgetId, position]) => {
    const renderedSize =
      resolvedLayout?.renderedSizes?.[widgetId] || getRenderedWidgetSize(DEFAULT_WIDGET_SIZE, Boolean(resolvedLayout?.minimizedMap?.[widgetId]));
    const rect = createLogicalRect(position, renderedSize);

    bounds.minCol = Math.min(bounds.minCol, rect.left - GRID_CONTENT_BUFFER_COLS);
    bounds.maxCol = Math.max(bounds.maxCol, rect.right + GRID_CONTENT_BUFFER_COLS);
    bounds.minRow = Math.min(bounds.minRow, rect.top - GRID_CONTENT_BUFFER_ROWS);
    bounds.maxRow = Math.max(bounds.maxRow, rect.bottom + GRID_CONTENT_BUFFER_ROWS);
  });

  const viewportCols = Math.max(1, Math.ceil(metrics.viewportWidth / Math.max(metrics.colStep, 1)));
  const viewportRows = Math.max(1, Math.ceil(metrics.viewportHeight / Math.max(metrics.rowStep, 1)));
  bounds.minCol = Math.min(bounds.minCol, -Math.ceil(viewportCols / 2) - GRID_CONTENT_BUFFER_COLS);
  bounds.maxCol = Math.max(bounds.maxCol, Math.ceil(viewportCols / 2) + GRID_CONTENT_BUFFER_COLS);
  bounds.minRow = Math.min(bounds.minRow, -Math.ceil(viewportRows / 2) - GRID_CONTENT_BUFFER_ROWS);
  bounds.maxRow = Math.max(bounds.maxRow, Math.ceil(viewportRows / 2) + GRID_CONTENT_BUFFER_ROWS);

  return normalizeCanvasBounds(bounds);
}

function getCanvasExtent(count, unitSize, gap, padding) {
  return (padding * 2) + (count * unitSize) + (Math.max(0, count - 1) * gap);
}

function applyGridSurfaceLayout(gridElement, bounds, metrics) {
  gridElement.style.width = `${metrics.viewportWidth}px`;
  gridElement.style.height = `${metrics.viewportHeight}px`;
}

function resolveLogicalContentBounds(resolvedLayout) {
  const bounds = {
    maxCol: 0,
    maxRow: 0,
    minCol: 0,
    minRow: 0
  };
  let hasContent = false;

  Object.entries(resolvedLayout?.positions || {}).forEach(([widgetId, position]) => {
    const renderedSize =
      resolvedLayout?.renderedSizes?.[widgetId] || getRenderedWidgetSize(DEFAULT_WIDGET_SIZE, Boolean(resolvedLayout?.minimizedMap?.[widgetId]));
    const rect = createLogicalRect(position, renderedSize);

    if (!hasContent) {
      bounds.minCol = rect.left;
      bounds.maxCol = rect.right;
      bounds.minRow = rect.top;
      bounds.maxRow = rect.bottom;
      hasContent = true;
      return;
    }

    bounds.minCol = Math.min(bounds.minCol, rect.left);
    bounds.maxCol = Math.max(bounds.maxCol, rect.right);
    bounds.minRow = Math.min(bounds.minRow, rect.top);
    bounds.maxRow = Math.max(bounds.maxRow, rect.bottom);
  });

  return hasContent ? bounds : null;
}

function clampCameraOffsetToContent(cameraOffset, resolvedLayout, metrics) {
  const contentBounds = resolveLogicalContentBounds(resolvedLayout);

  if (!contentBounds) {
    return {
      x: 0,
      y: 0
    };
  }

  const visibleHalfCols = metrics.viewportWidth / (2 * Math.max(metrics.colStep, 1));
  const visibleHalfRows = metrics.viewportHeight / (2 * Math.max(metrics.rowStep, 1));
  const minCenterCol = (contentBounds.minCol - GRID_CAMERA_BUFFER_COLS) + visibleHalfCols;
  const maxCenterCol = (contentBounds.maxCol + GRID_CAMERA_BUFFER_COLS) - visibleHalfCols;
  const minCenterRow = (contentBounds.minRow - GRID_CAMERA_BUFFER_ROWS) + visibleHalfRows;
  const maxCenterRow = (contentBounds.maxRow + GRID_CAMERA_BUFFER_ROWS) - visibleHalfRows;
  const currentCenterCol = -cameraOffset.x / Math.max(metrics.colStep, 1);
  const currentCenterRow = -cameraOffset.y / Math.max(metrics.rowStep, 1);
  const clampedCenterCol = clampNumber(currentCenterCol, minCenterCol, maxCenterCol);
  const clampedCenterRow = clampNumber(currentCenterRow, minCenterRow, maxCenterRow);

  return {
    x: -clampedCenterCol * metrics.colStep,
    y: -clampedCenterRow * metrics.rowStep
  };
}

function getWidgetCardFrame(position, size, bounds, metrics) {
  const normalizedPosition = normalizeWidgetPosition(position, DEFAULT_WIDGET_POSITION);
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  const cameraOffset = activeSpacesStore?.cameraOffsetPx || { x: 0, y: 0 };
  const originX = (metrics.viewportWidth / 2) + cameraOffset.x;
  const originY = (metrics.viewportHeight / 2) + cameraOffset.y;

  return {
    height: (normalizedSize.rows * metrics.rowHeight) + (Math.max(0, normalizedSize.rows - 1) * metrics.rowGap),
    left: originX + (normalizedPosition.col * metrics.colStep),
    top: originY + (normalizedPosition.row * metrics.rowStep),
    width: (normalizedSize.cols * metrics.colWidth) + (Math.max(0, normalizedSize.cols - 1) * metrics.columnGap)
  };
}

function applyWidgetCardFrame(cardElement, frame) {
  cardElement.style.left = `${frame.left}px`;
  cardElement.style.top = `${frame.top}px`;
  cardElement.style.width = `${frame.width}px`;
  cardElement.style.height = `${frame.height}px`;
}

function applyWidgetCardLayout(cardElement, position, size, bounds, metrics) {
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  applyWidgetCardSize(cardElement, normalizedSize);
  applyWidgetCardFrame(cardElement, getWidgetCardFrame(position, normalizedSize, bounds, metrics));
}

function captureWidgetCardRects(widgetCards) {
  const rects = {};

  Object.entries(widgetCards || {}).forEach(([widgetId, skeleton]) => {
    if (!skeleton?.card?.isConnected) {
      return;
    }

    rects[widgetId] = skeleton.card.getBoundingClientRect();
  });

  return rects;
}

function animateWidgetCardsFromRects(widgetCards, previousRects, motionQuery = null) {
  if (!previousRects || motionQuery?.matches) {
    return;
  }

  Object.entries(widgetCards || {}).forEach(([widgetId, skeleton]) => {
    const previousRect = previousRects[widgetId];
    const cardElement = skeleton?.card;

    if (!previousRect || !cardElement?.isConnected) {
      return;
    }

    const nextRect = cardElement.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = nextRect.width > 0 ? previousRect.width / nextRect.width : 1;
    const scaleY = nextRect.height > 0 ? previousRect.height / nextRect.height : 1;
    const hasMotion =
      Math.abs(deltaX) > 0.5 ||
      Math.abs(deltaY) > 0.5 ||
      Math.abs(scaleX - 1) > 0.02 ||
      Math.abs(scaleY - 1) > 0.02;

    if (!hasMotion) {
      cardElement.style.removeProperty("transition");
      cardElement.style.removeProperty("transform");
      return;
    }

    cardElement.style.transition = "none";
    cardElement.style.transformOrigin = "top left";
    cardElement.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
    void cardElement.offsetWidth;
    cardElement.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    cardElement.style.transform = "";

    const cleanup = () => {
      cardElement.style.removeProperty("transition");
      cardElement.removeEventListener("transitionend", cleanup);
    };

    cardElement.addEventListener("transitionend", cleanup, { once: true });
  });
}

function updateCanvasScrollForBoundsChange(canvasElement, previousBounds, nextBounds, metrics) {
  return;
}

function getOriginScrollPosition(bounds, metrics) {
  return {
    left: 0,
    top: 0
  };
}

function autoScrollCanvas(canvasElement, event) {
  activeSpacesStore?.nudgeCameraAtViewportEdge(event);
}

function toggleGridOverlay(gridElement, active, metrics = null, cameraOffset = { x: 0, y: 0 }) {
  if (!gridElement) {
    return;
  }

  gridElement.classList.toggle("is-layout-active", Boolean(active));

  if (!active || !metrics) {
    gridElement.style.removeProperty("--spaces-grid-overlay-col-step");
    gridElement.style.removeProperty("--spaces-grid-overlay-row-step");
    gridElement.style.removeProperty("--spaces-grid-overlay-offset-x");
    gridElement.style.removeProperty("--spaces-grid-overlay-offset-y");
    return;
  }

  const offsetX = positiveModulo((metrics.viewportWidth / 2) + cameraOffset.x, metrics.colStep);
  const offsetY = positiveModulo((metrics.viewportHeight / 2) + cameraOffset.y, metrics.rowStep);
  gridElement.style.setProperty("--spaces-grid-overlay-col-step", `${metrics.colStep}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-row-step", `${metrics.rowStep}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-offset-x", `${offsetX}px`);
  gridElement.style.setProperty("--spaces-grid-overlay-offset-y", `${offsetY}px`);
}

function createWidgetActionButton(className, label, title) {
  const button = createElement("button", className, label);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function getSpaceCardClone(spaceRecord) {
  return {
    ...spaceRecord,
    minimizedWidgetIds: [...spaceRecord.minimizedWidgetIds],
    widgetIds: [...spaceRecord.widgetIds],
    widgetPositions: { ...spaceRecord.widgetPositions },
    widgetSizes: { ...spaceRecord.widgetSizes },
    widgetTitles: { ...spaceRecord.widgetTitles }
  };
}

function buildWidgetHeaderTitle(spaceRecord, widgetId, definition) {
  return (
    spaceRecord.widgetTitles[widgetId] ||
    String(definition?.title || "").trim() ||
    widgetId
      .split(/[-_]+/u)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ")
  );
}

function createWidgetContext(spaceRecord, widgetId, definition, size, layoutEntry) {
  const widgetPath = buildSpaceWidgetFilePath(spaceRecord.id, widgetId);

  return {
    api: globalThis.space.api,
    appFiles: {
      delete: globalThis.space.api.fileDelete.bind(globalThis.space.api),
      info: globalThis.space.api.fileInfo.bind(globalThis.space.api),
      list: globalThis.space.api.fileList.bind(globalThis.space.api),
      read: globalThis.space.api.fileRead.bind(globalThis.space.api),
      write: globalThis.space.api.fileWrite.bind(globalThis.space.api)
    },
    fetchExternal: globalThis.space.fetchExternal?.bind(globalThis.space),
    openSpace: spacesRuntime.openSpace,
    paths: {
      assets: `${buildSpaceRootPath(spaceRecord.id)}assets/`,
      data: `${buildSpaceRootPath(spaceRecord.id)}data/`,
      root: buildSpaceRootPath(spaceRecord.id),
      widget: widgetPath
    },
    primitives,
    reloadSpace: spacesRuntime.reloadCurrentSpace,
    resolveAppUrl,
    router: globalThis.space.router,
    size,
    space: {
      id: spaceRecord.id,
      path: buildSpaceRootPath(spaceRecord.id),
      title: spaceRecord.title,
      updatedAt: spaceRecord.updatedAt
    },
    widget: {
      id: widgetId,
      minimized: Boolean(layoutEntry?.minimized),
      path: widgetPath,
      position: normalizeWidgetPosition(layoutEntry?.position, DEFAULT_WIDGET_POSITION),
      size,
      title: buildWidgetHeaderTitle(spaceRecord, widgetId, definition)
    }
  };
}

function createWidgetCardSkeleton(spaceRecord, widgetId, layoutEntry) {
  const card = createElement("article", "space-card spaces-widget-card");
  const controls = createElement("div", "spaces-widget-card-controls");
  const handle = createWidgetActionButton("spaces-widget-drag-handle", "", "Move widget");
  const grip = createElement("span", "spaces-widget-drag-grip");
  const titleLabel = createElement("span", "spaces-widget-card-title", buildWidgetHeaderTitle(spaceRecord, widgetId));
  const actions = createElement("div", "spaces-widget-card-actions");
  const minimizeButton = createWidgetActionButton(
    "spaces-widget-control-button",
    layoutEntry?.minimized ? "+" : "-",
    layoutEntry?.minimized ? "Restore widget" : "Minimize widget"
  );
  const closeButton = createWidgetActionButton("spaces-widget-control-button", "x", "Remove widget");
  const body = createElement("div", "spaces-widget-card-body");
  const resizeHandle = createWidgetActionButton("spaces-widget-resize-handle", "", "Resize widget");

  handle.append(grip, titleLabel);
  card.dataset.widgetId = widgetId;
  body.appendChild(createWidgetPlaceholder("Loading widget..."));
  controls.append(handle, actions);
  actions.append(minimizeButton, closeButton);
  card.append(controls, body, resizeHandle);

  handle.addEventListener("pointerdown", (event) => {
    activeSpacesStore?.beginWidgetMove(event, widgetId);
  });
  resizeHandle.addEventListener("pointerdown", (event) => {
    activeSpacesStore?.beginWidgetResize(event, widgetId);
  });
  minimizeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void activeSpacesStore?.toggleWidgetMinimized(widgetId);
  });
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void activeSpacesStore?.closeWidget(widgetId);
  });

  return { body, card, minimizeButton, titleLabel };
}

async function loadWidgetDefinition(moduleUrl) {
  const module = await import(moduleUrl);
  const candidate = module?.default ?? module?.widget ?? module;

  if (!candidate || typeof candidate !== "object" || typeof candidate.render !== "function") {
    throw new Error("Widget modules must export a widget definition with a render(ctx) function.");
  }

  return defineWidget(candidate);
}

async function renderWidgetCard(spaceRecord, widgetId, skeleton, cacheToken, loadToken, layoutEntry) {
  const migrationResult = await maybeMigrateLegacyWidgetSource(spaceRecord.id, widgetId);
  const moduleUrl = buildSpaceWidgetModuleUrl(
    spaceRecord.id,
    widgetId,
    migrationResult.migrated ? `${cacheToken}-${Date.now().toString(36)}` : cacheToken
  );
  const definition = await loadWidgetDefinition(moduleUrl);
  const storedSize = spaceRecord.widgetSizes[widgetId] || normalizeWidgetSize(definition.size, DEFAULT_WIDGET_SIZE);
  const size = layoutEntry?.renderedSize || getRenderedWidgetSize(storedSize, Boolean(layoutEntry?.minimized));
  const context = createWidgetContext(spaceRecord, widgetId, definition, size, layoutEntry);

  skeleton.card.classList.toggle("is-minimized", Boolean(layoutEntry?.minimized));
  skeleton.minimizeButton.textContent = layoutEntry?.minimized ? "+" : "-";
  skeleton.minimizeButton.title = layoutEntry?.minimized ? "Restore widget" : "Minimize widget";
  skeleton.minimizeButton.setAttribute("aria-label", skeleton.minimizeButton.title);
  skeleton.titleLabel.textContent = buildWidgetHeaderTitle(spaceRecord, widgetId, definition);

  const loadedData = definition.load ? await definition.load(context) : undefined;
  const rendered = await definition.render({
    ...context,
    data: loadedData
  });

  if (loadToken !== activeSpacesStore?.widgetLoadToken) {
    return;
  }

  renderWidgetOutput(rendered, skeleton.body);
}

const spacesModel = {
  cameraOffsetPx: {
    x: 0,
    y: 0
  },
  creatingSpace: false,
  currentCanvasBounds: null,
  currentSpace: null,
  currentSpaceId: "",
  currentResolvedLayout: null,
  currentSpaceTitleDraft: "",
  emptyCanvasCleanup: null,
  hasCenteredCurrentSpace: false,
  layoutInteraction: null,
  layoutPersistPromise: Promise.resolve(),
  layoutPointerMoveHandler: null,
  layoutPointerUpHandler: null,
  loaded: false,
  loadingList: false,
  loadingSpace: false,
  motionQuery: null,
  noticeText: "",
  noticeTone: "info",
  canvasPointerDownHandler: null,
  refs: {},
  savingTitle: false,
  spaceList: [],
  viewportResizeHandler: null,
  widgetCards: {},
  widgetErrorCount: 0,
  widgetLoadToken: 0,

  mount(refs = {}) {
    this.refs = refs;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.viewportResizeHandler = () => {
      this.handleViewportResize();
    };
    window.addEventListener("resize", this.viewportResizeHandler);
    this.canvasPointerDownHandler = (event) => {
      this.handleCanvasPointerDown(event);
    };
    this.refs.canvas?.addEventListener("pointerdown", this.canvasPointerDownHandler);
    activeSpacesStore = this;
    void this.refreshFromRoute();
  },

  unmount() {
    this.cleanupEmptyCanvas();
    this.cleanupLayoutInteraction({
      restoreLayout: false
    });

    if (activeSpacesStore === this) {
      activeSpacesStore = null;
    }

    this.widgetLoadToken += 1;
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.currentSpace = null;
    this.refs.grid?.replaceChildren();
    this.motionQuery = null;
    this.hasCenteredCurrentSpace = false;

    if (this.viewportResizeHandler) {
      window.removeEventListener("resize", this.viewportResizeHandler);
      this.viewportResizeHandler = null;
    }

    if (this.canvasPointerDownHandler && this.refs.canvas) {
      this.refs.canvas.removeEventListener("pointerdown", this.canvasPointerDownHandler);
      this.canvasPointerDownHandler = null;
    }

    this.widgetCards = {};
    this.refs = {};
  },

  get hasCurrentSpace() {
    return Boolean(this.currentSpace);
  },

  get hasSpaces() {
    return this.spaceList.length > 0;
  },

  get isBusy() {
    return this.loadingList || this.loadingSpace || this.creatingSpace || this.savingTitle;
  },

  get currentSpaceFolderPath() {
    return this.currentSpace ? buildSpaceRootPath(this.currentSpace.id) : "";
  },

  get currentSpaceUpdatedLabel() {
    return this.currentSpace?.updatedAt ? new Date(this.currentSpace.updatedAt).toLocaleString() : "";
  },

  get currentSpaceWidgetCountLabel() {
    const count = this.currentSpace?.widgetIds?.length || 0;
    return `${count} ${count === 1 ? "widget" : "widgets"}`;
  },

  get canSaveTitle() {
    const nextTitle = String(this.currentSpaceTitleDraft || "").trim();
    return Boolean(this.currentSpace && nextTitle && nextTitle !== this.currentSpace.title && !this.savingTitle);
  },

  setNotice(textValue, tone = "info") {
    this.noticeText = String(textValue || "").trim();
    this.noticeTone = tone === "error" ? "error" : "info";
  },

  clearNotice() {
    this.noticeText = "";
    this.noticeTone = "info";
  },

  cleanupEmptyCanvas() {
    if (typeof this.emptyCanvasCleanup === "function") {
      this.emptyCanvasCleanup();
    }

    this.emptyCanvasCleanup = null;
  },

  resolveCurrentSpaceLayout(spaceRecord = this.currentSpace, overrides = {}) {
    if (!spaceRecord) {
      return null;
    }

    return resolveSpaceLayout({
      anchorMinimized: overrides.anchorMinimized,
      anchorPosition: overrides.anchorPosition,
      anchorSize: overrides.anchorSize,
      anchorWidgetId: overrides.anchorWidgetId,
      minimizedWidgetIds: overrides.minimizedWidgetIds ?? spaceRecord.minimizedWidgetIds,
      widgetIds: overrides.widgetIds ?? spaceRecord.widgetIds,
      widgetPositions: overrides.widgetPositions ?? spaceRecord.widgetPositions,
      widgetSizes: overrides.widgetSizes ?? spaceRecord.widgetSizes
    });
  },

  centerCanvasOnOrigin(force = false) {
    if (!this.refs.grid) {
      return;
    }

    if (this.hasCenteredCurrentSpace && !force && this.cameraOffsetPx.x === 0 && this.cameraOffsetPx.y === 0) {
      return;
    }

    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.hasCenteredCurrentSpace = true;
  },

  applyResolvedLayoutToCards(resolvedLayout, spaceRecord = this.currentSpace, options = {}) {
    if (!resolvedLayout || !spaceRecord || !this.refs.grid) {
      return;
    }

    const metrics = readGridMetrics(this.refs.grid);
    const previousRects = options.previousRects || null;

    if (options.centerOrigin) {
      this.centerCanvasOnOrigin(true);
    }

    this.cameraOffsetPx = clampCameraOffsetToContent(this.cameraOffsetPx, resolvedLayout, metrics);

    applyGridSurfaceLayout(this.refs.grid, null, metrics);
    this.currentResolvedLayout = resolvedLayout;
    this.currentCanvasBounds = null;
    spaceRecord.widgetPositions = { ...resolvedLayout.positions };
    spaceRecord.minimizedWidgetIds = spaceRecord.widgetIds.filter((widgetId) => resolvedLayout.minimizedMap[widgetId]);

    spaceRecord.widgetIds.forEach((widgetId) => {
      const skeleton = this.widgetCards[widgetId];

      if (!skeleton) {
        return;
      }

      const renderedSize = resolvedLayout.renderedSizes[widgetId] || getRenderedWidgetSize(spaceRecord.widgetSizes[widgetId]);
      applyWidgetCardLayout(skeleton.card, resolvedLayout.positions[widgetId], renderedSize, null, metrics);
      skeleton.card.classList.toggle("is-minimized", Boolean(resolvedLayout.minimizedMap[widgetId]));
      skeleton.minimizeButton.textContent = resolvedLayout.minimizedMap[widgetId] ? "+" : "-";
      skeleton.minimizeButton.title = resolvedLayout.minimizedMap[widgetId] ? "Restore widget" : "Minimize widget";
      skeleton.minimizeButton.setAttribute("aria-label", skeleton.minimizeButton.title);
      skeleton.card.style.removeProperty("transition");
      skeleton.card.style.removeProperty("transform");
    });

    if (!options.skipAnimation) {
      animateWidgetCardsFromRects(this.widgetCards, previousRects, this.motionQuery);
    }

    toggleGridOverlay(this.refs.grid, Boolean(this.layoutInteraction), metrics, this.cameraOffsetPx);
  },

  cleanupLayoutInteraction(options = {}) {
    const interaction = this.layoutInteraction;

    if (this.layoutPointerMoveHandler) {
      window.removeEventListener("pointermove", this.layoutPointerMoveHandler);
      this.layoutPointerMoveHandler = null;
    }

    if (this.layoutPointerUpHandler) {
      window.removeEventListener("pointerup", this.layoutPointerUpHandler);
      window.removeEventListener("pointercancel", this.layoutPointerUpHandler);
      this.layoutPointerUpHandler = null;
    }

    toggleGridOverlay(this.refs.grid, false);
    this.refs.canvas?.classList.remove("is-panning");

    if (interaction?.widgetId && this.widgetCards[interaction.widgetId]) {
      this.widgetCards[interaction.widgetId].card.classList.remove("is-layout-active");

      if (options.clearPreview !== false) {
        this.widgetCards[interaction.widgetId].card.style.removeProperty("transform");
      }
    }

    this.layoutInteraction = null;

    if (options.restoreLayout !== false && this.currentResolvedLayout && this.currentSpace) {
      this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace);
    }
  },

  handleCanvasPointerDown(event) {
    if (event.button !== 0 || !this.currentSpace?.widgetIds?.length) {
      return;
    }

    if (event.target?.closest(".spaces-widget-card, .spaces-empty-canvas-example, .spaces-canvas-debug-button")) {
      return;
    }

    if (event.target !== this.refs.canvas && event.target !== this.refs.grid) {
      return;
    }

    this.beginCanvasPan(event);
  },

  beginCanvasPan(event) {
    if (!this.refs.canvas || !this.refs.grid) {
      return;
    }

    event.preventDefault();
    this.cleanupLayoutInteraction();

    const gridMetrics = readGridMetrics(this.refs.grid);
    this.refs.canvas.classList.add("is-panning");
    toggleGridOverlay(this.refs.grid, true, gridMetrics, this.cameraOffsetPx);

    this.layoutInteraction = {
      gridMetrics,
      pointerId: event.pointerId,
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "pan"
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  nudgeCameraAtViewportEdge(event) {
    if (!this.refs.canvas || !this.refs.grid) {
      return;
    }

    const rect = this.refs.canvas.getBoundingClientRect();
    const computeDelta = (distancePastEdge) => {
      const ratio = Math.min(1, Math.max(0, distancePastEdge / GRID_EDGE_SCROLL_THRESHOLD));
      return Math.max(0, Math.round(ratio * ratio * GRID_EDGE_SCROLL_SPEED));
    };
    let deltaX = 0;
    let deltaY = 0;

    if (event.clientX < rect.left + GRID_EDGE_SCROLL_THRESHOLD) {
      deltaX = computeDelta(rect.left + GRID_EDGE_SCROLL_THRESHOLD - event.clientX);
    } else if (event.clientX > rect.right - GRID_EDGE_SCROLL_THRESHOLD) {
      deltaX = -computeDelta(event.clientX - (rect.right - GRID_EDGE_SCROLL_THRESHOLD));
    }

    if (event.clientY < rect.top + GRID_EDGE_SCROLL_THRESHOLD) {
      deltaY = computeDelta(rect.top + GRID_EDGE_SCROLL_THRESHOLD - event.clientY);
    } else if (event.clientY > rect.bottom - GRID_EDGE_SCROLL_THRESHOLD) {
      deltaY = -computeDelta(event.clientY - (rect.bottom - GRID_EDGE_SCROLL_THRESHOLD));
    }

    if (!deltaX && !deltaY) {
      return;
    }

    const nextCameraOffset = {
      x: this.cameraOffsetPx.x + deltaX,
      y: this.cameraOffsetPx.y + deltaY
    };
    const metrics = readGridMetrics(this.refs.grid);
    this.cameraOffsetPx = clampCameraOffsetToContent(nextCameraOffset, this.currentResolvedLayout, metrics);

    if (this.currentResolvedLayout && this.currentSpace) {
      this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace, {
        skipAnimation: true
      });
    }
  },

  handleViewportResize() {
    if (!this.currentResolvedLayout || !this.currentSpace || !this.refs.grid) {
      return;
    }

    this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace, {
      skipAnimation: true
    });
  },

  beginWidgetMove(event, widgetId) {
    if (event.button !== 0 || !this.currentSpace || !this.refs.grid) {
      return;
    }

    const resolvedLayout = this.currentResolvedLayout || this.resolveCurrentSpaceLayout();
    const layoutPosition = resolvedLayout?.positions?.[widgetId];
    const layoutSize = resolvedLayout?.renderedSizes?.[widgetId];

    if (!layoutPosition || !layoutSize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cleanupLayoutInteraction();

    const gridMetrics = readGridMetrics(this.refs.grid);
    const skeleton = this.widgetCards[widgetId];

    if (!skeleton) {
      return;
    }

    skeleton.card.classList.add("is-layout-active");
    skeleton.card.style.removeProperty("transition");
    toggleGridOverlay(this.refs.grid, true, gridMetrics, this.cameraOffsetPx);

    this.layoutInteraction = {
      gridMetrics,
      originPosition: layoutPosition,
      pointerId: event.pointerId,
      previewPosition: layoutPosition,
      renderedSize: layoutSize,
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "move",
      widgetId
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  beginWidgetResize(event, widgetId) {
    if (event.button !== 0 || !this.currentSpace || !this.refs.grid || this.currentSpace.minimizedWidgetIds.includes(widgetId)) {
      return;
    }

    const resolvedLayout = this.currentResolvedLayout || this.resolveCurrentSpaceLayout();
    const layoutPosition = resolvedLayout?.positions?.[widgetId];
    const storedSize = this.currentSpace.widgetSizes[widgetId] || DEFAULT_WIDGET_SIZE;

    if (!layoutPosition || !storedSize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cleanupLayoutInteraction();

    const gridMetrics = readGridMetrics(this.refs.grid);
    const skeleton = this.widgetCards[widgetId];

    if (!skeleton) {
      return;
    }

    skeleton.card.classList.add("is-layout-active");
    skeleton.card.style.removeProperty("transition");
    toggleGridOverlay(this.refs.grid, true, gridMetrics, this.cameraOffsetPx);

    const originFrame = getWidgetCardFrame(layoutPosition, storedSize, this.currentCanvasBounds, gridMetrics);

    this.layoutInteraction = {
      gridMetrics,
      originFrame,
      originPosition: layoutPosition,
      originSize: normalizeWidgetSize(storedSize, DEFAULT_WIDGET_SIZE),
      pointerId: event.pointerId,
      previewSize: normalizeWidgetSize(storedSize, DEFAULT_WIDGET_SIZE),
      startCameraOffset: { ...this.cameraOffsetPx },
      startX: event.clientX,
      startY: event.clientY,
      type: "resize",
      widgetId
    };

    this.layoutPointerMoveHandler = (nextEvent) => {
      this.handleLayoutPointerMove(nextEvent);
    };
    this.layoutPointerUpHandler = (nextEvent) => {
      void this.handleLayoutPointerUp(nextEvent);
    };
    window.addEventListener("pointermove", this.layoutPointerMoveHandler);
    window.addEventListener("pointerup", this.layoutPointerUpHandler);
    window.addEventListener("pointercancel", this.layoutPointerUpHandler);
  },

  handleLayoutPointerMove(event) {
    const interaction = this.layoutInteraction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    event.preventDefault();

    if (interaction.type === "pan") {
      const nextCameraOffset = {
        x: interaction.startCameraOffset.x + (event.clientX - interaction.startX),
        y: interaction.startCameraOffset.y + (event.clientY - interaction.startY)
      };
      this.cameraOffsetPx = clampCameraOffsetToContent(nextCameraOffset, this.currentResolvedLayout, interaction.gridMetrics);

      if (this.currentResolvedLayout && this.currentSpace) {
        this.applyResolvedLayoutToCards(this.currentResolvedLayout, this.currentSpace, {
          skipAnimation: true
        });
      }

      return;
    }

    autoScrollCanvas(this.refs.canvas, event);
    const skeleton = this.widgetCards[interaction.widgetId];

    if (!skeleton) {
      return;
    }

    const cameraDeltaX = this.cameraOffsetPx.x - interaction.startCameraOffset.x;
    const cameraDeltaY = this.cameraOffsetPx.y - interaction.startCameraOffset.y;
    const deltaX = (event.clientX - interaction.startX) - cameraDeltaX;
    const deltaY = (event.clientY - interaction.startY) - cameraDeltaY;

    if (interaction.type === "move") {
      const previewPosition = clampWidgetPosition(
        {
          col: interaction.originPosition.col + Math.round(deltaX / Math.max(interaction.gridMetrics.colStep, 1)),
          row: interaction.originPosition.row + Math.round(deltaY / Math.max(interaction.gridMetrics.rowStep, 1))
        },
        interaction.renderedSize
      );

      interaction.previewPosition = previewPosition;
      skeleton.card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      return;
    }

    const minWidth = interaction.gridMetrics.colWidth;
    const minHeight = interaction.gridMetrics.rowHeight;
    const maxWidth = (MAX_WIDGET_COLS * interaction.gridMetrics.colWidth) + (Math.max(0, MAX_WIDGET_COLS - 1) * interaction.gridMetrics.columnGap);
    const maxHeight = (MAX_WIDGET_ROWS * interaction.gridMetrics.rowHeight) + (Math.max(0, MAX_WIDGET_ROWS - 1) * interaction.gridMetrics.rowGap);
    const previewWidth = Math.min(maxWidth, Math.max(minWidth, interaction.originFrame.width + deltaX));
    const previewHeight = Math.min(maxHeight, Math.max(minHeight, interaction.originFrame.height + deltaY));
    const previewSize = normalizeWidgetSize(
      {
        cols: Math.min(MAX_WIDGET_COLS, Math.max(1, Math.round((previewWidth + interaction.gridMetrics.columnGap) / Math.max(interaction.gridMetrics.colStep, 1)))),
        rows: Math.min(MAX_WIDGET_ROWS, Math.max(1, Math.round((previewHeight + interaction.gridMetrics.rowGap) / Math.max(interaction.gridMetrics.rowStep, 1))))
      },
      interaction.originSize
    );

    interaction.previewSize = previewSize;
    skeleton.card.style.width = `${previewWidth}px`;
    skeleton.card.style.height = `${previewHeight}px`;
  },

  async handleLayoutPointerUp(event) {
    const interaction = this.layoutInteraction;

    if (!interaction || event.pointerId !== interaction.pointerId) {
      return;
    }

    if (interaction.type === "pan") {
      this.cleanupLayoutInteraction({
        restoreLayout: false
      });
      return;
    }

    const widgetId = interaction.widgetId;
    const positionChanged =
      interaction.type === "move" &&
      (interaction.previewPosition.col !== interaction.originPosition.col ||
        interaction.previewPosition.row !== interaction.originPosition.row);
    const sizeChanged =
      interaction.type === "resize" &&
      (interaction.previewSize.cols !== interaction.originSize.cols ||
        interaction.previewSize.rows !== interaction.originSize.rows);

    if (positionChanged) {
      const previousRects = captureWidgetCardRects(this.widgetCards);
      this.cleanupLayoutInteraction({
        clearPreview: false,
        restoreLayout: false
      });
      await this.commitWidgetLayout(widgetId, {
        position: interaction.previewPosition
      }, {
        previousRects
      });
      return;
    }

    if (sizeChanged) {
      const previousRects = captureWidgetCardRects(this.widgetCards);
      this.cleanupLayoutInteraction({
        clearPreview: false,
        restoreLayout: false
      });
      await this.commitWidgetLayout(widgetId, {
        size: interaction.previewSize
      }, {
        previousRects
      });
      return;
    }

    this.cleanupLayoutInteraction();
  },

  async commitWidgetLayout(widgetId, changes = {}, options = {}) {
    if (!this.currentSpace) {
      return;
    }

    const nextSpace = getSpaceCardClone(this.currentSpace);
    const previousRects = options.previousRects || captureWidgetCardRects(this.widgetCards);

    if (changes.position !== undefined) {
      nextSpace.widgetPositions[widgetId] = normalizeWidgetPosition(
        changes.position,
        nextSpace.widgetPositions[widgetId] || DEFAULT_WIDGET_POSITION
      );
    }

    if (changes.size !== undefined) {
      nextSpace.widgetSizes[widgetId] = normalizeWidgetSize(
        changes.size,
        nextSpace.widgetSizes[widgetId] || DEFAULT_WIDGET_SIZE
      );
    }

    if (changes.minimized !== undefined) {
      const nextMinimized = new Set(nextSpace.minimizedWidgetIds);

      if (changes.minimized) {
        nextMinimized.add(widgetId);
      } else {
        nextMinimized.delete(widgetId);
      }

      nextSpace.minimizedWidgetIds = [...nextMinimized];
    }

    const resolvedLayout = this.resolveCurrentSpaceLayout(nextSpace, {
      anchorMinimized: changes.minimized,
      anchorPosition: changes.position,
      anchorSize: changes.size,
      anchorWidgetId: widgetId,
      minimizedWidgetIds: nextSpace.minimizedWidgetIds,
      widgetPositions: nextSpace.widgetPositions,
      widgetSizes: nextSpace.widgetSizes
    });

    nextSpace.widgetPositions = { ...resolvedLayout.positions };
    nextSpace.minimizedWidgetIds = nextSpace.widgetIds.filter((entry) => resolvedLayout.minimizedMap[entry]);
    this.currentSpace = nextSpace;
    this.applyResolvedLayoutToCards(resolvedLayout, nextSpace, {
      previousRects
    });
    void this.persistLayoutSnapshot(nextSpace);
  },

  persistLayoutSnapshot(spaceSnapshot) {
    const snapshot = getSpaceCardClone(spaceSnapshot);
    const enqueue = this.layoutPersistPromise
      .catch(() => {})
      .then(async () => {
        const savedSpace = await saveSpaceLayout({
          id: snapshot.id,
          minimizedWidgetIds: snapshot.minimizedWidgetIds,
          widgetIds: snapshot.widgetIds,
          widgetPositions: snapshot.widgetPositions,
          widgetSizes: snapshot.widgetSizes
        });

        if (this.currentSpace?.id === savedSpace.id) {
          this.currentSpace.updatedAt = savedSpace.updatedAt;
          await this.loadSpacesList();
        }
      })
      .catch((error) => {
        logSpacesError("persistLayoutSnapshot failed", error, {
          spaceId: snapshot.id
        });
        this.setNotice(formatErrorMessage(error, "Unable to persist widget layout."), "error");

        if (this.currentSpace?.id === snapshot.id) {
          void this.loadCurrentSpace(snapshot.id);
        }
      });

    this.layoutPersistPromise = enqueue;
    return enqueue;
  },

  async toggleWidgetMinimized(widgetId) {
    if (!this.currentSpace) {
      return;
    }

    const isMinimized = this.currentSpace.minimizedWidgetIds.includes(widgetId);
    await this.commitWidgetLayout(widgetId, {
      minimized: !isMinimized
    });
  },

  async closeWidget(widgetId) {
    if (!this.currentSpace) {
      return;
    }

    try {
      await removeWidget({
        spaceId: this.currentSpace.id,
        widgetId
      });
      await this.handleExternalMutation(this.currentSpace.id);
    } catch (error) {
      logSpacesError("closeWidget failed", error, {
        spaceId: this.currentSpace.id,
        widgetId
      });
      this.setNotice(formatErrorMessage(error, `Unable to remove widget "${widgetId}".`), "error");
    }
  },

  async consolidateCurrentSpace() {
    if (!this.currentSpace?.widgetIds?.length) {
      return;
    }

    const previousRects = captureWidgetCardRects(this.widgetCards);
    const nextSpace = getSpaceCardClone(this.currentSpace);
    const orderedEntries = nextSpace.widgetIds.map((widgetId) => ({
      size: normalizeWidgetSize(nextSpace.widgetSizes[widgetId] || DEFAULT_WIDGET_SIZE, DEFAULT_WIDGET_SIZE),
      widgetId
    }));
    const totalCols = orderedEntries.reduce((sum, entry) => sum + entry.size.cols, 0);
    let cursor = -Math.floor(totalCols / 2);
    const positions = {};

    orderedEntries.forEach((entry) => {
      positions[entry.widgetId] = {
        col: cursor,
        row: 0
      };
      cursor += entry.size.cols;
    });

    nextSpace.widgetPositions = positions;
    nextSpace.minimizedWidgetIds = [];
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };

    const resolvedLayout = this.resolveCurrentSpaceLayout(nextSpace, {
      minimizedWidgetIds: nextSpace.minimizedWidgetIds,
      widgetPositions: nextSpace.widgetPositions,
      widgetSizes: nextSpace.widgetSizes
    });

    nextSpace.widgetPositions = { ...resolvedLayout.positions };
    nextSpace.minimizedWidgetIds = [];
    this.currentSpace = nextSpace;
    this.applyResolvedLayoutToCards(resolvedLayout, nextSpace, {
      previousRects
    });
    void this.persistLayoutSnapshot(nextSpace);
  },

  buildNextSpaceTitle() {
    const baseTitle = "Untitled Space";
    const existingTitles = new Set(this.spaceList.map((spaceRecord) => String(spaceRecord.title || "")));

    if (!existingTitles.has(baseTitle)) {
      return baseTitle;
    }

    let suffix = 2;

    while (existingTitles.has(`${baseTitle} ${suffix}`)) {
      suffix += 1;
    }

    return `${baseTitle} ${suffix}`;
  },

  async loadSpacesList() {
    this.loadingList = true;

    try {
      this.spaceList = await listSpaces();
      this.loaded = true;
    } finally {
      this.loadingList = false;
    }
  },

  async refreshFromRoute() {
    try {
      await this.loadSpacesList();

      const routeId = normalizeOptionalSpaceId(globalThis.space.router?.getParam("id", "") || "");
      const wantsNewSpace = isTruthyRouteParam(globalThis.space.router?.getParam("new", ""));

      if (wantsNewSpace) {
        await this.createSpaceFromRoute();
        return;
      }

      if (routeId) {
        await this.loadCurrentSpace(routeId);
        return;
      }

      if (this.spaceList.length > 0) {
        await spacesRuntime.openSpace(this.spaceList[0].id, { replace: true });
        return;
      }

      this.currentSpace = null;
      this.currentSpaceId = "";
      this.currentSpaceTitleDraft = "";
      this.renderGridState("No spaces yet.", "Create a space to start building persisted widgets.");
    } catch (error) {
      logSpacesError("refreshFromRoute failed", error);
      this.currentSpace = null;
      this.currentSpaceId = "";
      this.currentSpaceTitleDraft = "";
      this.renderGridState("Unable to load spaces.", formatErrorMessage(error, "Unknown spaces error."), "error");
      this.setNotice(formatErrorMessage(error, "Unable to load spaces."), "error");
    }
  },

  async createSpaceFromRoute() {
    if (this.creatingSpace) {
      return;
    }

    this.creatingSpace = true;

    try {
      const createdSpace = await createSpace({
        title: this.buildNextSpaceTitle()
      });

      await this.loadSpacesList();
      await spacesRuntime.openSpace(createdSpace.id, { replace: true });
    } catch (error) {
      logSpacesError("createSpaceFromRoute failed", error);
      this.setNotice(formatErrorMessage(error, "Unable to create a new space."), "error");
      this.renderGridState("Unable to create space.", formatErrorMessage(error, "Unknown create error."), "error");
    } finally {
      this.creatingSpace = false;
    }
  },

  async createSpaceFromUi() {
    if (this.creatingSpace) {
      return;
    }

    this.creatingSpace = true;

    try {
      const createdSpace = await createSpace({
        title: this.buildNextSpaceTitle()
      });

      await spacesRuntime.openSpace(createdSpace.id);
    } catch (error) {
      logSpacesError("createSpaceFromUi failed", error);
      this.setNotice(formatErrorMessage(error, "Unable to create a new space."), "error");
    } finally {
      this.creatingSpace = false;
    }
  },

  async selectSpace(spaceId) {
    if (!spaceId || spaceId === this.currentSpaceId) {
      return;
    }

    await spacesRuntime.openSpace(spaceId);
  },

  renderGridState(titleValue, bodyValue, tone = "info") {
    if (!this.refs.grid) {
      return;
    }

    this.cleanupEmptyCanvas();
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.widgetCards = {};
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.hasCenteredCurrentSpace = false;
    this.refs.grid.style.removeProperty("width");
    this.refs.grid.style.removeProperty("height");
    this.refs.grid.replaceChildren(createGridStateCard(titleValue, bodyValue, tone));
  },

  async loadCurrentSpace(spaceId) {
    this.loadingSpace = true;
    this.widgetLoadToken += 1;
    const loadToken = this.widgetLoadToken;
    this.currentSpaceId = spaceId;
    this.currentSpace = null;
    this.cameraOffsetPx = {
      x: 0,
      y: 0
    };
    this.currentCanvasBounds = null;
    this.currentResolvedLayout = null;
    this.currentSpaceTitleDraft = "";
    this.hasCenteredCurrentSpace = false;
    this.widgetCards = {};
    this.widgetErrorCount = 0;
    this.renderGridState("Loading space...", `Reading ${buildSpaceRootPath(spaceId)} and replaying its widgets.`);

    try {
      const spaceRecord = await readSpace(spaceId);

      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.currentSpace = spaceRecord;
      this.currentSpaceId = spaceRecord.id;
      this.currentSpaceTitleDraft = spaceRecord.title;
      await this.renderCurrentSpace(spaceRecord, loadToken);
    } catch (error) {
      if (loadToken !== this.widgetLoadToken) {
        return;
      }

      this.currentSpace = null;
      this.currentSpaceTitleDraft = "";
      this.renderGridState(
        "Unable to open this space.",
        formatErrorMessage(error, "The requested space could not be loaded."),
        "error"
      );
      logSpacesError("loadCurrentSpace failed", error, { spaceId });
      this.setNotice(formatErrorMessage(error, "Unable to open this space."), "error");
    } finally {
      if (loadToken === this.widgetLoadToken) {
        this.loadingSpace = false;
      }
    }
  },

  async renderCurrentSpace(spaceRecord, loadToken) {
    const grid = this.refs.grid;

    if (!grid) {
      return;
    }

    this.cleanupEmptyCanvas();
    this.widgetCards = {};
    grid.replaceChildren();

    if (!spaceRecord.widgetIds.length) {
      const emptyCanvas = createEmptyCanvasState();

      this.currentCanvasBounds = null;
      this.currentResolvedLayout = null;
      this.hasCenteredCurrentSpace = false;
      grid.style.removeProperty("width");
      grid.style.removeProperty("height");
      grid.appendChild(emptyCanvas.root);
      this.emptyCanvasCleanup = startFloatingTitleAnimation(emptyCanvas.title, this.motionQuery);
      return;
    }

    const cacheToken = `${Date.now().toString(36)}-${spaceRecord.updatedAt}`;
    const resolvedLayout = this.resolveCurrentSpaceLayout(spaceRecord);
    const renderJobs = spaceRecord.widgetIds.map(async (widgetId) => {
      const layoutEntry = {
        minimized: Boolean(resolvedLayout.minimizedMap[widgetId]),
        position: resolvedLayout.positions[widgetId],
        renderedSize: resolvedLayout.renderedSizes[widgetId]
      };
      const skeleton = createWidgetCardSkeleton(spaceRecord, widgetId, layoutEntry);
      this.widgetCards[widgetId] = skeleton;
      grid.appendChild(skeleton.card);

      try {
        await renderWidgetCard(spaceRecord, widgetId, skeleton, cacheToken, loadToken, layoutEntry);
      } catch (error) {
        if (loadToken !== this.widgetLoadToken) {
          return;
        }

        logSpacesError("renderWidgetCard failed", error, {
          spaceId: spaceRecord.id,
          widgetId
        });
        this.widgetErrorCount += 1;
        skeleton.body.replaceChildren(
          createWidgetPlaceholder(formatErrorMessage(error, `Unable to render widget "${widgetId}".`))
        );
        skeleton.card.classList.add("is-error");
      }
    });

    this.applyResolvedLayoutToCards(resolvedLayout, spaceRecord, {
      centerOrigin: true
    });
    await Promise.allSettled(renderJobs);
  },

  async saveCurrentTitle() {
    if (!this.canSaveTitle) {
      return;
    }

    this.savingTitle = true;

    try {
      await saveSpaceMeta({
        id: this.currentSpaceId,
        title: this.currentSpaceTitleDraft.trim()
      });
      await this.handleExternalMutation(this.currentSpaceId);
      this.setNotice("Space title saved.");
    } catch (error) {
      logSpacesError("saveCurrentTitle failed", error, {
        spaceId: this.currentSpaceId
      });
      this.setNotice(formatErrorMessage(error, "Unable to save the current space title."), "error");
    } finally {
      this.savingTitle = false;
    }
  },

  async reloadCurrentSpace() {
    await this.handleExternalMutation(this.currentSpaceId);
  },

  async handleRemovedSpace(spaceId) {
    await this.loadSpacesList();

    if (!spaceId || this.currentSpaceId !== spaceId) {
      return;
    }

    this.currentSpace = null;
    this.currentSpaceId = "";
    this.currentSpaceTitleDraft = "";

    if (this.spaceList.length > 0) {
      await globalThis.space.router?.replaceTo(SPACES_ROUTE_PATH, {
        params: {
          id: this.spaceList[0].id
        }
      });
      return;
    }

    if (globalThis.space.router) {
      await globalThis.space.router.replaceTo(SPACES_ROUTE_PATH);
      return;
    }

    this.renderGridState("No spaces yet.", "Create a space to start building persisted widgets.");
  },

  async handleExternalMutation(spaceId) {
    await this.loadSpacesList();

    if (spaceId && this.currentSpaceId === spaceId) {
      await this.loadCurrentSpace(spaceId);
    }
  },

  async refreshFromUi() {
    this.clearNotice();
    await this.reloadCurrentSpace();
  }
};

space.fw.createStore(SPACES_STORE_NAME, spacesModel);
