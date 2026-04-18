# Canvas

域名：`canvas`

游戏引擎 Canvas 逆向分析域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出和对象拾取。

## Profile

- full

## 典型场景

- 游戏引擎识别与版本检测
- 场景节点树导出
- 坐标拾取游戏对象
- 点击事件链路追踪

## 常见组合

- browser + canvas + debugger
- canvas + evidence + trace

## 代表工具

- `canvas_engine_fingerprint` — 检测页面中运行的 Canvas/WebGL 游戏引擎实例（LayaAir、PixiJS、Phaser、Cocos Creator、Unity WebGL 等）
- `canvas_scene_dump` — 从检测到的 Canvas 引擎中提取完整的场景树/显示列表
- `canvas_pick_object_at_point` — 使用引擎的命中测试系统，在给定屏幕坐标处拾取/命中测试最上层的对象
- `trace_click_to_handler` — 追踪点击事件经过 DOM 事件、引擎分发和 JS 调用栈的过程，定位最终的处理函数

## 工具清单（4）

| 工具 | 说明 |
| --- | --- |
| `canvas_engine_fingerprint` | 检测页面中运行的 Canvas/WebGL 游戏引擎实例（LayaAir、PixiJS、Phaser、Cocos Creator、Unity WebGL 等） |
| `canvas_scene_dump` | 从检测到的 Canvas 引擎中提取完整的场景树/显示列表 |
| `canvas_pick_object_at_point` | 使用引擎的命中测试系统，在给定屏幕坐标处拾取/命中测试最上层的对象 |
| `trace_click_to_handler` | 追踪点击事件经过 DOM 事件、引擎分发和 JS 调用栈的过程，定位最终的处理函数 |
