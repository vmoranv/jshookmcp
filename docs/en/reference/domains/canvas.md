# Canvas

Domain: `canvas`

Canvas game engine reverse analysis domain plus Skia rendering capture, supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, object picking, and Skia GPU backend detection and scene extraction.

## Profiles

- workflow
- full

## Typical scenarios

- Game engine fingerprinting and version detection
- Scene node tree export
- Coordinate-based object picking
- Click event handler tracing
- Skia GPU backend detection and scene extraction

## Common combinations

- browser + canvas + debugger
- canvas + trace

## Full tool list (11)

| Tool | Description |
| --- | --- |
| `canvas_engine_fingerprint` | Detect Canvas/WebGL game engines in the page. |
| `canvas_scene_dump` | Extract the full scene tree / display list from a detected canvas engine. |
| `canvas_pick_object_at_point` | Pick / hit-test the topmost object at a given screen coordinate using the engine's hit-test system |
| `canvas_trace_click_handler` | Trace a click event from DOM to JS call stack. |
| `canvas_scene_search` | Search a previously-dumped scene tree (canvas_scene_dump output) for nodes by name regex and/or type. Pure-compute — no browser session required. Returns matching nodes with their path from root, depth, and engine-specific properties. |
| `canvas_inject_draw_hook` | Intercept Canvas 2D (drawImage/fillText/strokeText) and WebGL (drawArrays/drawElements) draw calls into a ring buffer on the page. Actions: install (wrap prototypes), read (dump captured calls), uninstall (restore). Set timing=true at install to also sample a requestAnimationFrame loop; then includeTiming=true at read to get frame-level stats (avg/p95 frame time, dropped frames, 60fps budget misses). |
| `canvas_dump_shaders` | Dump the linked shader programs (vertex + fragment source, uniforms) running on the target canvas. Uses engine introspection where available (Three.js renderer.info.programs, BABYLON.Effect.ShadersStore, Laya.Shader registry) and the WEBGL_debug_shaders extension to recover source where the driver allows. Returns programs[] + an honest `reason` when the engine / driver refuses to expose source. Academic basis: WGPULens arXiv 2606.26412 + DarthShader arXiv 2409.01824. |
| `canvas_memory_invariants` | Assert runtime invariants about WebGL context lifetime, engine state consistency, and texture/program leaks. Reports checks[], violations[] (with severity + safe-cleanup fix), and a recommendations[] block. Honest scope: only JS-observable metrics (DOM canvas count vs live WebGL contexts, renderer.info.memory counts, contextLoss events). Full GC sweep / native-heap inspection is out of scope. Academic basis: JSidentify-V2 arXiv 2508.01655. |
| `skia_detect_renderer` | Detect the active Skia renderer backend from the current page context. |
| `skia_extract_scene` | Extract a lightweight Skia scene tree from the selected canvas. |
| `skia_correlate_objects` | Correlate requested Skia node identifiers with the extracted scene tree. |
