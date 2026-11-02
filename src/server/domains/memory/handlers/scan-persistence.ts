/**
 * Disk-Based Scan Persistence — CrySearch / CE parity.
 *
 * When memory_first_scan is called with persistToDisk=true, scan results are
 * streamed to a temporary binary file instead of held entirely in memory.
 * This enables scans with millions of addresses without exhausting RAM.
 *
 * File format: contiguous [8-byte LE address][8-byte LE value] records.
 * Each record is 16 bytes. A 100M-address scan produces a ~1.6 GB file.
 *
 * Limits:
 * - Maximum 100 million addresses (~1.6 GB file)
 * - Above that, the scan is rejected with "narrow first" guidance
 * - Maximum DISK_SCAN_MAX_SESSIONS concurrent sessions (env-overridable)
 * - Idle sessions expire after DISK_SCAN_SESSION_TTL_MS (unref'd sweep,
 *   wired at init), deleting the registry entry and unlinking the backing file
 * - initDiskScanPersistence() wires the sweep synchronously and reclaims
 *   stale jshook-scan-*.bin orphan files asynchronously (unref'd deferred
 *   timer, off the domain-activation critical path)
 *
 * The persisted file is referenced by a sessionId and can be used as input
 * to memory_next_scan, which reads from disk instead of in-memory session.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  DISK_SCAN_MAX_SESSIONS,
  DISK_SCAN_SESSION_SWEEP_MS,
  DISK_SCAN_SESSION_TTL_MS,
} from '@src/constants/memory';

/** Maximum addresses when persisting to disk (100M). */
export const MAX_DISK_SCAN_ADDRESSES = 100_000_000;

/** Bytes per record: 8-byte address (LE) + 8-byte value (LE) = 16 bytes. */
export const DISK_RECORD_SIZE = 16;

/** Max concurrent stat/unlink pairs during orphan cleanup. */
const ORPHAN_CLEANUP_CONCURRENCY = 8;

export interface DiskScanSession {
  sessionId: string;
  filePath: string;
  totalRecords: number;
  valueType: string;
  /** Epoch ms of session creation. */
  createdAt: number;
  /** Epoch ms of the most recent read/write access (idle-sweep input). */
  lastUsedAt: number;
}

/** In-memory registry of active disk scan sessions. */
const diskSessions = new Map<string, DiskScanSession>();

/** Backing-file naming pattern produced by createDiskScanSession (orphan cleanup). */
const DISK_SCAN_FILE_PATTERN = /^jshook-scan-[a-zA-Z0-9_-]+\.bin$/;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let deferredCleanupTimer: ReturnType<typeof setTimeout> | null = null;

function touchSession(session: DiskScanSession): void {
  session.lastUsedAt = Date.now();
}

/** Start the unref'd expiry sweep. Idempotent; sessions auto-expire once created. */
function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpiredDiskSessions(), DISK_SCAN_SESSION_SWEEP_MS);
  // Don't keep the event loop (and thus the process) alive for the sweep.
  if (sweepTimer.unref) sweepTimer.unref();
}

function sweepExpiredDiskSessions(): void {
  const now = Date.now();
  for (const session of diskSessions.values()) {
    if (now - session.lastUsedAt >= DISK_SCAN_SESSION_TTL_MS) {
      deleteDiskScanSession(session.sessionId);
    }
  }
}

/**
 * Startup initialization: wire the unref'd expiry sweep synchronously (timer
 * registration is cheap) and trigger orphan reclamation asynchronously off
 * the init critical path. Orphan cleanup is tmp-directory I/O and must never
 * delay domain activation; the deferred timer is unref'd so it cannot hold
 * the process open either. Idempotent; call once from the memory domain
 * ensure (or a constructor).
 */
export function initDiskScanPersistence(): void {
  ensureSweepTimer();
  if (!deferredCleanupTimer) {
    deferredCleanupTimer = setTimeout(() => {
      deferredCleanupTimer = null;
      void cleanupOrphanDiskScanFiles();
    }, 0);
    deferredCleanupTimer.unref();
  }
}

/**
 * Reclaim orphaned `jshook-scan-*.bin` files left in the tmp directory by a
 * crashed process. Files younger than the session TTL are kept (they may
 * belong to a scan session owned by another process). Async so the deferred
 * trigger never blocks the event loop.
 */
export async function cleanupOrphanDiskScanFiles(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(os.tmpdir());
  } catch {
    return;
  }
  const now = Date.now();

  const reclaim = async (name: string): Promise<void> => {
    if (!DISK_SCAN_FILE_PATTERN.test(name)) return;
    const filePath = path.join(os.tmpdir(), name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return;
      // Only reclaim files stale beyond the session TTL.
      if (now - stat.mtimeMs >= DISK_SCAN_SESSION_TTL_MS) {
        await fs.promises.unlink(filePath);
      }
    } catch {
      // Best-effort: a racing writer or a vanished file is not an error.
    }
  };

  // Bound I/O concurrency: process the directory in fixed batches so a tmp dir
  // with thousands of orphans doesn't fan out that many stat/unlink calls at
  // once (which could exhaust file descriptors).
  for (let i = 0; i < entries.length; i += ORPHAN_CLEANUP_CONCURRENCY) {
    await Promise.all(entries.slice(i, i + ORPHAN_CLEANUP_CONCURRENCY).map(reclaim));
  }
}

