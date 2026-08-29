import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import { TaskManager } from '@server/tasks/TaskManager';
import { buildPcapng } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng-writer';
import type { PcapngWriteInput } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng';

describe('ProtocolAnalysisHandlers — handlePcapngRead async (MCP 2.0 Tasks)', () => {
  const eventBus = { emit: vi.fn() } as any;
  const tempDirs: string[] = [];
  let handlers: ProtocolAnalysisHandlers;
  let taskManager: TaskManager;

  const writeSample = async (): Promise<string> => {
    const input: PcapngWriteInput = {
      endianness: 'little',
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'aabbccdd' }],
    };
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-task-'));
    tempDirs.push(dir);
    const path = join(dir, 'sample.pcapng');
    await fsWriteFile(path, buildPcapng(input));
    return path;
  };

  beforeEach(() => {
    eventBus.emit.mockClear();
    taskManager = new TaskManager();
    // 4th ctor arg — the MCP 2.0 Tasks retrofit wiring from the manifest.
    handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus, taskManager);
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it('async:true returns a taskId immediately and the task completes with the parse result', async () => {
    const path = await writeSample();

    const res = await handlers.handlePcapngRead({ path, async: true });

    expect(res.success).toBe(true);
    expect(res.async).toBe(true);
    expect(typeof res.taskId).toBe('string');
    expect(res.blockCount).toBe(0); // payload is delivered via the task, not inline

    // Poll briefly until the background parse settles.
    let payload = taskManager.getTaskPayload<{ blockCount: number; packets: unknown[] }>(
      res.taskId!,
    );
    for (let i = 0; i < 50 && payload?.status === 'working'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      payload = taskManager.getTaskPayload<{ blockCount: number; packets: unknown[] }>(res.taskId!);
    }
    expect(payload?.status).toBe('completed');
    expect(payload?.result?.blockCount).toBe(3); // SHB + IDB + EPB
    expect(payload?.result?.packets).toHaveLength(1);
  });

  it('async without a taskManager falls back to the synchronous parse', async () => {
    const path = await writeSample();
    const legacy = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);

    const res = await legacy.handlePcapngRead({ path, async: true });

    expect(res.success).toBe(true);
    expect(res.async).toBeUndefined();
    expect(res.blockCount).toBe(3);
  });

  it('sync path (no async flag) behaves exactly as before the retrofit', async () => {
    const path = await writeSample();

    const res = await handlers.handlePcapngRead({ path });

    expect(res.success).toBe(true);
    expect(res.async).toBeUndefined();
    expect(res.blockCount).toBe(3);
    expect(res.packets).toHaveLength(1);
  });

  it('task mode surfaces parse failures through the task payload', async () => {
    const res = await handlers.handlePcapngRead({ path: 'Z:/nope/missing.pcapng', async: true });

    expect(res.success).toBe(true);
    // Give the executor a beat to reject before inspecting the payload.
    await new Promise((r) => setTimeout(r, 50));
    const payload = taskManager.getTaskPayload(res.taskId!);
    expect(payload?.status).toBe('failed');
    expect(String(payload?.error)).toBeTruthy();
  });
});
