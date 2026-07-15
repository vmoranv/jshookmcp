import { unlinkSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSHOOK_INSTANCE_WARN_AT, JSHOOK_MAX_INSTANCES } from '@src/constants';
import { getStateDir } from '@server/persistence/RuntimeSnapshotScheduler';
import { logger } from '@utils/logger';

export interface InstanceRecord {
  pid: number;
  ppid: number;
  startedAt: string;
  transport: string;
  profile: string;
  argv0: string;
}

export interface InstanceRegistrationResult {
  self: InstanceRecord;
  livePeers: InstanceRecord[];
  liveCount: number;
  warned: boolean;
  blocked: boolean;
}

function instancesDir(): string {
  return resolve(getStateDir(), 'instances');
}

function recordPath(pid: number): string {
  return resolve(instancesDir(), `${pid}.json`);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'EPERM'
    );
  }
}

async function readRecord(filePath: string): Promise<InstanceRecord | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstanceRecord>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) return null;
    return {
      pid: parsed.pid,
      ppid: typeof parsed.ppid === 'number' ? parsed.ppid : 0,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      transport: typeof parsed.transport === 'string' ? parsed.transport : 'unknown',
      profile: typeof parsed.profile === 'string' ? parsed.profile : 'unknown',
      argv0: typeof parsed.argv0 === 'string' ? parsed.argv0 : '',
    };
  } catch {
    return null;
  }
}

export async function listLiveInstances(selfPid: number = process.pid): Promise<InstanceRecord[]> {
  const dir = instancesDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const live: InstanceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const filePath = resolve(dir, name);
    const record = await readRecord(filePath);
    if (!record) {
      await unlink(filePath).catch(() => undefined);
      continue;
    }
    if (record.pid === selfPid) continue;
    if (!isProcessAlive(record.pid)) {
      await unlink(filePath).catch(() => undefined);
      continue;
    }
    live.push(record);
  }
  return live;
}

function formatRssMb(): string {
  try {
    const rss = process.memoryUsage().rss;
    return `${(rss / (1024 * 1024)).toFixed(0)}MB`;
  } catch {
    return 'n/a';
  }
}

export async function registerServerInstance(options?: {
  transport?: string;
  profile?: string;
}): Promise<InstanceRegistrationResult> {
  const self: InstanceRecord = {
    pid: process.pid,
    ppid: process.ppid,
    startedAt: new Date().toISOString(),
    transport: options?.transport ?? process.env.MCP_TRANSPORT ?? 'stdio',
    profile: options?.profile ?? process.env.MCP_TOOL_PROFILE ?? 'search',
    argv0: process.argv[1] ?? process.argv0 ?? 'jshook',
  };

  const peers = await listLiveInstances(self.pid);
  const liveCountIfRegistered = peers.length + 1;
  const maxInstances = JSHOOK_MAX_INSTANCES;
  const blocked = maxInstances > 0 && liveCountIfRegistered > maxInstances;

  if (blocked) {
    const peerSummary = peers.map((p) => `${p.pid}(${p.profile}/${p.transport})`).join(', ');
    throw new Error(
      `jshook instance limit reached: ${liveCountIfRegistered} > JSHOOK_MAX_INSTANCES=${maxInstances}. ` +
        `Live peers: ${peerSummary || '(none)'}. ` +
        `Stop unused MCP hosts or raise the limit. Prefer a single HTTP server ` +
        `(MCP_TRANSPORT=http) shared across clients instead of per-host stdio spawns.`,
    );
  }

  try {
    await mkdir(instancesDir(), { recursive: true });
    await writeFile(recordPath(self.pid), JSON.stringify(self, null, 2), 'utf8');
  } catch (err) {
    logger.warn(
      `[instance] failed to write instance file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const warnAt = Math.max(1, JSHOOK_INSTANCE_WARN_AT);
  const warned = liveCountIfRegistered >= warnAt;
  if (warned) {
    const peerSummary = peers
      .map((p) => `pid=${p.pid} profile=${p.profile} transport=${p.transport}`)
      .join('; ');
    logger.warn(
      `[instance] ${liveCountIfRegistered} live jshook processes detected ` +
        `(self pid=${self.pid} rss=${formatRssMb()}). ` +
        `Each MCP host spawns its own stdio process and can hold hundreds of MB–GB. ` +
        `Peers: ${peerSummary || '(none)'}. ` +
        `Mitigations: disable unused MCP configs, set SEARCH_VECTOR_PREWARM=false ` +
        `(default), SEARCH_VECTOR_ENABLED=false, or run one shared HTTP instance. ` +
        `Hard-cap with JSHOOK_MAX_INSTANCES=N.`,
    );
  } else {
    logger.info(
      `[instance] registered pid=${self.pid} transport=${self.transport} ` +
        `profile=${self.profile} rss=${formatRssMb()} peers=${peers.length}`,
    );
  }

  const cleanupSync = () => {
    try {
      unlinkSync(recordPath(self.pid));
    } catch {}
  };
  process.once('exit', cleanupSync);
  process.once('SIGINT', () => {
    void unregisterServerInstance(self.pid);
  });
  process.once('SIGTERM', () => {
    void unregisterServerInstance(self.pid);
  });

  return {
    self,
    livePeers: peers,
    liveCount: liveCountIfRegistered,
    warned,
    blocked: false,
  };
}

export async function unregisterServerInstance(pid: number = process.pid): Promise<void> {
  try {
    await unlink(recordPath(pid));
  } catch {}
}
