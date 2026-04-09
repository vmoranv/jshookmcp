import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const protocolAnalysisTools: Tool[] = [
  tool('proto_define_pattern', (t) =>
    t
      .desc('Define a protocol pattern with delimiter, byte order, and field layout')
      .string('name', 'Pattern name')
      .prop('spec', {
        type: 'object',
        description: 'Pattern specification object',
        additionalProperties: true,
      })
      .required('name', 'spec')
      .idempotent(),
  ),
  tool('proto_auto_detect', (t) =>
    t
      .desc('Auto-detect a protocol pattern from one or more hex payload samples')
      .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
      .required('hexPayloads')
      .query(),
  ),
  tool('proto_export_schema', (t) =>
    t
      .desc('Export a protocol pattern to a .proto-like schema definition')
      .string('patternId', 'Pattern ID to export')
      .required('patternId')
      .query(),
  ),
  tool('proto_infer_fields', (t) =>
    t
      .desc('Infer likely protocol fields from repeated hex payload samples')
      .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
      .required('hexPayloads')
      .query(),
  ),
  tool('proto_infer_state_machine', (t) =>
    t
      .desc('Infer a protocol state machine from captured message sequences')
      .array(
        'messages',
        {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['req', 'res'], description: 'Message direction' },
            timestamp: { type: 'number', description: 'Message timestamp' },
            fields: {
              type: 'object',
              description: 'Decoded message fields',
              additionalProperties: true,
            },
            raw: { type: 'string', description: 'Raw message or payload summary' },
          },
          required: ['direction', 'timestamp', 'fields', 'raw'],
        },
        'Captured protocol messages',
      )
      .required('messages')
      .query(),
  ),
  tool('proto_visualize_state', (t) =>
    t
      .desc('Generate a Mermaid state diagram from a protocol state machine definition')
      .prop('stateMachine', {
        type: 'object',
        description: 'State machine definition with states and transitions',
        additionalProperties: true,
      })
      .query(),
  ),
];
