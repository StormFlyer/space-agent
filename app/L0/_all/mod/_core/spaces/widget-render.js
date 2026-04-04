import { marked } from "/mod/_core/framework/js/marked.esm.js";
import { isWidgetPrimitive } from "/mod/_core/spaces/widget-sdk-core.js";

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text) {
    element.textContent = text;
  }

  return element;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => (row && typeof row === "object" && !Array.isArray(row) ? row : null))
    .filter(Boolean);
}

function renderChildren(children, parent) {
  children.forEach((child) => {
    parent.appendChild(renderWidgetNode(child));
  });
}

function renderPrimitiveText(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-text");

  if (props.eyebrow) {
    root.appendChild(createElement("p", "spaces-primitive-eyebrow", String(props.eyebrow)));
  }

  if (props.title) {
    root.appendChild(createElement("h3", "spaces-primitive-title", String(props.title)));
  }

  const bodyValues = Array.isArray(props.body) ? props.body : props.body ? [props.body] : [];

  bodyValues.forEach((bodyValue) => {
    root.appendChild(createElement("p", "spaces-primitive-body", String(bodyValue)));
  });

  return root;
}

function renderPrimitiveMetric(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-metric");

  if (props.label) {
    root.appendChild(createElement("p", "spaces-primitive-metric-label", String(props.label)));
  }

  root.appendChild(createElement("p", "spaces-primitive-metric-value", String(props.value ?? "")));

  if (props.detail) {
    root.appendChild(createElement("p", "spaces-primitive-metric-detail", String(props.detail)));
  }

  return root;
}

function renderPrimitiveList(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-list");
  const items = Array.isArray(props.items) ? props.items : [];

  if (props.title) {
    root.appendChild(createElement("h3", "spaces-primitive-section-title", String(props.title)));
  }

  if (!items.length) {
    root.appendChild(createElement("p", "spaces-primitive-empty-copy", String(props.emptyText || "No items.")));
    return root;
  }

  const listElement = createElement(props.ordered ? "ol" : "ul", "spaces-primitive-list-items");

  items.forEach((item) => {
    const listItem = createElement("li", "spaces-primitive-list-item");

    if (item && typeof item === "object" && !Array.isArray(item)) {
      const label = String(item.label ?? item.title ?? "");
      const detail = String(item.detail ?? item.value ?? "");

      if (label) {
        listItem.appendChild(createElement("span", "spaces-primitive-list-label", label));
      }

      if (detail) {
        listItem.appendChild(createElement("span", "spaces-primitive-list-detail", detail));
      }
    } else {
      listItem.textContent = String(item ?? "");
    }

    listElement.appendChild(listItem);
  });

  root.appendChild(listElement);
  return root;
}

function renderPrimitiveKeyValue(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-key-value");
  const rows = normalizeRows(props.rows);

  if (props.title) {
    root.appendChild(createElement("h3", "spaces-primitive-section-title", String(props.title)));
  }

  if (!rows.length) {
    root.appendChild(createElement("p", "spaces-primitive-empty-copy", String(props.emptyText || "No values.")));
    return root;
  }

  const descriptionList = createElement("dl", "spaces-primitive-key-value-list");

  rows.forEach((row) => {
    descriptionList.appendChild(createElement("dt", "spaces-primitive-key", String(row.key ?? row.label ?? "")));
    descriptionList.appendChild(createElement("dd", "spaces-primitive-value", String(row.value ?? "")));
  });

  root.appendChild(descriptionList);
  return root;
}

function normalizeTableColumns(columns, rows) {
  if (Array.isArray(columns) && columns.length) {
    return columns.map((column) =>
      typeof column === "string"
        ? { key: column, label: column }
        : {
            key: String(column?.key || column?.label || "").trim(),
            label: String(column?.label || column?.key || "").trim()
          }
    );
  }

  const firstRow = Array.isArray(rows) ? rows.find((row) => row && typeof row === "object") : null;

  if (!firstRow || Array.isArray(firstRow)) {
    return [];
  }

  return Object.keys(firstRow).map((key) => ({ key, label: key }));
}

