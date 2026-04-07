/**
 * Tool definitions for skia-capture domain.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const skiaCaptureTools: Tool[] = [
  // SKIA-01: Renderer fingerprinting
  tool('skia_detect_renderer')
    .desc(
      'Detect Skia rendering pipeline — version, GPU backend (GL/Vulkan/Metal/software), shader pipeline, and renderer signatures',
    )
    .string('canvasId', 'Canvas element ID or index to target')
    .readOnly()
    .idempotent()
    .build(),

  // SKIA-02: Scene tree extraction
  tool('skia_dump_scene')
    .desc(
      'Extract Skia scene tree — layers, draw commands (drawRect/drawText/drawImage/drawPath), and rendering state',
    )
    .string('canvasId', 'Canvas element ID or index to target')
    .boolean('includeDrawCommands', 'Include draw commands in output', { default: true })
    .readOnly()
    .idempotent()
    .build(),

  // SKIA-03: Cross-domain correlation
  tool('skia_correlate_objects')
    .desc(
      'Correlate Skia rendering objects back to JS scene graph objects using text, dimension, color, and geometry matching',
    )
    .string('canvasId', 'Canvas element ID or index to target')
    .string('snapshotId', 'V8 heap snapshot ID to correlate against')
    .readOnly()
    .idempotent()
    .build(),
];
