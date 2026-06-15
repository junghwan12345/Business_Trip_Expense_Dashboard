import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustWidgetSpan,
  defaultDashboardLayout,
  hideWidget,
  moveWidget,
  normalizeDashboardLayout,
  moveWidgetToIndex,
  resizeWidget,
  resetDashboardLayout,
  setWidgetSpan,
  showWidget
} from "../src/대시보드/dashboard-layout.js";

test("normalizeDashboardLayout migrates preset sizes to grid spans", () => {
  const layout = normalizeDashboardLayout([
    { id: "calendar", size: "large" },
    { id: "stock", colSpan: 9, rowSpan: 9 }
  ]);

  assert.deepEqual(layout.find((widget) => widget.id === "calendar"), {
    id: "calendar",
    hidden: false,
    colSpan: 3,
    rowSpan: 2,
    presetSize: "large",
    order: 1
  });
  assert.equal(layout.find((widget) => widget.id === "stock").colSpan, 4);
  assert.equal(layout.find((widget) => widget.id === "stock").rowSpan, 4);
});

test("resizeWidget changes only the selected widget preset and spans", () => {
  const layout = resetDashboardLayout();
  const resized = resizeWidget(layout, "calendar", "large");

  assert.equal(resized.find((widget) => widget.id === "calendar").presetSize, "large");
  assert.equal(resized.find((widget) => widget.id === "calendar").colSpan, 3);
  assert.equal(resized.find((widget) => widget.id === "indices").presetSize, "full");
});

test("moveWidget moves a widget up and down without losing order", () => {
  const layout = resetDashboardLayout();
  const movedDown = moveWidget(layout, "indices", 1);
  const movedUp = moveWidget(movedDown, "indices", -1);

  assert.equal(movedDown[1].id, "indices");
  assert.deepEqual(movedUp.map((widget) => widget.id), defaultDashboardLayout.map((widget) => widget.id));
});

test("moveWidget keeps widgets inside the list bounds", () => {
  const layout = resetDashboardLayout();
  const moved = moveWidget(layout, "indices", -1);

  assert.deepEqual(moved.map((widget) => widget.id), layout.map((widget) => widget.id));
});

test("adjustWidgetSpan clamps direct widget resizing to allowed grid bounds", () => {
  const layout = resetDashboardLayout();
  const tooLarge = adjustWidgetSpan(layout, "tasks", 10, 8);
  const tooSmall = adjustWidgetSpan(tooLarge, "tasks", -10, -8);

  assert.equal(tooLarge.find((widget) => widget.id === "tasks").colSpan, 4);
  assert.equal(tooLarge.find((widget) => widget.id === "tasks").rowSpan, 4);
  assert.equal(tooLarge.find((widget) => widget.id === "tasks").presetSize, "custom");
  assert.equal(tooSmall.find((widget) => widget.id === "tasks").colSpan, 1);
  assert.equal(tooSmall.find((widget) => widget.id === "tasks").rowSpan, 1);
});

test("setWidgetSpan stores exact snapped widget dimensions", () => {
  const layout = resetDashboardLayout();
  const resized = setWidgetSpan(layout, "stock", 2, 4);

  assert.equal(resized.find((widget) => widget.id === "stock").colSpan, 2);
  assert.equal(resized.find((widget) => widget.id === "stock").rowSpan, 4);
  assert.equal(resized.find((widget) => widget.id === "stock").presetSize, "custom");
});

test("moveWidgetToIndex places a widget at a target grid order", () => {
  const layout = resetDashboardLayout();
  const moved = moveWidgetToIndex(layout, "stock", 1);

  assert.deepEqual(moved.map((widget) => widget.id).slice(0, 3), ["indices", "stock", "calendar"]);
  assert.deepEqual(moved.map((widget) => widget.order), [0, 1, 2, 3, 4, 5]);
});

test("hideWidget and showWidget keep a widget recoverable", () => {
  const layout = resetDashboardLayout();
  const hidden = hideWidget(layout, "notes");
  const shown = showWidget(hidden, "notes");

  assert.equal(hidden.find((widget) => widget.id === "notes").hidden, true);
  assert.equal(shown.find((widget) => widget.id === "notes").hidden, false);
});
