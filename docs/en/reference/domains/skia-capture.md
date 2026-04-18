# Skia Capture

Domain: `skia-capture`

Skia rendering engine capture domain for UI rendering analysis and visualization.

## Profiles

- full

## Typical scenarios

- Skia scene extraction
- Rendering pipeline analysis
- UI component identification

## Common combinations

- skia-capture + browser
- skia-capture + canvas

## Representative tools

- `skia_detect_renderer` — Detect the active Skia renderer backend from the current page context.
- `skia_extract_scene` — Extract a lightweight Skia scene tree from the selected canvas.
- `skia_correlate_objects` — Correlate requested Skia node identifiers with the extracted scene tree.

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `skia_detect_renderer` | Detect the active Skia renderer backend from the current page context. |
| `skia_extract_scene` | Extract a lightweight Skia scene tree from the selected canvas. |
| `skia_correlate_objects` | Correlate requested Skia node identifiers with the extracted scene tree. |
