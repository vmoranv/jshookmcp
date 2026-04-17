import type {
  EncryptionInfo,
  FieldSpec,
  PatternSpec,
  ProtocolField,
  ProtocolMessage,
  ProtocolPattern,
  StateMachine,
} from '@modules/protocol-analysis';
import { ProtocolPatternEngine, StateMachineInferrer } from '@modules/protocol-analysis';
import { argObject, argStringArray, argStringRequired } from '@server/domains/shared/parse-args';
import type { ToolArgs } from '@server/types';
import type { EventBus, ServerEventMap } from '@server/EventBus';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFieldSpec(value: unknown, index: number): FieldSpec {
  if (!isRecord(value)) {
    throw new Error(`fields[${index}] must be an object`);
  }

  const name = value.name;
  const offset = value.offset;
  const length = value.length;
  const type = value.type;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`fields[${index}].name must be a non-empty string`);
  }

  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error(`fields[${index}].offset must be a non-negative integer`);
  }

  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    throw new Error(`fields[${index}].length must be a positive integer`);
  }

  if (
    type !== 'int' &&
    type !== 'string' &&
    type !== 'bytes' &&
    type !== 'bool' &&
    type !== 'float'
  ) {
    throw new Error(`fields[${index}].type is invalid`);
  }

  return { name, offset, length, type };
}

function parseLegacyField(value: unknown, index: number): ProtocolField {
  if (!isRecord(value)) {
    throw new Error(`fields[${index}] must be an object`);
  }

  const name = value.name;
  const offset = value.offset;
  const length = value.length;
  const type = value.type;
  const description = value.description;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`fields[${index}].name must be a non-empty string`);
  }

  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error(`fields[${index}].offset must be a non-negative integer`);
  }

  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    throw new Error(`fields[${index}].length must be a positive integer`);
  }

  if (
    type !== 'uint8' &&
    type !== 'uint16' &&
    type !== 'uint32' &&
    type !== 'int64' &&
    type !== 'float' &&
    type !== 'string' &&
    type !== 'bytes'
  ) {
    throw new Error(`fields[${index}].type is invalid`);
  }

  return {
    name,
    offset,
    length,
    type,
    ...(typeof description === 'string' ? { description } : {}),
  };
}

function parsePatternSpec(name: string, value: Record<string, unknown>): PatternSpec {
  const rawFields = value.fields;
  if (!Array.isArray(rawFields)) {
    throw new Error('spec.fields must be an array');
  }

  const fieldDelimiter =
    typeof value.fieldDelimiter === 'string' && value.fieldDelimiter.length > 0
      ? value.fieldDelimiter
      : undefined;
  const byteOrderValue = value.byteOrder;
  const byteOrder = byteOrderValue === 'le' || byteOrderValue === 'be' ? byteOrderValue : undefined;

  return {
    name,
    ...(fieldDelimiter ? { fieldDelimiter } : {}),
    ...(byteOrder ? { byteOrder } : {}),
    fields: rawFields.map((field, index) => parseFieldSpec(field, index)),
  };
}

function parseEncryptionInfo(value: unknown): EncryptionInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value.type;
  if (type !== 'aes' && type !== 'xor' && type !== 'rc4' && type !== 'custom') {
    return undefined;
  }

  const key = typeof value.key === 'string' ? value.key : undefined;
  const iv = typeof value.iv === 'string' ? value.iv : undefined;
  const notes = typeof value.notes === 'string' ? value.notes : undefined;

  return {
    type,
    ...(key ? { key } : {}),
    ...(iv ? { iv } : {}),
    ...(notes ? { notes } : {}),
  };
}

