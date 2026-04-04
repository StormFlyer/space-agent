---
name: Spaces Widgets
description: Create or update persisted space widgets with the `_core/spaces` widget SDK instead of patching DOM directly.
metadata:
  always_loaded: true
---

Use this skill when the user asks the agent to create, update, or remove widgets inside a space.

## Storage Layout

- Spaces live under `~/spaces/<spaceId>/`.
- The manifest is `~/spaces/<spaceId>/space.yaml`.
- Widget modules live under `~/spaces/<spaceId>/widgets/<widgetId>.js`.
- Widget-owned support files can live under `~/spaces/<spaceId>/data/` or `~/spaces/<spaceId>/assets/`.

## Prefer The Runtime Helpers

The spaces module exposes `space.spaces`.

Useful helpers:

- `await space.spaces.listSpaces()`
- `await space.spaces.createSpace({ title })`
- `await space.spaces.removeSpace(spaceId)`
- `await space.spaces.openSpace(spaceId)`
- `await space.spaces.saveSpaceMeta({ id, title })`
- `await space.spaces.saveSpaceLayout({ id, widgetIds?, widgetPositions?, widgetSizes?, minimizedWidgetIds? })`
- `await space.spaces.upsertWidget({ spaceId?, widgetId?, title?, size?, source? })`
- `await space.spaces.removeWidget({ spaceId?, widgetId })`
- `await space.spaces.reloadCurrentSpace()`
- `space.spaces.createWidgetSource({ title, size, html })`

If the user is already inside a space, omit `spaceId` and the helpers target the current one.
Freshly created spaces are empty canvases, so write the first widget yourself instead of expecting starter content.

## Widget Authoring Contract

Widget modules should import the SDK:

```js
import { defineWidget, metric, rawHtml, stack, text } from "/mod/_core/spaces/widget-sdk.js";
```

Widgets export `defineWidget(...)`:

```js
export default defineWidget({
  apiVersion: 1,
  title: "Example",
  size: "medium",
  async load(ctx) {
    return { message: "hello" };
  },
  render(ctx) {
    return stack([
      text({ eyebrow: "Demo", title: "Example widget", body: ctx.data.message }),
      rawHtml("<div><strong>Trusted HTML</strong></div>")
    ]);
  }
});
```

Rules:

- `render(ctx)` is required.
- `load(ctx)` is optional.
- Use primitives from the SDK whenever possible.
- `rawHtml(...)` is the trusted escape hatch when primitives are not enough.
- Do not patch global page DOM from widgets. The framework owns the card and grid shell.

## Current Primitive Set

The first-party SDK currently ships:

- `stack(...)`
- `group(...)`
- `text(...)`
- `metric(...)`
- `list(...)`
- `keyValue(...)`
- `table(...)`
- `markdown(...)`
- `rawHtml(...)`
- `notice(...)`

## Recommended Agent Flow

1. Inspect or create the current space with `space.spaces.*`.
2. Generate widget source using the SDK import path.
3. Save it with `space.spaces.upsertWidget(...)`.
4. Call `await space.spaces.reloadCurrentSpace()` if the user should see the result immediately.

## Persistence Rule

- Rewrite widget modules by widget id instead of trying to patch previous DOM output.
- The manifest controls widget order, stored size overrides, stored positions, and minimized state.
- Positions use a centered logical grid where `0,0` is the canvas origin and negative coordinates are valid.
