# Skia Capture

域名：`skia-capture`

Skia 渲染引擎捕获域，用于 UI 渲染分析和可视化。

## Profile

- workflow
- full

## 典型场景

- Skia 场景提取
- 渲染管道分析
- UI 组件识别

## 常见组合

- skia-capture + browser
- skia-capture + canvas

## 代表工具

- `skia_detect_renderer` — 从当前页面上下文检测活跃的 Skia 渲染后端。
- `skia_extract_scene` — 从选中的 canvas 提取轻量级 Skia 场景树。
- `skia_correlate_objects` — 将请求的 Skia 节点标识符与提取的场景树进行关联。

## 工具清单（3）

| 工具 | 说明 |
| --- | --- |
| `skia_detect_renderer` | 从当前页面上下文检测活跃的 Skia 渲染后端。 |
| `skia_extract_scene` | 从选中的 canvas 提取轻量级 Skia 场景树。 |
| `skia_correlate_objects` | 将请求的 Skia 节点标识符与提取的场景树进行关联。 |
