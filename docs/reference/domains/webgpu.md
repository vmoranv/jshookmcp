# WebGPU

域名：`webgpu`

WebGPU 逆向分析域，支持 GPU 适配器信息、shader 编译反汇编、计时侧信道分析与内存布局检查。

## Profile

- workflow
- full

## 典型场景

- GPU 硬件指纹识别
- WGSL shader 分析
- GPU 侧信道攻击检测
- GPU 命令队列捕获

## 常见组合

- webgpu + browser
- webgpu + instrumentation

## 工具清单（9）

| 工具 | 说明 |
| --- | --- |
| `webgpu_adapter_info` | 获取 WebGPU 适配器信息（供应商、架构、设备）。用于指纹识别 GPU 能力和检测硬件级漏洞。 |
| `webgpu_shader_compile` | 编译 WGSL shader 并提取元数据（入口点、绑定、属性）。验证 shader 代码并检测潜在安全问题。 |
| `webgpu_shader_disassemble` | 将 WGSL shader 解析为 AST 并生成人类可读的反汇编。用于逆向工程 shader 逻辑。 |
| `webgpu_timing_analysis` | GPU 计时分析用于侧信道检测。测量 GPU 命令执行时间方差以检测基于缓存的侧信道攻击（格拉茨大学 2025 年研究）。 |
| `webgpu_memory_layout` | 分析 GPU 内存分配和缓冲区使用。识别可能易受侧信道攻击的内存布局模式。 |
| `webgpu_capture_commands` | 捕获 GPU 命令队列提交（渲染通道、计算调度）。用于分析 GPU 工作负载和检测恶意 shader 行为。 |
| `webgpu_shader_source_capture` | 捕获运行中应用通过 GPUDevice.createShaderModule 编译的 WGSL shader 源码——这是揭示计算/渲染管线实际运算内容（如物理 vs. 挖矿）的唯一产物。配合 webgpu_capture_commands 可重建每次 draw/dispatch 操作的数据。 |
| `webgpu_error_capture` | 待补充中文：Capture WebGPU validation/out-of-memory/internal errors the target app swallows (via device uncapturederror), plus the current device.lost state. Optionally wraps createBuffer/createTexture in error scopes to attribute failures to specific calls. Surfaces the real diagnostics behind "empty buffer" / "zero draw call" symptoms. |
| `webgpu_pipeline_dump` | 待补充中文：Enumerate active render/compute pipelines, bind-group layouts, and render-pass descriptors by hooking GPUDevice createRenderPipeline / createComputePipeline / createBindGroupLayout (plus async variants). Captures the full descriptor (vertex/fragment entry points, buffer stride/attributes, bind-group layout entries, visibility) so a captured bindGroups index can be resolved to actual resources. |
