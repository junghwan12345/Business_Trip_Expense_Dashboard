export const widgetGrid = {
  columns: 4,
  minColSpan: 1,
  maxColSpan: 4,
  minRowSpan: 1,
  maxRowSpan: 4
};

export const presetSpans = {
  small: { colSpan: 1, rowSpan: 1 },
  medium: { colSpan: 2, rowSpan: 2 },
  large: { colSpan: 3, rowSpan: 2 },
  full: { colSpan: 4, rowSpan: 2 }
};

export const defaultDashboardLayout = [
  { id: "indices", hidden: false, colSpan: 4, rowSpan: 2, presetSize: "full", order: 0 },
  { id: "calendar", hidden: false, colSpan: 2, rowSpan: 2, presetSize: "medium", order: 1 },
  { id: "tasks", hidden: false, colSpan: 2, rowSpan: 2, presetSize: "medium", order: 2 },
  { id: "stock", hidden: false, colSpan: 3, rowSpan: 3, presetSize: "large", order: 3 },
  { id: "events", hidden: false, colSpan: 2, rowSpan: 2, presetSize: "medium", order: 4 },
  { id: "notes", hidden: false, colSpan: 2, rowSpan: 2, presetSize: "medium", order: 5 }
];

const allowedSizes = new Set(Object.keys(presetSpans));
const widgetIds = new Set(defaultDashboardLayout.map((widget) => widget.id));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function toGridWidget(defaultWidget, saved, order) {
  const presetSize = saved?.presetSize === "custom"
    ? "custom"
    : allowedSizes.has(saved?.presetSize)
    ? saved.presetSize
    : allowedSizes.has(saved?.size)
      ? saved.size
      : defaultWidget.presetSize;
  const preset = presetSpans[presetSize] || presetSpans.medium;

  return {
    id: defaultWidget.id,
    hidden: Boolean(saved?.hidden),
    colSpan: clamp(saved?.colSpan ?? preset.colSpan, widgetGrid.minColSpan, widgetGrid.maxColSpan),
    rowSpan: clamp(saved?.rowSpan ?? preset.rowSpan, widgetGrid.minRowSpan, widgetGrid.maxRowSpan),
    presetSize,
    order
  };
}

export function resetDashboardLayout() {
  return defaultDashboardLayout.map((widget) => ({ ...widget }));
}

export function normalizeDashboardLayout(layout) {
  const incoming = Array.isArray(layout) ? layout.filter((widget) => widgetIds.has(widget?.id)) : [];
  const incomingOrder = new Map(incoming.map((widget, index) => [widget.id, index]));
  const byId = new Map(incoming.map((widget) => [widget.id, widget]));
  const normalized = defaultDashboardLayout.map((widget) => {
    const saved = byId.get(widget.id);
    const order = Number.isFinite(saved?.order) ? saved.order : incomingOrder.get(widget.id) ?? widget.order;
    return toGridWidget(widget, saved, order);
  });

  return normalized
    .sort((a, b) => a.order - b.order)
    .map((widget, order) => ({ ...widget, order }));
}

export function resizeWidget(layout, widgetId, size) {
  if (!allowedSizes.has(size)) return normalizeDashboardLayout(layout);
  const span = presetSpans[size];
  return normalizeDashboardLayout(layout).map((widget) =>
    widget.id === widgetId
      ? { ...widget, colSpan: span.colSpan, rowSpan: span.rowSpan, presetSize: size }
      : widget
  );
}

export function adjustWidgetSpan(layout, widgetId, colDelta, rowDelta) {
  return normalizeDashboardLayout(layout).map((widget) =>
    widget.id === widgetId
      ? {
          ...widget,
          colSpan: clamp(widget.colSpan + colDelta, widgetGrid.minColSpan, widgetGrid.maxColSpan),
          rowSpan: clamp(widget.rowSpan + rowDelta, widgetGrid.minRowSpan, widgetGrid.maxRowSpan),
          presetSize: "custom"
        }
      : widget
  );
}

export function setWidgetSpan(layout, widgetId, colSpan, rowSpan) {
  return normalizeDashboardLayout(layout).map((widget) =>
    widget.id === widgetId
      ? {
          ...widget,
          colSpan: clamp(colSpan, widgetGrid.minColSpan, widgetGrid.maxColSpan),
          rowSpan: clamp(rowSpan, widgetGrid.minRowSpan, widgetGrid.maxRowSpan),
          presetSize: "custom"
        }
      : widget
  );
}

export function moveWidget(layout, widgetId, direction) {
  const normalized = normalizeDashboardLayout(layout);
  const index = normalized.findIndex((widget) => widget.id === widgetId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= normalized.length) return normalized;
  const moved = [...normalized];
  const [widget] = moved.splice(index, 1);
  moved.splice(nextIndex, 0, widget);
  return moved.map((item, order) => ({ ...item, order }));
}

export function moveWidgetToIndex(layout, widgetId, targetIndex) {
  const normalized = normalizeDashboardLayout(layout);
  const index = normalized.findIndex((widget) => widget.id === widgetId);
  if (index < 0) return normalized;
  const nextIndex = clamp(targetIndex, 0, normalized.length - 1);
  const moved = [...normalized];
  const [widget] = moved.splice(index, 1);
  moved.splice(nextIndex, 0, widget);
  return moved.map((item, order) => ({ ...item, order }));
}

export function hideWidget(layout, widgetId) {
  return normalizeDashboardLayout(layout).map((widget) =>
    widget.id === widgetId ? { ...widget, hidden: true } : widget
  );
}

export function showWidget(layout, widgetId) {
  return normalizeDashboardLayout(layout).map((widget) =>
    widget.id === widgetId ? { ...widget, hidden: false } : widget
  );
}
