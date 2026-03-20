/**
 * Scan Session Manager — manages in-memory scan sessions for iterative scanning.
 *
 * Sessions persist scan results across multiple scan iterations, allowing
 * the CE-style workflow: first scan → next scan → narrow down → find target.
 *
 * @module MemoryScanSession
 */

import { randomUUID } from 'node:crypto';
import {
  SCAN_SESSION_MAX_COUNT,
  SCAN_SESSION_TTL_MS,
} from '@src/constants';
import type { ScanOptions, ScanSessionState, ScanValueType } from './NativeMemoryManager.types';
import { getDefaultAlignment } from './ScanComparators';
import { formatAddress, parseAddress } from './formatAddress';

export interface ScanSessionSummary {
  id: string;
  pid: number;
  valueType: ScanValueType;
  addressCount: number;
  scanCount: number;
  age: string;
}

export class MemoryScanSessionManager {
  private sessions: Map<string, ScanSessionState> = new Map();
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;

  constructor(
    maxSessions = SCAN_SESSION_MAX_COUNT,
    sessionTtlMs = SCAN_SESSION_TTL_MS
  ) {
    this.maxSessions = maxSessions;
    this.sessionTtlMs = sessionTtlMs;
  }

  /** Create a new scan session for a given PID and value type. */
  createSession(pid: number, options: ScanOptions): string {
    this.cleanup();

    if (this.sessions.size >= this.maxSessions) {
      // Evict oldest session
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, session] of this.sessions) {
        if (session.createdAt < oldestTime) {
          oldestTime = session.createdAt;
          oldestId = id;
        }
      }
      if (oldestId) {
        this.sessions.delete(oldestId);
      }
    }

    const id = randomUUID();
    const alignment = options.alignment ?? getDefaultAlignment(options.valueType);
    const now = Date.now();

    const session: ScanSessionState = {
      id,
      pid,
      valueType: options.valueType,
      alignment,
      createdAt: now,
      lastScanAt: now,
      scanCount: 0,
      addresses: [],
      previousValues: new Map(),
    };

    this.sessions.set(id, session);
    return id;
  }

  /** Get session by ID. Throws if not found or expired. */
  getSession(sessionId: string): ScanSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Scan session not found: ${sessionId}`);
    }
    if (Date.now() - session.lastScanAt > this.sessionTtlMs) {
      this.sessions.delete(sessionId);
      throw new Error(`Scan session expired: ${sessionId}`);
    }
    return session;
  }

  /** Update session with new scan results (bigint addresses). */
  updateSession(
    sessionId: string,
    addresses: bigint[],
    values: Map<bigint, Buffer>
  ): void {
    const session = this.getSession(sessionId);
    session.addresses = addresses;
    session.previousValues = values;
    session.lastScanAt = Date.now();
    session.scanCount++;
  }

  /** List all active sessions. */
  listSessions(): ScanSessionSummary[] {
    this.cleanup();
    const result: ScanSessionSummary[] = [];
    const now = Date.now();

    for (const session of this.sessions.values()) {
      const ageMs = now - session.createdAt;
      const ageMin = Math.floor(ageMs / 60_000);
      const ageSec = Math.floor((ageMs % 60_000) / 1_000);
      result.push({
        id: session.id,
        pid: session.pid,
        valueType: session.valueType,
        addressCount: session.addresses.length,
        scanCount: session.scanCount,
        age: ageMin > 0 ? `${ageMin}m${ageSec}s` : `${ageSec}s`,
      });
    }

    return result;
  }

  /** Delete a session. */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /** Clean up expired sessions. Returns count of cleaned sessions. */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastScanAt > this.sessionTtlMs) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  /** Export session data for persistence (JSON serialization). */
  exportSession(sessionId: string): string {
    const session = this.getSession(sessionId);
    const serializable = {
      ...session,
      // Convert bigint addresses to hex strings for JSON compatibility
      addresses: session.addresses.map(addr => formatAddress(addr)),
      previousValues: Array.from(session.previousValues.entries()).map(
        ([addr, buf]) => [formatAddress(addr), buf.toString('hex')] as const
      ),
    };
    return JSON.stringify(serializable);
  }

  /** Import session from exported JSON data. Returns new session id. */
  importSession(data: string): string {
    const parsed = JSON.parse(data);
    const id = randomUUID();
    const now = Date.now();

    const previousValues = new Map<bigint, Buffer>();
    if (Array.isArray(parsed.previousValues)) {
      for (const [addr, hex] of parsed.previousValues) {
        if (typeof addr === 'string' && typeof hex === 'string') {
          previousValues.set(parseAddress(addr), Buffer.from(hex, 'hex'));
        }
      }
    }

    // Import addresses: handle both bigint-era (hex strings) and legacy formats
    const addresses: bigint[] = [];
    if (Array.isArray(parsed.addresses)) {
      for (const addr of parsed.addresses) {
        if (typeof addr === 'string') {
          addresses.push(parseAddress(addr));
        }
      }
    }

    const session: ScanSessionState = {
      id,
      pid: parsed.pid,
      valueType: parsed.valueType,
      alignment: parsed.alignment ?? 4,
      createdAt: now,
      lastScanAt: now,
      scanCount: parsed.scanCount ?? 0,
      addresses,
      previousValues,
    };

    this.sessions.set(id, session);
    return id;
  }
}

export const scanSessionManager = new MemoryScanSessionManager();
