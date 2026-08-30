/** Tracks live jshook server processes to make stdio process pile-ups visible and controllable. */
import { unlinkSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSHOOK_INSTANCE_WARN_AT, JSHOOK_MAX_INSTANCES } from '@src/constants';
import { getStateDir } from '@server/persistence/RuntimeSnapshotScheduler';
import { logger } from '@utils/logger';
import { readEnvString } from '@src/config/environment';

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

const registrationLockPath = () => resolve(instancesDir(), '.register-lock');

async function withRegistrationLock<T>(callback: () => Promise<T>): Promise<T> {
  await mkdir(instancesDir(), { recursive: true });
  const deadline = Date.now() + 5_000;

  while (true) {
    try {
      await mkdir(registrationLockPath());
      break;
    } catch (error) {
      if (
        !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
      ) {
        throw new Error('failed to acquire the instance registration lock', { cause: error });
      }

      try {
        const lockInfo = await stat(registrationLockPath());
        if (Date.now() - lockInfo.mtimeMs > 30_000) {
          await rm(registrationLockPath(), { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock was released between mkdir and stat; retry immediately.
      }

      if (Date.now() >= deadline) {
        throw new Error('timed out waiting for the instance registration lock', { cause: error });
      }
      await delay(25);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(registrationLockPath(), { recursive: true, force: true });
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    );
  }
}

async function readRecord(filePath: string): Promise<InstanceRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<InstanceRecord>;
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

export async function listLiveInstances(selfPid = process.pid): Promise<InstanceRecord[]> {
  let names: string[];
  try {
    names = await readdir(instancesDir());
  } catch {
    return [];
  }

  const live: InstanceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const filePath = resolve(instancesDir(), name);
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
  return `${(process.memoryUsage().rss / (1024 * 1024)).toFixed(0)}MB`;
}

export async function registerServerInstance(options?: {
  transport?: string;
  profile?: string;
}): Promise<InstanceRegistrationResult> {
  const self: InstanceRecord = {
    pid: process.pid,
    ppid: process.ppid,
    startedAt: new Date().toISOString(),
    transport: options?.transport ?? readEnvString('MCP_TRANSPORT', 'stdio', { trim: true }),
    profile: options?.profile ?? readEnvString('MCP_TOOL_PROFILE', 'search', { trim: true }),
    argv0: process.argv[1] ?? process.argv0 ?? 'jshook',
  };
  return withRegistrationLock(async () => {
    const peers = await listLiveInstances(self.pid);
    const liveCount = peers.length + 1;

    if (JSHOOK_MAX_INSTANCES > 0 && liveCount > JSHOOK_MAX_INSTANCES) {
      const peerSummary = peers
        .map((peer) => `${peer.pid}(${peer.profile}/${peer.transport})`)
        .join(', ');
      throw new Error(
        `jshook instance limit reached: ${liveCount} > JSHOOK_MAX_INSTANCES=${JSHOOK_MAX_INSTANCES}. ` +
          `Live peers: ${peerSummary || '(none)'}. Stop unused MCP hosts, raise the limit, or share one ` +
          `HTTP server across clients.`,
      );
    }

    try {
      await mkdir(instancesDir(), { recursive: true });
      await writeFile(recordPath(self.pid), JSON.stringify(self, null, 2), 'utf8');
    } catch (error) {
      logger.warn(
        `[instance] failed to write instance record: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Post-registration re-check: closes the check-then-act race window where
    // concurrent registrations all pass the pre-check above and collectively
    // exceed the cap. Roll our own record back when the cap is exceeded.
    const postPeers = await listLiveInstances(self.pid);
    const postLiveCount = postPeers.length + 1;
    if (JSHOOK_MAX_INSTANCES > 0 && postLiveCount > JSHOOK_MAX_INSTANCES) {
      await unregisterServerInstance(self.pid).catch(() => undefined);
      const peerSummary = postPeers
        .map((peer) => `${peer.pid}(${peer.profile}/${peer.transport})`)
        .join(', ');
      throw new Error(
        `jshook instance limit reached: ${postLiveCount} > JSHOOK_MAX_INSTANCES=${JSHOOK_MAX_INSTANCES}. ` +
          `Live peers: ${peerSummary || '(none)'}. Stop unused MCP hosts, raise the limit, or share one ` +
          `HTTP server across clients.`,
      );
    }

    const warned = postLiveCount >= Math.max(1, JSHOOK_INSTANCE_WARN_AT);
    if (warned) {
      const peerSummary = postPeers
        .map((peer) => `pid=${peer.pid} profile=${peer.profile} transport=${peer.transport}`)
        .join('; ');
      logger.warn(
        `[instance] ${postLiveCount} live jshook processes detected (self pid=${self.pid} rss=${formatRssMb()}). ` +
          `Each stdio MCP host owns a separate process. Peers: ${peerSummary || '(none)'}. ` +
          `Disable unused MCP entries, configure JSHOOK_MAX_INSTANCES, or use one shared HTTP server.`,
      );
    } else {
      logger.info(
        `[instance] registered pid=${self.pid} transport=${self.transport} profile=${self.profile} ` +
          `rss=${formatRssMb()} peers=${postPeers.length}`,
      );
    }

    process.once('exit', () => {
      try {
        unlinkSync(recordPath(self.pid));
      } catch {
        // The async shutdown path may already have removed it.
      }
    });

    return { self, livePeers: postPeers, liveCount: postLiveCount, warned, blocked: false };
  });
}

export async function unregisterServerInstance(pid = process.pid): Promise<void> {
  await unlink(recordPath(pid)).catch(() => undefined);
}