function parseProtocolMessage(value: unknown, index: number): ProtocolMessage {
  if (!isRecord(value)) {
    throw new Error(`messages[${index}] must be an object`);
  }

  const direction = value.direction;
  const timestamp = value.timestamp;
  const fields = value.fields;
  const raw = value.raw;

  if (direction !== 'req' && direction !== 'res') {
    throw new Error(`messages[${index}].direction must be "req" or "res"`);
  }

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new Error(`messages[${index}].timestamp must be a number`);
  }

  if (!isRecord(fields)) {
    throw new Error(`messages[${index}].fields must be an object`);
  }

  if (typeof raw !== 'string') {
    throw new Error(`messages[${index}].raw must be a string`);
  }

  return { direction, timestamp, fields, raw };
}

export class ProtocolAnalysisHandlers {
  constructor(
    private engine?: ProtocolPatternEngine,
    private inferrer?: StateMachineInferrer,
    private eventBus?: EventBus<ServerEventMap>,
  ) {}

  async handleDefinePattern(args: ToolArgs): Promise<{
    patternId: string;
    pattern: ProtocolPattern;
    success?: boolean;
    error?: string;
  }> {
    try {
      const name =
        typeof args.name === 'string' && args.name.trim().length > 0
          ? args.name
          : 'unnamed_pattern';
      const specObject = argObject(args, 'spec');
      if (specObject) {
        const spec = parsePatternSpec(name, specObject);
        this.getEngine().definePattern(name, spec);
        return {
          patternId: name,
          pattern: this.getEngine().getPattern(name) ?? {
            name,
            fields: [],
            byteOrder: 'big',
          },
          success: true,
        };
      }

      const rawFields = Array.isArray(args.fields) ? args.fields : [];
      const fields = rawFields.map((field, index) => parseLegacyField(field, index));
      const byteOrder =
        args.byteOrder === 'little' || args.byteOrder === 'big' ? args.byteOrder : undefined;
      const encryption = parseEncryptionInfo(args.encryption);
      const pattern = this.getEngine().definePattern(name, fields, {
        ...(byteOrder ? { byteOrder } : {}),
        ...(encryption ? { encryption } : {}),
      });

      return { patternId: name, pattern, success: true };
    } catch (error) {
      return {
        patternId: 'error',
        pattern: {
          name: 'error',
          fields: [],
          byteOrder: 'big',
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleAutoDetect(args: ToolArgs): Promise<{
    patterns: ProtocolPattern[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const hexPayloads = (() => {
        const newPayloads = argStringArray(args, 'hexPayloads');
        if (newPayloads.length > 0) {
          return newPayloads;
        }

        return argStringArray(args, 'payloads');
      })();
      const detected = this.getEngine().autoDetect(hexPayloads);
      const patternName =
        typeof args.name === 'string' && args.name.trim().length > 0 ? args.name : undefined;

      if (!detected) {
        const fallback = this.getEngine().autoDetectPattern(
          [],
          patternName ? { name: patternName } : {},
        );
        return { patterns: [fallback], success: true };
      }

      const namedPattern: PatternSpec = {
        ...detected,
        name: patternName ?? detected.name,
      };
      this.getEngine().definePattern(namedPattern.name, namedPattern);
      const result = this.getEngine().getPattern(namedPattern.name) ?? {
        name: namedPattern.name,
        fields: [],
        byteOrder: 'big',
      };
      void this.eventBus?.emit('protocol:pattern_detected', {
        patternName: namedPattern.name,
        confidence: 0,
        timestamp: new Date().toISOString(),
      });
      return {
        patterns: [result],
        success: true,
      };
    } catch (error) {
      return {
        patterns: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleInferFields(
    args: ToolArgs,
  ): Promise<{ fields: FieldSpec[]; success?: boolean; error?: string }> {
    try {
      const hexPayloads = argStringArray(args, 'hexPayloads');
      const fields = this.getEngine().inferFields(hexPayloads);
      return { success: true, fields };
    } catch (error) {
      return {
        fields: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleExportSchema(args: ToolArgs): Promise<{ schema: string }> {
    try {
      const patternId = argStringRequired(args, 'patternId');
      const pattern = this.getEngine().getPattern(patternId);
      if (!pattern) {
        return { schema: `// Error: pattern '${patternId}' not found` };
      }

      return { schema: this.getEngine().exportProto(pattern) };
    } catch (error) {
      return {
        schema: `// Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async handleInferStateMachine(args: ToolArgs): Promise<{
    stateMachine: StateMachine;
    mermaid?: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const rawMessages = args.messages;
      if (!Array.isArray(rawMessages)) {
        throw new Error('messages must be an array');
      }

      const hasLegacyShape = rawMessages.some(
        (message) =>
          isRecord(message) && (message.direction === 'in' || message.direction === 'out'),
      );

      let stateMachine: StateMachine;
      if (hasLegacyShape) {
        const legacyMessages = rawMessages.map((message, index) => {
          if (!isRecord(message)) {
            throw new Error(`messages[${index}] must be an object`);
          }

          const direction = message.direction;
          const payloadHex = typeof message.payloadHex === 'string' ? message.payloadHex : '';
          const timestamp = typeof message.timestamp === 'number' ? message.timestamp : undefined;
          const payload = Buffer.from(payloadHex.replace(/\s+/g, ''), 'hex');

          if (direction !== 'in' && direction !== 'out') {
            throw new Error(`messages[${index}].direction must be "in" or "out"`);
          }

          const legacyDirection: 'in' | 'out' = direction;
          return {
            direction: legacyDirection,
            payload,
            ...(timestamp !== undefined ? { timestamp } : {}),
          };
        });
        stateMachine = this.getInferrer().inferStateMachine(legacyMessages);
      } else {
        const messages = rawMessages.map((message, index) => parseProtocolMessage(message, index));
        stateMachine = this.getInferrer().infer(messages);
      }

      if (args.simplify === true) {
        stateMachine = this.getInferrer().simplify(stateMachine);
      }

      return {
        stateMachine,
        mermaid: this.getInferrer().generateMermaid(stateMachine),
        success: true,
      };
    } catch (error) {
      return {
        stateMachine: {
          states: [],
          transitions: [],
          initial: '',
          initialState: '',
          finalStates: [],
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleVisualizeState(args: ToolArgs): Promise<{ mermaidDiagram: string }> {
    try {
      const stateMachineValue = args.stateMachine;
      if (!isRecord(stateMachineValue)) {
        return {
          mermaidDiagram: this.getInferrer().generateMermaid({
            states: [],
            transitions: [],
            initial: '',
            initialState: '',
            finalStates: [],
          }),
        };
      }

      const states = Array.isArray(stateMachineValue.states) ? stateMachineValue.states : [];
      const transitions = Array.isArray(stateMachineValue.transitions)
        ? stateMachineValue.transitions
        : [];
      const initialState =
        typeof stateMachineValue.initialState === 'string' ? stateMachineValue.initialState : '';
      const finalStates = Array.isArray(stateMachineValue.finalStates)
        ? stateMachineValue.finalStates.filter(
            (state): state is string => typeof state === 'string',
          )
        : [];

      return {
        mermaidDiagram: this.getInferrer().generateMermaid({
          states: states.filter((state): state is StateMachine['states'][number] =>
            isRecord(state),
          ),
          transitions: transitions.filter(
            (transition): transition is StateMachine['transitions'][number] => isRecord(transition),
          ),
          initial: initialState,
          initialState,
          finalStates,
        }),
      };
    } catch (error) {
      return {
        mermaidDiagram: `stateDiagram-v2\n  note right of empty: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private getEngine(): ProtocolPatternEngine {
    if (!this.engine) {
      this.engine = new ProtocolPatternEngine();
    }

    return this.engine;
  }

  private getInferrer(): StateMachineInferrer {
    if (!this.inferrer) {
      this.inferrer = new StateMachineInferrer();
    }

    return this.inferrer;
  }
}
