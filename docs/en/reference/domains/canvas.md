# Canvas

Domain: `canvas`

Canvas game engine reverse-engineering domain: identifies LayaAir/PixiJS/Phaser/Cocos/Unity WebGL engines, extracts scene trees, picks objects at screen coordinates, and traces click events to JS handlers.

## Profiles

- workflow
- full

## Typical scenarios

- Identify game engine (LayaAir / PixiJS / Phaser / Cocos Creator / Unity WebGL)
- Extract complete scene tree / display list
- Screen-coordinate picking: given (x, y), find which game object is at that position
- Click tracing: DOM → engine dispatch → JS call stack → handler

## Common combinations

- canvas + browser
- canvas + debugger
- canvas + evidence

## Representative tools

- `canvas_engine_fingerprint` — Detect Canvas/WebGL game engine instances running in the page (LayaAir, PixiJS, Phaser, Cocos Creator, Unity WebGL, etc.)
- `canvas_scene_dump` — Extract the full scene tree / display list from a detected canvas engine
- `canvas_pick_object_at_point` — Pick / hit-test the topmost object at a given screen coordinate using the engine's hit-test system
- `trace_click_to_handler` — Trace a click event through DOM events, engine dispatch, and JS call stack to identify the final handler

## Full tool list (4)

| Tool | Description |
| --- | --- |
| `canvas_engine_fingerprint` | Detect Canvas/WebGL game engine instances running in the page (LayaAir, PixiJS, Phaser, Cocos Creator, Unity WebGL, etc.) |
| `canvas_scene_dump` | Extract the full scene tree / display list from a detected canvas engine |
| `canvas_pick_object_at_point` | Pick / hit-test the topmost object at a given screen coordinate using the engine's hit-test system |
| `trace_click_to_handler` | Trace a click event through DOM events, engine dispatch, and JS call stack to identify the final handler |
