import {
  DEFAULT_WIDGET_POSITION,
  DEFAULT_WIDGET_SIZE,
  GRID_COORD_MAX,
  GRID_COORD_MIN
} from "/mod/_core/spaces/constants.js";
import { normalizeWidgetSize } from "/mod/_core/spaces/widget-sdk-core.js";

function clampInteger(value, min, max, fallback) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsedValue));
}

function coercePositionObject(position, fallbackPosition = DEFAULT_WIDGET_POSITION) {
  return {
    col: clampInteger(position?.col ?? position?.x, GRID_COORD_MIN, GRID_COORD_MAX, fallbackPosition.col),
    row: clampInteger(position?.row ?? position?.y, GRID_COORD_MIN, GRID_COORD_MAX, fallbackPosition.row)
  };
}

function resolveFallbackPosition(fallback) {
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return coercePositionObject(fallback, DEFAULT_WIDGET_POSITION);
  }

  if (typeof fallback === "string") {
    const match = fallback
      .trim()
      .match(/^(-?\d+)\s*,\s*(-?\d+)$/u);

    if (match) {
      return coercePositionObject(
        {
          col: match[1],
          row: match[2]
        },
        DEFAULT_WIDGET_POSITION
      );
    }
  }

  if (Array.isArray(fallback) && fallback.length >= 2) {
    return coercePositionObject(
      {
        col: fallback[0],
        row: fallback[1]
      },
      DEFAULT_WIDGET_POSITION
    );
  }

  return {
    col: DEFAULT_WIDGET_POSITION.col,
    row: DEFAULT_WIDGET_POSITION.row
  };
}

export function normalizeWidgetPosition(position, fallback = DEFAULT_WIDGET_POSITION) {
  const fallbackPosition = resolveFallbackPosition(fallback);

  if (typeof position === "string") {
    const match = position
      .trim()
      .match(/^(-?\d+)\s*,\s*(-?\d+)$/u);

    if (match) {
      return coercePositionObject(
        {
          col: match[1],
          row: match[2]
        },
        fallbackPosition
      );
    }
  }

  if (Array.isArray(position) && position.length >= 2) {
    return coercePositionObject(
      {
        col: position[0],
        row: position[1]
      },
      fallbackPosition
    );
  }

  if (position && typeof position === "object") {
    return coercePositionObject(position, fallbackPosition);
  }

  return {
    col: fallbackPosition.col,
    row: fallbackPosition.row
  };
}

export function positionToToken(position, fallback = DEFAULT_WIDGET_POSITION) {
  const normalizedPosition = normalizeWidgetPosition(position, fallback);
  return `${normalizedPosition.col},${normalizedPosition.row}`;
}

export function getRenderedWidgetSize(size, minimized = false) {
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);

  if (!minimized) {
    return normalizedSize;
  }

  return {
    ...normalizedSize,
    rows: 1
  };
}

export function clampWidgetPosition(position, size) {
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  const normalizedPosition = normalizeWidgetPosition(position, DEFAULT_WIDGET_POSITION);

  return {
    col: Math.min(GRID_COORD_MAX - normalizedSize.cols + 1, Math.max(GRID_COORD_MIN, normalizedPosition.col)),
    row: Math.min(GRID_COORD_MAX - normalizedSize.rows + 1, Math.max(GRID_COORD_MIN, normalizedPosition.row))
  };
}

function createRect(widgetId, position, size) {
  const clampedPosition = clampWidgetPosition(position, size);

  return {
    bottom: clampedPosition.row + size.rows - 1,
    left: clampedPosition.col,
    right: clampedPosition.col + size.cols - 1,
    top: clampedPosition.row,
    widgetId
  };
}

function doRectsOverlap(leftRect, rightRect) {
  return !(
    leftRect.right < rightRect.left ||
    leftRect.left > rightRect.right ||
    leftRect.bottom < rightRect.top ||
    leftRect.top > rightRect.bottom
  );
}

function canPlaceRect(position, size, occupiedRects) {
  const nextRect = createRect("", position, size);

  return occupiedRects.every((occupiedRect) => !doRectsOverlap(nextRect, occupiedRect));
}

