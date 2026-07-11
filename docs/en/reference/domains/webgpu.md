# WebGPU

Domain: `webgpu`

WebGPU reverse analysis domain supporting GPU adapter info, shader compile/disassembly, timing side-channel analysis, and memory layout inspection.

## Profiles

- workflow
- full

## Typical scenarios

- GPU hardware fingerprinting
- WGSL shader analysis
- GPU side-channel attack detection
- GPU command queue capture

## Common combinations

- webgpu + browser
- webgpu + instrumentation

## Full tool list (9)

| Tool | Description |
| --- | --- |
| `webgpu_adapter_info` | Get WebGPU adapter information (vendor, architecture, device). Used for fingerprinting GPU capabilities and detecting hardware-level vulnerabilities. |
| `webgpu_shader_compile` | Compile WGSL shader and extract metadata (entry points, bindings, attributes). Validates shader code and detects potential security issues. |
| `webgpu_shader_disassemble` | Parse WGSL or SPIR-V shader into AST and generate human-readable disassembly. Used for reverse engineering shader logic. SPIR-V input (hex/base64) is reflected into entry points, bindings, structs, and locations without compilation. |
| `webgpu_timing_analysis` | GPU timing analysis for side-channel detection. Measures GPU command execution time variance to detect cache-based side-channel attacks (Graz University 2025 research). |
| `webgpu_memory_layout` | Analyze GPU memory allocations and buffer usage. Identifies memory layout patterns that may be vulnerable to side-channel attacks. |
| `webgpu_capture_commands` | Capture GPU command queue submissions (render passes, compute dispatches). Used for analyzing GPU workload and detecting malicious shader behavior. |
| `webgpu_shader_source_capture` | Capture WGSL shader sources a running app compiles via GPUDevice.createShaderModule — the only artifact revealing what a compute/render pipeline computes (e.g. physics vs. cryptominer). Pairs with webgpu_capture_commands to reconstruct what data each draw/dispatch operated on. |
| `webgpu_error_capture` | Capture WebGPU validation/out-of-memory/internal errors the target app swallows (via device uncapturederror), plus the current device.lost state. Optionally wraps createBuffer/createTexture in error scopes to attribute failures to specific calls. Surfaces the real diagnostics behind "empty buffer" / "zero draw call" symptoms. |
| `webgpu_pipeline_dump` | Enumerate active render/compute pipelines, bind-group layouts, and render-pass descriptors by hooking GPUDevice createRenderPipeline / createComputePipeline / createBindGroupLayout (plus async variants). Captures the full descriptor (vertex/fragment entry points, buffer stride/attributes, bind-group layout entries, visibility) so a captured bindGroups index can be resolved to actual resources. |
