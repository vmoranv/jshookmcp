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

## 工具清单（10）

| 工具 | 说明 |
| --- | --- |
| `webgpu_adapter_info` | 获取 WebGPU 适配器信息（供应商、架构、设备）。用于指纹识别 GPU 能力和检测硬件级漏洞。 |
| `webgpu_shader_compile` | 编译 WGSL shader 并提取元数据（入口点、绑定、属性）。验证 shader 代码并检测潜在安全问题。 |
| `webgpu_shader_disassemble` | 将 WGSL shader 解析为 AST 并生成人类可读的反汇编。用于逆向工程 shader 逻辑。 |
| `webgpu_timing_analysis` | GPU 计时分析用于侧信道检测。测量 GPU 命令执行时间方差以检测基于缓存的侧信道攻击（格拉茨大学 2025 年研究）。 |
| `webgpu_frame_timing` | 通过 GPU 时间戳查询（结合 device.limits.timestampPeriod 换算）在 rAF 循环中测量逐帧 CPU 和 GPU 耗时。回答「GPU 花了多长时间」以及「是 CPU 瓶颈还是 GPU 瓶颈」。当时间戳查询特性不可用时降级为 CPU 往返计时（precision=cpu-roundtrip）。 |
| `webgpu_memory_layout` | 分析 GPU 内存分配和缓冲区使用。识别可能易受侧信道攻击的内存布局模式。 |
| `webgpu_capture_commands` | 捕获 GPU 命令队列提交（渲染通道、计算调度）。用于分析 GPU 工作负载和检测恶意 shader 行为。 |
| `webgpu_shader_source_capture` | 捕获运行中应用通过 GPUDevice.createShaderModule 编译的 WGSL shader 源码——这是揭示计算/渲染管线实际运算内容（如物理 vs. 挖矿）的唯一产物。配合 webgpu_capture_commands 可重建每次 draw/dispatch 操作的数据。 |
| `webgpu_error_capture` | 捕获目标应用吞掉的 WebGPU 校验/内存不足/内部错误（通过 device uncapturederror）及当前 device.lost 状态。可选地将 createBuffer/createTexture 包裹在 error scope 中，将失败归因到具体调用。揭示「空 buffer」「零 draw call」症状背后的真实诊断。 |
| `webgpu_pipeline_dump` | 通过 hook GPUDevice createRenderPipeline / createComputePipeline / createBindGroupLayout（含 async 变体）枚举活跃的渲染/计算管线、bind-group 布局及 render-pass 描述符。捕获完整描述符（vertex/fragment 入口、buffer stride/attributes、bind-group 布局条目、visibility），使捕获的 bindGroups 索引可解析到实际资源。 |
