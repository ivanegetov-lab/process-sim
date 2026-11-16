# UI guide

Start from `examples/distillation-column/`. It already does the hard UI work; most units only need new geometry, a new fault table and new labels.

## Files

- `index.html`: layout and styles. Left panel (components, color mode, break/fix panel, logbook), right panel (KPI cards, profile chart, loop faceplates), bottom bar (sim clock, speeds, cost, trend tabs), alarm stack, toasts, callouts. `?open`, `?clean`, `?speed=`, `?record` flags.
- `scene.js`: three.js geometry and per-frame visuals. Vendored three.js in `vendor/` (no network, no build).
- `app.js`: wiring. Sim loop, UI panels, fault table (`FX`), tells, highlights, beacons, callouts, trends, picking, camera.

## Geometry helpers in scene.js

- `cyl(r, h, color)`, `box(w, h, d, color)`, `rod(a, b, r, material)`, `mat(color, opts)`
- `pipe(points, r, color, flowColor, key)`: tube along a polyline with elbows and animated flow dashes. Flow speed is set per key in `update()`. Registered as highlight target `pipe:<key>`.
- `makeValve(pos, axis, tag)`: globe valve with actuator. The stem indicator moves with opening; the actuator turns amber above 85% and red when pinned. Target `valve:<tag>`.
- `makePump(x, z, rotY)`: motor, coupling guard, volute.
- `setHorizontalLevel(...)`: liquid level in a horizontal vessel (rebuilt when the level changes).
- Cutaways: give the shell material `clippingPlanes` with `clipIntersection: true` (a wedge), animate the plane constants in `setOpen(t)`. Internals are not clipped, so they appear when the wedge opens.
- `reg(key, ...meshes)` / `regGroup(key, obj)`: register highlight targets. `setHighlights([{ key, color, k }])` pulses emissive; `updateBeacons([{ id, pos, size, color }], camera, dt)` draws radar pings on top of everything.
- `labels`: `{ id, pos, cls, text: (sim) => string, alarm: (sim) => bool }`. Classes: `equip`, `inst`, `valve`, `anal`, `tray`. Use `trend(sim, historyKey, threshold)` to add ▲▼.

## Moving liquid

Make the inside feel alive: foam textures that scroll across decks at a speed set by the liquid rate, falling sheets in downcomers, swirling sump surfaces, bubbles whose count follows vapor rate, droplets for entrainment and weeping. Everything visual should be driven by a model number.

## The fault table (FX in app.js)

```js
reboilerFouling: {
  short: 'Reboiler fouling',
  keys: ['reboiler'],                      // highlight targets
  anchor: () => V3(x, y, z), size: 1.7,    // beacon + callout position
  focus: { kind: 'reboiler' },             // where the camera flies, which info card opens
  loops: ['TIC105'],                       // faceplates that light up
  metrics: [m_('TV-105 steam valve', (s) => s.valves.TV105, '%', 0), ...],  // "since you broke it"
  tell: (s, base) => s.valves.TV105 > base[0] + 10,
  tellText: (s, base) => `TV-105 is ${...}% open (was ${...}%). Quality is still on spec.`,
}
```

Breaking a fault: camera flies there (opening the cutaway if needed), targets pulse coral, a beacon and live callout appear, a toast fires, the fault card shows before → now, the trend chart gets a ⚠ marker. First tell: amber callout, tell toast, ● marker. Fix: green flash, ✓ marker.

## Layout rules

- The 3D view is centered in the gap between panels (camera view offset). Check at 1440×900 and at a laptop size.
- Labels hide at distance; tray labels only show when the cutaway is open.
- Keep the footer line on screen: "Training model. Not for design or sizing."
