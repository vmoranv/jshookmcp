import { writeFile } from 'node:fs/promises';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import { disassembleInstruction } from '@modules/native-emulator/disasm';
import { resolveArtifactPath } from '@utils/artifacts';

// Register names that select a SIMD/FP vector alias (v/q/d/s/h/b) rather than a
// GPR (x0..x30/sp/pc). Routed through TraceEvent.vector() so a trace can capture
// the AES/SHA/PMULL/scalar-FP hot path, not just the integer register file.
const VECTOR_RE = /^[vqdshb]\d{1,2}$/i;

export function traceRow(ev: TraceEvent, captureRegisters: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {
    step: ev.step,
    pc: `0x${ev.pc.toString(16)}`,
    insn: `0x${ev.insn.toString(16).padStart(8, '0')}`,
    asm: disassembleInstruction('arm64', ev.insn, BigInt(ev.pc)),
  };
  if (captureRegisters.length > 0) {
    const regs: Record<string, number | string> = {};
    for (const name of captureRegisters) {
      regs[name] = VECTOR_RE.test(name) ? ev.vector(name) : ev.reg(name);
    }
    row.registers = regs;
  }
  return row;
}

export async function persistTraceArtifact(
  sessionId: string,
  symbol: string,
  result: number,
  trace: Array<Record<string, unknown>>,
  truncated: boolean,
): Promise<Record<string, unknown>> {
  const artifact = await resolveArtifactPath({
    category: 'traces',
    toolName: 'nemu_trace',
    target: symbol,
    ext: 'json',
  });
  const payload = {
    schema: 'jshookmcp.native-emulator.trace.v1',
    sessionId,
    symbol,
    result,
    steps: trace.length,
    truncated,
    trace,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(artifact.absolutePath, body, 'utf8');
  return {
    category: 'traces',
    path: artifact.displayPath,
    eventCount: trace.length,
    bytes: Buffer.byteLength(body, 'utf8'),
  };
}