/**
 * Stop the sweep timer, cancel any deferred cleanup, and delete every
 * registered session. Exposed for tests and graceful shutdown; the unref'd
 * timers are safe to leave running otherwise.
 */
export function disposeDiskScanPersistence(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  if (deferredCleanupTimer) {
    clearTimeout(deferredCleanupTimer);
    deferredCleanupTimer = null;
  }
  for (const session of diskSessions.values()) {
    deleteDiskScanSession(session.sessionId);
  }
}

/**
 * Create a new disk-backed scan session.
 * Returns a session object. The file is created and opened for writing.
 */
export function createDiskScanSession(
  sessionId: string,
  valueType: string,
  tmpDir?: string,
): DiskScanSession {
  ensureSweepTimer();
  if (diskSessions.size >= DISK_SCAN_MAX_SESSIONS) {
    throw new Error(
      `Disk scan session limit reached (${DISK_SCAN_MAX_SESSIONS}); ` +
        'delete a session first or wait for idle expiry',
    );
  }
  const dir = tmpDir ?? os.tmpdir();
  const fileName = `jshook-scan-${sessionId.replace(/[^a-zA-Z0-9\-_]/g, '_')}.bin`;
  const filePath = path.join(dir, fileName);

  // Create the file (truncate if exists)
  fs.writeFileSync(filePath, Buffer.alloc(0));

  const now = Date.now();
  const session: DiskScanSession = {
    sessionId,
    filePath,
    totalRecords: 0,
    valueType,
    createdAt: now,
    lastUsedAt: now,
  };

  diskSessions.set(sessionId, session);
  return session;
}

/**
 * Append address-value pairs to a disk scan session's backing file.
 * Uses streaming append for efficiency.
 */
export function appendToDiskScan(
  sessionId: string,
  records: Array<{ address: bigint; value: bigint }>,
): void {
  const session = diskSessions.get(sessionId);
  if (!session) {
    throw new Error(`Disk scan session "${sessionId}" not found`);
  }
  touchSession(session);

  const newTotal = session.totalRecords + records.length;
  if (newTotal > MAX_DISK_SCAN_ADDRESSES) {
    throw new Error(
      `Disk scan session "${sessionId}" would exceed ${MAX_DISK_SCAN_ADDRESSES} addresses ` +
        `(${newTotal.toLocaleString()}). Narrow the scan before persisting to disk.`,
    );
  }

  // Build a buffer of all records
  const buf = Buffer.allocUnsafe(records.length * DISK_RECORD_SIZE);
  for (let i = 0; i < records.length; i += 1) {
    const offset = i * DISK_RECORD_SIZE;
    const rec = records[i]!;
    buf.writeBigUInt64LE(rec.address, offset);
    buf.writeBigUInt64LE(rec.value, offset + 8);
  }

  // Append to file
  fs.appendFileSync(session.filePath, buf);
  session.totalRecords = newTotal;
}

/**
 * Read all addresses from a persisted disk scan file.
 * Returns address array — for next_scan to filter.
 *
 * NOTE: This loads ALL addresses into memory for the filtering pass.
 * For extremely large scans, this is the tradeoff — addresses must be in
 * memory for the comparator loop. The initial scan result (which might have
 * been 100M+) was streamed to disk to avoid OOM during collection, but
 * next_scan needs to read them back for comparison.
 *
 * In practice, next_scan typically runs after the result set has already been
 * narrowed by one or more filter passes.
 */
export function readAllFromDiskScan(sessionId: string): string[] {
  const session = diskSessions.get(sessionId);
  if (!session) {
    throw new Error(`Disk scan session "${sessionId}" not found`);
  }
  touchSession(session);

  const fd = fs.openSync(session.filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const recordCount = Math.floor(stat.size / DISK_RECORD_SIZE);
    const buf = Buffer.alloc(stat.size);
    fs.readSync(fd, buf, 0, stat.size, 0);

    const addresses: string[] = [];
    for (let i = 0; i < recordCount; i += 1) {
      const offset = i * DISK_RECORD_SIZE;
      const addr = buf.readBigUInt64LE(offset);
      addresses.push(`0x${addr.toString(16).toUpperCase()}`);
    }
    return addresses;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Get disk scan session info. Refreshes the idle clock, so existence checks
 * count as activity for the TTL sweep.
 */
export function getDiskScanSession(sessionId: string): DiskScanSession | undefined {
  const session = diskSessions.get(sessionId);
  if (session) touchSession(session);
  return session;
}

/**
 * Delete a disk scan session and its backing file.
 */
export function deleteDiskScanSession(sessionId: string): boolean {
  const session = diskSessions.get(sessionId);
  if (!session) return false;

  try {
    if (fs.existsSync(session.filePath)) {
      fs.unlinkSync(session.filePath);
    }
  } catch {
    // Best-effort cleanup
  }

  diskSessions.delete(sessionId);
  return true;
}

/**
 * Get total file size in bytes for a disk scan session.
 */
export function getDiskScanFileSize(sessionId: string): number {
  const session = diskSessions.get(sessionId);
  if (!session) return 0;

  try {
    return fs.statSync(session.filePath).size;
  } catch {
    return 0;
  }
}

/**
 * List all active disk scan sessions.
 */
export function listDiskScanSessions(): DiskScanSession[] {
  return [...diskSessions.values()];
}
