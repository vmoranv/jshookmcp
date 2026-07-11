import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const webgpuTools: Tool[] = [
  {
    name: 'webgpu_adapter_info',
    description:
      'Get WebGPU adapter information (vendor, architecture, device). Used for fingerprinting GPU capabilities and detecting hardware-level vulnerabilities.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_shader_compile',
    description:
      'Compile WGSL shader and extract metadata (entry points, bindings, attributes). Validates shader code and detects potential security issues.',
    inputSchema: {
      type: 'object',
      properties: {
        shaderCode: {
          type: 'string',
          description: 'WGSL shader source code',
        },
        format: {
          type: 'string',
          enum: ['wgsl', 'spirv'],
          description:
            'Shader format. "wgsl": compiled and validated on the real GPU via the browser WebGPU API. "spirv": static reflection only (browsers cannot compile SPIR-V directly; metadata is extracted by a zero-dependency binary parser). Provide SPIR-V as a hex or base64-encoded string.',
        },
      },
      required: ['shaderCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_shader_disassemble',
    description:
      'Parse WGSL or SPIR-V shader into AST and generate human-readable disassembly. Used for reverse engineering shader logic. SPIR-V input (hex/base64) is reflected into entry points, bindings, structs, and locations without compilation.',
    inputSchema: {
      type: 'object',
      properties: {
        shaderCode: {
          type: 'string',
          description:
            'Shader source code (WGSL text) or SPIR-V binary (hex/base64-encoded string)',
        },
        format: {
          type: 'string',
          enum: ['wgsl', 'spirv'],
          description: 'Shader format',
        },
      },
      required: ['shaderCode'],
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_timing_analysis',
    description:
      'GPU timing analysis for side-channel detection. Measures GPU command execution time variance to detect cache-based side-channel attacks (Graz University 2025 research).',
    inputSchema: {
      type: 'object',
      properties: {
        iterations: {
          type: 'number',
          description: 'Number of timing samples to collect',
          minimum: 1,
        },
        detectAnomalies: {
          type: 'boolean',
          description: 'Detect timing anomalies that may indicate side-channel attacks',
        },
      },
      required: ['iterations'],
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_memory_layout',
    description:
      'Analyze GPU memory allocations and buffer usage. Identifies memory layout patterns that may be vulnerable to side-channel attacks.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_capture_commands',
    description:
      'Capture GPU command queue submissions (render passes, compute dispatches). Used for analyzing GPU workload and detecting malicious shader behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        captureCount: {
          type: 'number',
          description: 'Number of command submissions to capture',
          minimum: 1,
        },
      },
      required: ['captureCount'],
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_shader_source_capture',
    description:
      'Capture WGSL shader sources a running app compiles via GPUDevice.createShaderModule — the only artifact revealing what a compute/render pipeline computes (e.g. physics vs. cryptominer). Pairs with webgpu_capture_commands to reconstruct what data each draw/dispatch operated on.',
    inputSchema: {
      type: 'object',
      properties: {
        captureCount: {
          type: 'number',
          description: 'Number of shader compilations to capture before returning',
          minimum: 1,
        },
        timeoutMs: {
          type: 'number',
          description:
            'Max wait in ms (returns early once captureCount shaders are captured). Default 5000.',
          minimum: 100,
        },
      },
      required: ['captureCount'],
      additionalProperties: false,
    },
  },
  {
    name: 'webgpu_error_capture',
    description:
      'Capture WebGPU validation/out-of-memory/internal errors the target app swallows (via device uncapturederror), plus the current device.lost state. Optionally wraps createBuffer/createTexture in error scopes to attribute failures to specific calls. Surfaces the real diagnostics behind "empty buffer" / "zero draw call" symptoms.',
    inputSchema: {
      type: 'object',
      properties: {
        captureCount: {
          type: 'number',
          description: 'Maximum number of errors to capture before returning',
          minimum: 1,
        },
        timeoutMs: {
          type: 'number',
          description:
            'Max wait in ms (returns early once captureCount errors are captured). Default 5000.',
          minimum: 100,
        },
        wrapAllocations: {
          type: 'boolean',
          description:
            'Wrap createBuffer/createTexture in push/pop error scopes to attribute validation failures to specific calls',
        },
      },
      required: ['captureCount'],
      additionalProperties: false,
    },
  },
];
