import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { webgpuTools } from '@server/domains/webgpu/definitions';
import type { WebGPUHandlers } from '@server/domains/webgpu/index';
import type { WebGPUDomainDependencies } from '@server/domains/webgpu/types';

const DOMAIN = 'webgpu' as const;
const DEP_KEY = 'webgpuHandlers' as const;
type H = WebGPUHandlers;
const toolDefinitions = webgpuTools;
const t = toolLookup(toolDefinitions);

const registrations = defineMethodRegistrations<H, (typeof toolDefinitions)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'webgpu_adapter_info', method: 'webgpu_adapter_info' },
    { tool: 'webgpu_shader_compile', method: 'webgpu_shader_compile' },
    { tool: 'webgpu_shader_disassemble', method: 'webgpu_shader_disassemble' },
    { tool: 'webgpu_timing_analysis', method: 'webgpu_timing_analysis' },
    { tool: 'webgpu_memory_layout', method: 'webgpu_memory_layout' },
    { tool: 'webgpu_capture_commands', method: 'webgpu_capture_commands' },
    { tool: 'webgpu_shader_source_capture', method: 'webgpu_shader_source_capture' },
    { tool: 'webgpu_error_capture', method: 'webgpu_error_capture' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { WebGPUHandlers } = await import('@server/domains/webgpu/index');
  await ensureBrowserCore(ctx);

  if (!ctx.webgpuHandlers) {
    ctx.webgpuHandlers = new WebGPUHandlers(ctx, {
      pageController: ctx.pageController as WebGPUDomainDependencies['pageController'],
    });
  }
  return ctx.webgpuHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  // ── Routing metadata ──

  workflowRule: {
    patterns: [
      /webgpu|gpu.*shader|wgsl|side.*channel.*gpu|gpu.*timing/i,
      /(GPU|着色器|侧信道|WebGPU)/i,
    ],
    priority: 60,
    tools: [
      'webgpu_adapter_info',
      'webgpu_shader_compile',
      'webgpu_timing_analysis',
      'webgpu_capture_commands',
    ],
    hint: 'WebGPU analysis workflow: get adapter info → compile/analyze shaders → detect side-channel timing → capture commands',
  },

  prerequisites: {
    webgpu_adapter_info: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_shader_compile: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_timing_analysis: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_memory_layout: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_capture_commands: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_shader_source_capture: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    webgpu_error_capture: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
  },

  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
