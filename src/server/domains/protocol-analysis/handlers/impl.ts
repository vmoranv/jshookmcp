import { ProtocolPatternEngine } from '@modules/protocol-analysis/ProtocolPatternEngine';
import { StateMachineInferrer } from '@modules/protocol-analysis/StateMachineInferrer';
import type { ProtocolPattern, StateMachine } from '@modules/protocol-analysis/types';
import { argString, argStringArray, argBool } from '@server/domains/shared/parse-args';

export class ProtocolAnalysisHandlers {
  private engine: ProtocolPatternEngine;
  private inferrer: StateMachineInferrer;

  constructor() {
    this.engine = new ProtocolPatternEngine();
    this.inferrer = new StateMachineInferrer();
  }

  async handleDefinePattern(args: Record<string, unknown>): Promise<{
    patternId: string;
    pattern: ProtocolPattern;
  }> {
    const name = argString(args, 'name', 'unnamed_pattern');
    const fieldsRaw = args.fields as Array<Record<string, unknown>> | undefined;
    const fields = (fieldsRaw ?? []).map((f) => ({
      name: String(f.name ?? ''),
      type: (f.type ?? 'bytes') as ProtocolPattern['fields'][number]['type'],
      offset: Number(f.offset ?? 0),
      length: Number(f.length ?? 0),
      description: f.description !== undefined ? String(f.description) : undefined,
    }));
    const byteOrder = argString(args, 'byteOrder', 'big') as 'big' | 'little';
    const encryption = args.encryption as ProtocolPattern['encryption'] | undefined;

    const pattern = this.engine.definePattern(name, fields, {
      byteOrder: byteOrder === 'little' ? 'little' : 'big',
      encryption,
    });

    return { patternId: name, pattern };
  }

  async handleAutoDetect(args: Record<string, unknown>): Promise<{
    patterns: ProtocolPattern[];
  }> {
    const payloadsRaw = argStringArray(args, 'payloads');
    const payloads = payloadsRaw.map((hex) => Buffer.from(hex, 'hex'));
    const nameOpt = argString(args, 'name');

    const pattern = this.engine.autoDetectPattern(payloads, { name: nameOpt ?? undefined });
    return { patterns: [pattern] };
  }

  async handleExportSchema(args: Record<string, unknown>): Promise<{
    schema: string;
  }> {
    const patternId = argString(args, 'patternId', '');
    const pattern = this.engine.getPattern(patternId);
    if (!pattern) {
      return { schema: `// Error: pattern '${patternId}' not found` };
    }
    const schema = this.engine.exportProto(pattern);
    return { schema };
  }

  async handleInferStateMachine(args: Record<string, unknown>): Promise<{
    stateMachine: StateMachine;
  }> {
    const messagesRaw = args.messages as Array<Record<string, unknown>> | undefined;
    const messages = (messagesRaw ?? []).map((m) => ({
      direction: (m.direction ?? 'in') as 'in' | 'out',
      payload: Buffer.from(String(m.payloadHex ?? ''), 'hex'),
      timestamp: m.timestamp !== undefined ? Number(m.timestamp) : undefined,
    }));
    const simplify = argBool(args, 'simplify', false);

    let sm = this.inferrer.inferStateMachine(messages);
    if (simplify) {
      sm = this.inferrer.simplify(sm);
    }

    return { stateMachine: sm };
  }

  async handleVisualizeState(args: Record<string, unknown>): Promise<{
    mermaidDiagram: string;
  }> {
    const sm = args.stateMachine as StateMachine | undefined;
    if (!sm) {
      return { mermaidDiagram: 'stateDiagram-v2\n  [*] --> empty' };
    }
    const diagram = this.inferrer.generateMermaid(sm);
    return { mermaidDiagram: diagram };
  }
}