function renderPrimitiveTable(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-table");
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const columns = normalizeTableColumns(props.columns, rows);

  if (props.title) {
    root.appendChild(createElement("h3", "spaces-primitive-section-title", String(props.title)));
  }

  if (!rows.length || !columns.length) {
    root.appendChild(createElement("p", "spaces-primitive-empty-copy", String(props.emptyText || "No rows.")));
    return root;
  }

  const table = createElement("table", "spaces-primitive-table-element");
  const head = createElement("thead", "spaces-primitive-table-head");
  const headRow = createElement("tr");
  const body = createElement("tbody", "spaces-primitive-table-body");

  columns.forEach((column) => {
    headRow.appendChild(createElement("th", "spaces-primitive-table-heading", column.label || column.key));
  });

  rows.forEach((row) => {
    const bodyRow = createElement("tr", "spaces-primitive-table-row");

    columns.forEach((column) => {
      const cell = createElement("td", "spaces-primitive-table-cell");
      const value =
        Array.isArray(row) ? row[columns.indexOf(column)] : row && typeof row === "object" ? row[column.key] : "";
      cell.textContent = String(value ?? "");
      bodyRow.appendChild(cell);
    });

    body.appendChild(bodyRow);
  });

  head.appendChild(headRow);
  table.append(head, body);
  root.appendChild(table);
  return root;
}

function renderPrimitiveMarkdown(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-markdown");
  root.innerHTML = marked.parse(String(props.source || ""));
  return root;
}

function renderPrimitiveRawHtml(props = {}) {
  const root = createElement("section", "spaces-primitive spaces-primitive-raw-html");
  root.innerHTML = String(props.html || "");
  return root;
}

function renderPrimitiveNotice(props = {}) {
  const tone = String(props.tone || "info").trim().toLowerCase();
  const root = createElement("section", `spaces-primitive spaces-primitive-notice is-${tone}`);

  if (props.title) {
    root.appendChild(createElement("h3", "spaces-primitive-section-title", String(props.title)));
  }

  if (props.text) {
    root.appendChild(createElement("p", "spaces-primitive-body", String(props.text)));
  }

  return root;
}

function renderPrimitiveGroup(props = {}, children = []) {
  const root = createElement("section", "spaces-primitive spaces-primitive-group");
  const columns = Number.parseInt(props.columns, 10);

  if (Number.isFinite(columns) && columns > 0) {
    root.style.setProperty("--spaces-widget-group-columns", String(columns));
  }

  renderChildren(children, root);
  return root;
}

function renderPrimitiveStack(props = {}, children = []) {
  const root = createElement("section", "spaces-primitive spaces-primitive-stack");

  if (props.gap) {
    root.style.setProperty("--spaces-widget-stack-gap", String(props.gap));
  }

  renderChildren(children, root);
  return root;
}

function renderPrimitive(node) {
  const { children = [], kind, props = {} } = node;

  switch (kind) {
    case "fragment": {
      const fragment = document.createDocumentFragment();
      renderChildren(children, fragment);
      return fragment;
    }
    case "group":
      return renderPrimitiveGroup(props, children);
    case "keyValue":
      return renderPrimitiveKeyValue(props);
    case "list":
      return renderPrimitiveList(props);
    case "markdown":
      return renderPrimitiveMarkdown(props);
    case "metric":
      return renderPrimitiveMetric(props);
    case "notice":
      return renderPrimitiveNotice(props);
    case "rawHtml":
      return renderPrimitiveRawHtml(props);
    case "stack":
      return renderPrimitiveStack(props, children);
    case "table":
      return renderPrimitiveTable(props);
    case "text":
      return renderPrimitiveText(props);
    default: {
      const unknown = createElement("section", "spaces-primitive spaces-primitive-notice is-warning");
      unknown.appendChild(createElement("h3", "spaces-primitive-section-title", "Unknown widget primitive"));
      unknown.appendChild(
        createElement("p", "spaces-primitive-body", `The primitive "${String(kind || "")}" is not supported.`)
      );
      return unknown;
    }
  }
}

function renderObjectFallback(value) {
  const root = createElement("section", "spaces-primitive spaces-primitive-raw-html");
  const pre = createElement("pre", "spaces-primitive-json-fallback");
  pre.textContent = JSON.stringify(value, null, 2);
  root.appendChild(pre);
  return root;
}

export function renderWidgetNode(value) {
  if (value === undefined || value === null || value === false) {
    return createElement("p", "spaces-primitive-empty-copy", "Nothing to render.");
  }

  if (value instanceof Node) {
    return value;
  }

  if (isWidgetPrimitive(value)) {
    return renderPrimitive(value);
  }

  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment();
    renderChildren(value, fragment);
    return fragment;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return createElement("p", "spaces-primitive-body", String(value));
  }

  if (value && typeof value === "object") {
    return renderObjectFallback(value);
  }

  return createElement("p", "spaces-primitive-body", String(value));
}

export function renderWidgetOutput(output, targetElement) {
  if (!targetElement) {
    return;
  }

  targetElement.replaceChildren();
  targetElement.appendChild(renderWidgetNode(output));
}
