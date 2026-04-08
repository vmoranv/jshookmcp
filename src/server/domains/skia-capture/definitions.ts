import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const emptyProperties: Record<string, object> = {};
const extractSceneProperties: Record<string, object> = {
  canvasId: {
    type: 'string',
  },
};
const correlateProperties: Record<string, object> = {
  skiaNodeIds: {
    type: 'array',
    items: {
      type: 'string',
    },
  },
};

export const skiaTools: Tool[] = [
  {
    name: 'skia_detect_renderer',
    description: 'Detect the active Skia renderer backend from the current page context.',
    inputSchema: {
      type: 'object',
      properties: emptyProperties,
      required: [],
    },
  },
  {
    name: 'skia_extract_scene',
    description: 'Extract a lightweight Skia scene tree from the selected canvas.',
    inputSchema: {
      type: 'object',
      properties: extractSceneProperties,
      required: [],
    },
  },
  {
    name: 'skia_correlate_objects',
    description: 'Correlate requested Skia node identifiers with the extracted scene tree.',
    inputSchema: {
      type: 'object',
      properties: correlateProperties,
      required: ['skiaNodeIds'],
    },
  },
];

export const skiaCaptureTools = skiaTools;
