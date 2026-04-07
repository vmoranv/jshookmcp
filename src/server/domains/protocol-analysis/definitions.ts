import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const protocolAnalysisTools: Tool[] = [
  // PROTO-01: Manual protocol pattern definition
  tool('protocol_define_pattern')
    .desc(
      'Define a custom protocol pattern with field types, byte order, and optional encryption scheme',
    )
    .string('name', 'Protocol pattern name')
    .array(
      'fields',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Field name' },
          type: {
            type: 'string',
            enum: ['uint8', 'uint16', 'uint32', 'int64', 'float', 'string', 'bytes'],
          },
          offset: { type: 'number', description: 'Byte offset from start' },
          length: { type: 'number', description: 'Field length in bytes' },
          description: { type: 'string', description: 'Optional field description' },
        },
        required: ['name', 'type', 'offset', 'length'],
      },
      'Array of protocol fields',
    )
    .enum('byteOrder', ['big', 'little'], 'Byte order', { default: 'big' })
    .object(
      'encryption',
      {
        type: {
          type: 'string',
          enum: ['aes', 'xor', 'rc4', 'custom'],
          description: 'Encryption type',
        },
        key: { type: 'string', description: 'Encryption key (hex)' },
        iv: { type: 'string', description: 'Initialization vector (hex)' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      'Optional encryption info',
      { required: ['type'] },
    )
    .required('name', 'fields')
    .readOnly()
    .idempotent()
    .build(),

  // PROTO-01: Auto-detect protocol pattern
  tool('protocol_auto_detect')
    .desc('Auto-detect protocol pattern from hex payload samples using field boundary analysis')
    .array('payloads', { type: 'string' }, 'Array of hex-encoded payload samples')
    .string('name', 'Optional name for the detected pattern')
    .required('payloads')
    .readOnly()
    .idempotent()
    .build(),

  // PROTO-01: Export schema
  tool('protocol_export_schema')
    .desc('Export a protocol pattern to .proto-like schema definition')
    .string('patternId', 'Name of the registered protocol pattern to export')
    .required('patternId')
    .readOnly()
    .idempotent()
    .build(),

  // PROTO-02: Infer state machine
  tool('protocol_infer_state_machine')
    .desc('Infer a protocol state machine from captured message sequences')
    .array(
      'messages',
      {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['in', 'out'], description: 'Message direction' },
          payloadHex: { type: 'string', description: 'Hex-encoded payload' },
          timestamp: { type: 'number', description: 'Optional timestamp (ms)' },
        },
        required: ['direction', 'payloadHex'],
      },
      'Array of captured messages',
    )
    .boolean('simplify', 'Simplify the resulting state machine by merging similar states', {
      default: false,
    })
    .required('messages')
    .readOnly()
    .idempotent()
    .build(),

  // PROTO-02: Visualize state machine
  tool('protocol_visualize_state')
    .desc('Generate a Mermaid state diagram from a state machine definition')
    .object(
      'stateMachine',
      {
        states: { type: 'array', description: 'Array of states' },
        transitions: { type: 'array', description: 'Array of transitions' },
        initialState: { type: 'string', description: 'Initial state ID' },
        finalStates: { type: 'array', description: 'Array of final state IDs' },
      },
      'State machine object (output from protocol_infer_state_machine)',
    )
    .required('stateMachine')
    .readOnly()
    .idempotent()
    .build(),
];
