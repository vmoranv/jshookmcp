# Canvas

域名：`canvas`

Canvas 游戏引擎逆向域，识别 LayaAir/PixiJS/Phaser/Cocos/Unity WebGL 引擎，提取场景树，拾取坐标点对象，追踪点击到 handler。

## Profile

- workflow
- full

## 典型场景

- 游戏引擎识别（LayaAir / PixiJS / Phaser / Cocos Creator / Unity WebGL）
- 提取完整场景树 / display list
- 屏幕坐标拾取：给定 (x, y) 找出对应游戏对象
- 点击溯源：DOM → 引擎派发 → JS 调用栈 → handler

## 常见组合

- canvas + browser
- canvas + debugger
- canvas + evidence

## 代表工具

- `canvas_engine_fingerprint` — 识别页面中运行的 Canvas/WebGL 游戏引擎（LayaAir、PixiJS、Phaser、Cocos Creator、Unity WebGL 等）。
- `canvas_scene_dump` — 从检测到的 Canvas 引擎中提取完整的场景树/显示列表，支持最大深度过滤和交互/可见节点筛选。
- `canvas_pick_object_at_point` — 使用引擎内置 hit-test 系统拾取指定屏幕坐标处的最上层对象，支持高亮标记。
- `trace_click_to_handler` — 追踪点击事件从 DOM 事件到引擎派发再到 JS 调用栈的完整路径，定位最终 handler 函数。

## 工具清单（4）

| 工具 | 说明 |
| --- | --- |
| `canvas_engine_fingerprint` | 识别页面中运行的 Canvas/WebGL 游戏引擎（LayaAir、PixiJS、Phaser、Cocos Creator、Unity WebGL 等）。 |
| `canvas_scene_dump` | 从检测到的 Canvas 引擎中提取完整的场景树/显示列表，支持最大深度过滤和交互/可见节点筛选。 |
| `canvas_pick_object_at_point` | 使用引擎内置 hit-test 系统拾取指定屏幕坐标处的最上层对象，支持高亮标记。 |
| `trace_click_to_handler` | 追踪点击事件从 DOM 事件到引擎派发再到 JS 调用栈的完整路径，定位最终 handler 函数。 |
