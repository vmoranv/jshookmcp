import { VersionDetector } from '@modules/v8-inspector/VersionDetector';

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface ScriptSourceResponse {
  scriptSource?: unknown;
}

interface CoverageResponse {
  result?: unknown;
}

export interface ExtractedBytecode {
  functionName: string;
  bytecode: string;
  sourcePosition?: number;
}

export interface DisassembledInstruction {
  offset: number;
  opcode: string;
  operands: string[];
}

export interface HiddenClassInfo {
  address: string;
  properties: string[];
  transitionMap?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value['createCDPSession'] === 'function';
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function splitOperands(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function inferOpcode(line: string): { opcode: string; operands: string[] } {
  const trimmed = line.trim();
  if (trimmed.startsWith('function ')) return { opcode: 'FunctionDeclaration', operands: [] };
  if (trimmed.startsWith('return '))
    return { opcode: 'Return', operands: [trimmed.slice('return '.length)] };
  if (trimmed.includes('=>')) return { opcode: 'CreateClosure', operands: [] };
  if (trimmed.includes('(') && trimmed.includes(')')) {
    const nameMatch = /^([A-Za-z_$][\w$]*)\(/u.exec(trimmed);
    if (nameMatch?.[1]) return { opcode: 'Call', operands: [nameMatch[1]] };
  }
  if (trimmed.includes('=')) {
    const parts = trimmed.split('=', 2);
    const left = parts[0];
    const right = parts[1];
    if (left && right) return { opcode: 'Store', operands: [left.trim(), right.trim()] };
  }
  if (trimmed.startsWith('if ')) return { opcode: 'JumpIfTrue', operands: [trimmed] };
  if (trimmed.startsWith('for ') || trimmed.startsWith('while '))
    return { opcode: 'Loop', operands: [trimmed] };
  if (trimmed.startsWith('{') || trimmed.startsWith('const ') || trimmed.startsWith('let ')) {
    return { opcode: 'LoadLiteral', operands: [trimmed] };
  }
  return { opcode: 'Evaluate', operands: [trimmed] };
}

function buildPseudoBytecode(source: string): string {
  const instructions: string[] = ['; pseudo-bytecode synthesized from script source'];
  let offset = 0;
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const { opcode, operands } = inferOpcode(trimmed);
    const operandText = operands.join(', ');
    instructions.push(`${offset} ${opcode}${operandText.length > 0 ? ` ${operandText}` : ''}`);
    offset += 1;
  }
  return instructions.join('\n');
}

function inferFunctionName(source: string, functionOffset?: number): string {
  if (typeof functionOffset === 'number' && functionOffset >= 0 && functionOffset < source.length) {
    const start = Math.max(0, functionOffset - 120);
    const end = Math.min(source.length, functionOffset + 120);
    const nearby = source.slice(start, end);
    const namedFunction = /function\s+([A-Za-z_$][\w$]*)/u.exec(nearby);
    if (namedFunction?.[1]) return namedFunction[1];
    const assignedFunction = /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/u.exec(nearby);
    if (assignedFunction?.[1]) return assignedFunction[1];
  }
  const firstNamedFunction = /function\s+([A-Za-z_$][\w$]*)/u.exec(source);
  return firstNamedFunction?.[1] ?? 'anonymous';
}

function findObjectLiteralProperties(source: string): HiddenClassInfo[] {
  const matches = source.matchAll(/\{([^{}]+:[^{}]+)\}/gu);
  const results: HiddenClassInfo[] = [];
  let index = 0;
  for (const match of matches) {
    const body = match[1];
    if (!body) continue;
    const properties = body
      .split(',')
      .map((entry) => entry.trim())
      .map((entry) => {
        const [key] = entry.split(':', 1);
        return key?.trim() ?? '';
      })
      .filter((entry) => entry.length > 0)
      .filter((entry, position, list) => list.indexOf(entry) === position);
    if (properties.length === 0) continue;
    results.push({
      address: `hidden-class-${index}`,
      properties,
      transitionMap: properties.length > 1 ? properties.join(' -> ') : undefined,
    });
    index += 1;
  }
  return results;
}

export class BytecodeExtractor {
  private readonly versionDetector: VersionDetector;

  constructor(private readonly getPage?: () => Promise<unknown>) {
    this.versionDetector = new VersionDetector(getPage);
  }

  async extractBytecode(
    scriptId: string,
    functionOffset?: number,
  ): Promise<ExtractedBytecode | null> {
    const scriptSource = await this.getScriptSource(scriptId);
    if (!scriptSource) {
      return null;
    }

    const functions = await this.getCoverageFunctions(scriptId);
    const functionByOffset =
      typeof functionOffset === 'number'
        ? functions.find(
            (candidate) =>
              functionOffset >= candidate.startOffset && functionOffset <= candidate.endOffset,
          )
        : undefined;

    const functionName =
      functionByOffset?.functionName && functionByOffset.functionName.length > 0
        ? functionByOffset.functionName
        : inferFunctionName(scriptSource, functionOffset);

    const sourceSlice =
      functionByOffset && functionByOffset.endOffset > functionByOffset.startOffset
        ? scriptSource.slice(functionByOffset.startOffset, functionByOffset.endOffset)
        : scriptSource;

    void (await this.versionDetector.supportsNativesSyntax());
    const bytecode = buildPseudoBytecode(sourceSlice);

    return {
      functionName,
      bytecode,
      sourcePosition:
        typeof functionOffset === 'number'
          ? functionOffset
          : functionByOffset
            ? functionByOffset.startOffset
            : undefined,
    };
  }

  disassembleBytecode(bytecode: string): DisassembledInstruction[] {
    const instructions: DisassembledInstruction[] = [];
    for (const line of bytecode.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith(';')) continue;
      const match =
        /^(\d+)\s*@\s*([A-Za-z_][\w.]*)\s*(.*)$/u.exec(trimmed) ??
        /^(?:0x[0-9a-fA-F]+\s+@)?\s*(\d+)\s*[: ]\s*([A-Za-z_][\w.]*)\s*(.*)$/u.exec(trimmed) ??
        /^(\d+)\s+([A-Za-z_][\w.]*)\s*(.*)$/u.exec(trimmed);
      if (!match) continue;
      const offset = Number(match[1]);
      if (!Number.isFinite(offset)) continue;
      instructions.push({
        offset,
        opcode: match[2] ?? 'Unknown',
        operands: splitOperands(match[3] ?? ''),
      });
    }
    return instructions;
  }

  async findHiddenClasses(scriptId: string): Promise<HiddenClassInfo[]> {
    const scriptSource = await this.getScriptSource(scriptId);
    if (!scriptSource) return [];
    return findObjectLiteralProperties(scriptSource);
  }

  private async getCoverageFunctions(
    scriptId: string,
  ): Promise<Array<{ functionName: string; startOffset: number; endOffset: number }>> {
    const session = await this.createSession();
    if (!session) return [];

    try {
      await session.send('Profiler.enable');
      await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      const response = await session.send<CoverageResponse>('Profiler.takePreciseCoverage');
      const result = isRecord(response) ? toRecordArray(response['result']) : [];
      const targetScript = result.find(
        (entry) => typeof entry['scriptId'] === 'string' && entry['scriptId'] === scriptId,
      );
      if (!targetScript) return [];
      const functions = toRecordArray(targetScript['functions']);
      const extracted: Array<{ functionName: string; startOffset: number; endOffset: number }> = [];
      for (const fn of functions) {
        const ranges = toRecordArray(fn['ranges']);
        const primaryRange = ranges[0];
        if (!primaryRange) continue;
        const startOffset = toNumber(primaryRange['startOffset']);
        const endOffset = toNumber(primaryRange['endOffset']);
        if (startOffset === null || endOffset === null) continue;
        extracted.push({
          functionName: toStringValue(fn['functionName']) ?? 'anonymous',
          startOffset,
          endOffset,
        });
      }
      return extracted;
    } catch {
      return [];
    } finally {
      await session.send('Profiler.stopPreciseCoverage').catch(() => undefined);
      await session.send('Profiler.disable').catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  }

  private async getScriptSource(scriptId: string): Promise<string | null> {
    const session = await this.createSession();
    if (!session) return null;

    try {
      await session.send('Debugger.enable');
      const response = await session.send<ScriptSourceResponse>('Debugger.getScriptSource', {
        scriptId,
      });
      if (!isRecord(response)) return null;
      const scriptSource = response['scriptSource'];
      return typeof scriptSource === 'string' ? scriptSource : null;
    } catch {
      return null;
    } finally {
      await session.send('Debugger.disable').catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  }

  private async createSession(): Promise<CDPSessionLike | null> {
    if (!this.getPage) return null;
    try {
      const page = await this.getPage();
      if (!isCDPPageLike(page)) return null;
      return await page.createCDPSession();
    } catch {
      return null;
    }
  }
}
