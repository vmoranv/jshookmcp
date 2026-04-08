import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const protocolAnalysisTools: Tool[] = [
  tool('proto_define_pattern')
    .desc('Define a protocol pattern with delimiter, byte order, and field layout')
    .string('name', 'Pattern name')
    .prop('spec', {
      type: 'object',
      description: 'Pattern specification object',
      additionalProperties: true,
    })
    .required('name', 'spec')
    .idempotent()
    .build(),

  tool('proto_auto_detect')
    .desc('Auto-detect a protocol pattern from one or more hex payload samples')
    .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
    .required('hexPayloads')
    .readOnly()
    .idempotent()
    .build(),

  tool('proto_export_schema')
    .desc('Export a protocol pattern to a .proto-like schema definition')
    .string('patternId', 'Pattern ID to export')
    .required('patternId')
    .readOnly()
    .idempotent()
    .build(),

  tool('proto_infer_fields')
    .desc('Infer likely protocol fields from repeated hex payload samples')
    .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
    .required('hexPayloads')
    .readOnly()
    .idempotent()
    .build(),

  tool('proto_infer_state_machine')
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
    .readOnly()
    .idempotent()
    .build(),

  tool('proto_visualize_state')
    .desc('Generate a Mermaid state diagram from a protocol state machine definition')
    .prop('stateMachine', {
      type: 'object',
      description: 'State machine definition with states and transitions',
      additionalProperties: true,
    })
    .readOnly()
    .idempotent()
    .build(),
];
