# Canvas

Domain: `canvas`

Canvas game engine reverse analysis domain supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, and object picking.

## Profiles

- full

## Typical scenarios

- Game engine fingerprinting and version detection
- Scene node tree export
- Coordinate-based object picking
- Click event handler tracing

## Common combinations

- browser + canvas + debugger
- canvas + evidence + trace

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