function buildColumnSearchOrder(startCol, radius) {
  const columns = [startCol];

  for (let offset = 1; offset <= radius; offset += 1) {
    columns.push(startCol + offset, startCol - offset);
  }

  return columns.filter((value, index, values) => values.indexOf(value) === index);
}

function findFirstAvailablePosition(size, occupiedRects, preferredPosition = DEFAULT_WIDGET_POSITION) {
  const normalizedSize = normalizeWidgetSize(size, DEFAULT_WIDGET_SIZE);
  const normalizedPosition = clampWidgetPosition(preferredPosition, normalizedSize);
  const minCol = GRID_COORD_MIN;
  const maxCol = GRID_COORD_MAX - normalizedSize.cols + 1;
  const columnSearchOrder = buildColumnSearchOrder(
    Math.min(maxCol, Math.max(minCol, normalizedPosition.col)),
    GRID_COORD_MAX - GRID_COORD_MIN
  );

  for (let row = normalizedPosition.row; row <= GRID_COORD_MAX - normalizedSize.rows + 1; row += 1) {
    for (const currentCol of columnSearchOrder) {
      if (currentCol < minCol || currentCol > maxCol) {
        continue;
      }

      const position = {
        col: currentCol,
        row
      };

      if (canPlaceRect(position, normalizedSize, occupiedRects)) {
        return position;
      }
    }
  }

  return {
    col: normalizedPosition.col,
    row: normalizedPosition.row
  };
}

export function resolveSpaceLayout({
  anchorMinimized = undefined,
  anchorPosition = undefined,
  anchorSize = undefined,
  anchorWidgetId = "",
  minimizedWidgetIds = [],
  widgetIds = [],
  widgetPositions = {},
  widgetSizes = {}
} = {}) {
  const minimizedSet = new Set(Array.isArray(minimizedWidgetIds) ? minimizedWidgetIds : []);
  const entries = widgetIds.map((widgetId, index) => {
    const preferredPosition =
      widgetId === anchorWidgetId && anchorPosition !== undefined
        ? normalizeWidgetPosition(anchorPosition, widgetPositions[widgetId] || DEFAULT_WIDGET_POSITION)
        : normalizeWidgetPosition(widgetPositions[widgetId], DEFAULT_WIDGET_POSITION);
    const minimized =
      widgetId === anchorWidgetId && anchorMinimized !== undefined
        ? Boolean(anchorMinimized)
        : minimizedSet.has(widgetId);
    const storedSize =
      widgetId === anchorWidgetId && anchorSize !== undefined
        ? normalizeWidgetSize(anchorSize, widgetSizes[widgetId] || DEFAULT_WIDGET_SIZE)
        : normalizeWidgetSize(widgetSizes[widgetId], DEFAULT_WIDGET_SIZE);

    return {
      index,
      minimized,
      preferredPosition,
      renderedSize: getRenderedWidgetSize(storedSize, minimized),
      storedSize,
      widgetId
    };
  });

  entries.sort((left, right) => {
    if (left.widgetId === anchorWidgetId && right.widgetId !== anchorWidgetId) {
      return -1;
    }

    if (right.widgetId === anchorWidgetId && left.widgetId !== anchorWidgetId) {
      return 1;
    }

    if (left.preferredPosition.row !== right.preferredPosition.row) {
      return left.preferredPosition.row - right.preferredPosition.row;
    }

    if (left.preferredPosition.col !== right.preferredPosition.col) {
      return left.preferredPosition.col - right.preferredPosition.col;
    }

    return left.index - right.index;
  });

  const occupiedRects = [];
  const positions = {};
  const renderedSizes = {};
  const minimizedMap = {};

  entries.forEach((entry) => {
    const resolvedPosition = findFirstAvailablePosition(entry.renderedSize, occupiedRects, entry.preferredPosition);
    positions[entry.widgetId] = resolvedPosition;
    renderedSizes[entry.widgetId] = entry.renderedSize;
    minimizedMap[entry.widgetId] = entry.minimized;
    occupiedRects.push(createRect(entry.widgetId, resolvedPosition, entry.renderedSize));
  });

  return {
    minimizedMap,
    positions,
    renderedSizes
  };
}
