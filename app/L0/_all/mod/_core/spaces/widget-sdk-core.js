import {
  DEFAULT_WIDGET_SIZE,
  MAX_WIDGET_COLS,
  MAX_WIDGET_ROWS,
  WIDGET_API_VERSION,
  WIDGET_SIZE_PRESETS
} from "/mod/_core/spaces/constants.js";

const PRIMITIVE_FLAG = "__spaceWidgetPrimitive";
const WIDGET_FLAG = "__spaceWidgetDefinition";

function clampInteger(value, min, max, fallback) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsedValue));
}

function coerceSizeObject(size, fallbackSize = DEFAULT_WIDGET_SIZE) {
  return {
    cols: clampInteger(size?.cols ?? size?.width, 1, MAX_WIDGET_COLS, fallbackSize.cols),
    rows: clampInteger(size?.rows ?? size?.height, 1, MAX_WIDGET_ROWS, fallbackSize.rows)
  };
}

function resolveFallbackSize(fallback) {
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return coerceSizeObject(fallback, DEFAULT_WIDGET_SIZE);
  }

  if (typeof fallback === "string" || Array.isArray(fallback)) {
    return normalizeWidgetSize(fallback, DEFAULT_WIDGET_SIZE);
  }

  return {
    cols: DEFAULT_WIDGET_SIZE.cols,
    rows: DEFAULT_WIDGET_SIZE.rows
  };
}

function normalizeChildren(children) {
  if (children === undefined || children === null) {
    return [];
  }

  const rawChildren = Array.isArray(children) ? children : [children];
  return rawChildren.flatMap((child) => {
    if (Array.isArray(child)) {
      return normalizeChildren(child);
    }

    return child === undefined || child === null || child === false ? [] : [child];
  });
}

function createPrimitive(kind, props = {}, children = []) {
  return {
    [PRIMITIVE_FLAG]: true,
    children: normalizeChildren(children),
    kind,
    props: { ...props }
  };
}

export function isWidgetPrimitive(value) {
  return Boolean(value?.[PRIMITIVE_FLAG]);
}

export function isWidgetDefinition(value) {
  return Boolean(value?.[WIDGET_FLAG]);
}

export function sizeToToken(size, fallback = DEFAULT_WIDGET_SIZE) {
  const normalizedSize = normalizeWidgetSize(size, fallback);
  return `${normalizedSize.cols}x${normalizedSize.rows}`;
}

export function normalizeWidgetSize(size, fallback = DEFAULT_WIDGET_SIZE) {
  if (typeof size === "string") {
    const normalizedKey = size.trim().toLowerCase();

    if (WIDGET_SIZE_PRESETS[normalizedKey]) {
      return {
        cols: WIDGET_SIZE_PRESETS[normalizedKey].cols,
        preset: normalizedKey,
        rows: WIDGET_SIZE_PRESETS[normalizedKey].rows
      };
    }

    const tokenMatch = normalizedKey.match(/^(\d+)\s*x\s*(\d+)$/u);

    if (tokenMatch) {
      return normalizeWidgetSize(
        {
          cols: tokenMatch[1],
          rows: tokenMatch[2]
        },
        fallback
      );
    }
  }

  if (Array.isArray(size) && size.length >= 2) {
    return normalizeWidgetSize(
      {
        cols: size[0],
        rows: size[1]
      },
      fallback
    );
  }

  if (size && typeof size === "object") {
    return coerceSizeObject(size, resolveFallbackSize(fallback));
  }

  if (fallback !== DEFAULT_WIDGET_SIZE) {
    return normalizeWidgetSize(fallback, DEFAULT_WIDGET_SIZE);
  }

  return {
    cols: DEFAULT_WIDGET_SIZE.cols,
    rows: DEFAULT_WIDGET_SIZE.rows
  };
}

export function parseWidgetSizeToken(value, fallback = DEFAULT_WIDGET_SIZE) {
  const tokenMatch = String(value || "")
    .trim()
    .match(/^(\d+)\s*x\s*(\d+)$/u);

  if (!tokenMatch) {
    return normalizeWidgetSize(fallback, DEFAULT_WIDGET_SIZE);
  }

  return normalizeWidgetSize(
    {
      cols: tokenMatch[1],
      rows: tokenMatch[2]
    },
    fallback
  );
}

export function defineWidget(definition = {}) {
  if (!definition || typeof definition !== "object") {
    throw new Error("Widget definitions must be objects.");
  }

  if (definition.apiVersion !== undefined && Number(definition.apiVersion) !== WIDGET_API_VERSION) {
    throw new Error(
      `Unsupported widget apiVersion "${definition.apiVersion}". Expected ${WIDGET_API_VERSION}.`
    );
  }

  if (typeof definition.render !== "function") {
    throw new Error("Widget definitions must provide a render(ctx) function.");
  }

  if (definition.load !== undefined && typeof definition.load !== "function") {
    throw new Error("Widget load must be a function when provided.");
  }

  return Object.freeze({
    [WIDGET_FLAG]: true,
    apiVersion: WIDGET_API_VERSION,
    load: definition.load,
    render: definition.render,
    size: normalizeWidgetSize(definition.size ?? definition.defaultSize ?? DEFAULT_WIDGET_SIZE),
    title: String(definition.title || "").trim()
  });
}

export function fragment(children = []) {
  return createPrimitive("fragment", {}, children);
}

export function stack(childrenOrOptions = [], options = {}) {
  if (!Array.isArray(childrenOrOptions) && typeof childrenOrOptions === "object" && childrenOrOptions) {
    return createPrimitive("stack", childrenOrOptions, childrenOrOptions.children || []);
  }

  return createPrimitive("stack", options, childrenOrOptions);
}

export function group(childrenOrOptions = [], options = {}) {
  if (!Array.isArray(childrenOrOptions) && typeof childrenOrOptions === "object" && childrenOrOptions) {
    return createPrimitive("group", childrenOrOptions, childrenOrOptions.children || []);
  }

  return createPrimitive("group", options, childrenOrOptions);
}

export function text(options = {}) {
  return createPrimitive("text", options);
}

export function metric(options = {}) {
  return createPrimitive("metric", options);
}

export function list(options = {}) {
  return createPrimitive("list", options);
}

export function keyValue(options = {}) {
  return createPrimitive("keyValue", options);
}

export function table(options = {}) {
  return createPrimitive("table", options);
}

export function markdown(sourceOrOptions = "", options = {}) {
  if (typeof sourceOrOptions === "object" && sourceOrOptions) {
    return createPrimitive("markdown", sourceOrOptions);
  }

  return createPrimitive("markdown", {
    ...options,
    source: sourceOrOptions
  });
}

export function rawHtml(htmlOrOptions = "", options = {}) {
  if (typeof htmlOrOptions === "object" && htmlOrOptions) {
    return createPrimitive("rawHtml", htmlOrOptions);
  }

  return createPrimitive("rawHtml", {
    ...options,
    html: htmlOrOptions
  });
}

export const html = rawHtml;

export function notice(options = {}) {
  return createPrimitive("notice", options);
}

export { DEFAULT_WIDGET_SIZE };

export const primitives = Object.freeze({
  fragment,
  group,
  html,
  keyValue,
  list,
  markdown,
  metric,
  notice,
  rawHtml,
  stack,
  table,
  text
});
