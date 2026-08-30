# 画布引擎

域名：`canvas`

游戏引擎 Canvas 逆向分析域与 Skia 渲染引擎捕获域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出、对象拾取，以及 Skia GPU 后端检测与场景提取。

## Profile

- workflow
- full

## 典型场景

- 游戏引擎识别与版本检测
- 场景节点树导出
- 坐标拾取游戏对象
- 点击事件链路追踪
- Skia GPU 后端检测与场景提取

## 常见组合

- browser + canvas + debugger
- canvas + trace

## 工具清单（11）

| 工具 | 说明 |
| --- | --- |
| `canvas_engine_fingerprint` | 检测页面中运行的 Canvas/WebGL 游戏引擎实例（LayaAir、PixiJS、Phaser、Cocos Creator、Unity WebGL 等） |
| `canvas_scene_dump` | 从检测到的 Canvas 引擎中提取完整的场景树/显示列表 |
| `canvas_pick_object_at_point` | 使用引擎的命中测试系统，在给定屏幕坐标处拾取/命中测试最上层的对象 |
| `canvas_trace_click_handler` | 追踪点击事件经过 DOM 事件、引擎分发和 JS 调用栈的过程，定位最终的处理函数 |
| `canvas_scene_search` | 在已 dump 的场景树（canvas_scene_dump 输出）中按名称正则和/或类型搜索节点。纯计算——无需浏览器会话。返回匹配节点及其从根的路径、深度和引擎特定属性。 |
| `canvas_inject_draw_hook` | 拦截 Canvas 2D（drawImage/fillText/strokeText）与 WebGL（drawArrays/drawElements）的绘制调用，写入页面内的环形缓冲区。动作：install（包装原型）、read（转储已捕获的调用）、uninstall（还原）。 |
| `canvas_dump_shaders` | 待补充中文：Dump the linked shader programs (vertex + fragment source, uniforms) running on the target canvas. Uses engine introspection where available (Three.js renderer.info.programs, BABYLON.Effect.ShadersStore, Laya.Shader registry) and the WEBGL_debug_shaders extension to recover source where the driver allows. Returns programs[] + an honest `reason` when the engine / driver refuses to expose source. Academic basis: WGPULens arXiv 2606.26412 + DarthShader arXiv 2409.01824. |
| `canvas_memory_invariants` | 待补充中文：Assert runtime invariants about WebGL context lifetime, engine state consistency, and texture/program leaks. Reports checks[], violations[] (with severity + safe-cleanup fix), and a recommendations[] block. Honest scope: only JS-observable metrics (DOM canvas count vs live WebGL contexts, renderer.info.memory counts, contextLoss events). Full GC sweep / native-heap inspection is out of scope. Academic basis: JSidentify-V2 arXiv 2508.01655. |
| `skia_detect_renderer` | 从当前页面上下文检测活跃的 Skia 渲染后端。 |
| `skia_extract_scene` | 从选中的 canvas 提取轻量级 Skia 场景树。 |
| `skia_correlate_objects` | 将请求的 Skia 节点标识符与提取的场景树进行关联。 |
