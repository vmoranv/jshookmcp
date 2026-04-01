/**
 * TraceDB unit tests — SQLite storage engine for time-travel tracing.
 */

import { join } from 'node:path';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceDB } from '@modules/trace/TraceDB';
import type { TraceEvent, MemoryDelta } from '@modules/trace/TraceDB.types';

function makeEvent(overrides?: Partial<TraceEvent>): TraceEvent {
  return {
    timestamp: Date.now(),
    category: 'test',
    eventType: 'test_event',
    data: '{"key": "value"}',
    scriptId: null,
    lineNumber: null,
    ...overrides,
  };
}

function makeDelta(overrides?: Partial<MemoryDelta>): MemoryDelta {
  return {
    timestamp: Date.now(),
    address: '0x1000',
    oldValue: '0x00',
    newValue: '0xFF',
    size: 4,
    valueType: 'int32',
    ...overrides,
  };
}

describe('TraceDB', () => {
  let dbPath: string;
  let testDir: string;
  let db: TraceDB;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'trace-db-test-'));
    dbPath = join(testDir, 'trace.db');
    db = new TraceDB({ dbPath });
  });

  afterEach(async () => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates database with correct schema — 4 tables', () => {
    const result = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const tableNames = result.rows.map((r) => r[0]);
    expect(tableNames).toContain('events');
    expect(tableNames).toContain('memory_deltas');
    expect(tableNames).toContain('heap_snapshots');
    expect(tableNames).toContain('metadata');
  });

  it('creates indexes — 5 indexes present', () => {
    const result = db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
    );
    const indexNames = result.rows.map((r) => r[0]);
    expect(indexNames).toContain('idx_events_timestamp');
    expect(indexNames).toContain('idx_events_category_type');
    expect(indexNames).toContain('idx_events_script_id');
    expect(indexNames).toContain('idx_memory_timestamp');
    expect(indexNames).toContain('idx_memory_address');
  });

  it('inserts and retrieves events after flush', () => {
    db.insertEvent(makeEvent({ category: 'debugger', eventType: 'paused' }));
    db.insertEvent(makeEvent({ category: 'network', eventType: 'request' }));
    db.insertEvent(makeEvent({ category: 'runtime', eventType: 'exception' }));
    db.flush();

    const result = db.query('SELECT * FROM events');
    expect(result.rowCount).toBe(3);
  });

  it('batch flushes automatically at buffer size', () => {
    const smallDbPath = join(testDir, 'small.db');
    const smallDb = new TraceDB({ dbPath: smallDbPath, batchSize: 3 });
    try {
      smallDb.insertEvent(makeEvent());
      smallDb.insertEvent(makeEvent());
      // After 2 events, should not be flushed yet
      const before = smallDb.query('SELECT COUNT(*) as cnt FROM events');
      expect(before.rows[0]![0]).toBe(0);

      // Third event triggers auto-flush
      smallDb.insertEvent(makeEvent());
      const after = smallDb.query('SELECT COUNT(*) as cnt FROM events');
      expect(after.rows[0]![0]).toBe(3);
    } finally {
      smallDb.close();
    }
  });

  it('inserts memory deltas', () => {
    db.insertMemoryDelta(
      makeDelta({
        address: '0xABCD',
        oldValue: '0x00000000',
        newValue: '0xDEADBEEF',
        size: 4,
        valueType: 'int32',
      }),
    );
    db.flush();

    const result = db.query('SELECT * FROM memory_deltas');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]![2]).toBe('0xABCD'); // address column
  });

  it('inserts heap snapshots immediately (no flush needed)', () => {
    db.insertHeapSnapshot({
      timestamp: Date.now(),
      snapshotData: Buffer.from('{"snapshot": "data"}'),
      summary: '{"totalSize": 1024, "nodeCount": 10}',
    });

    // Query without flushing — snapshot is immediately inserted
    const result = db.query('SELECT id, timestamp, summary FROM heap_snapshots');
    expect(result.rowCount).toBe(1);

    // Also test getHeapSnapshots() coverage
    const snapshots = db.getHeapSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.summary).toBe('{"totalSize": 1024, "nodeCount": 10}');
    expect(snapshots[0]!.snapshotData.toString()).toBe('{"snapshot": "data"}');
  });

  it('sets and retrieves metadata', () => {
    db.setMetadata('url', 'https://example.com');
    db.setMetadata('platform', 'darwin');

    const metadata = db.getMetadata();
    expect(metadata['url']).toBe('https://example.com');
    expect(metadata['platform']).toBe('darwin');
  });

  it('metadata upsert updates existing keys', () => {
    db.setMetadata('count', '1');
    db.setMetadata('count', '2');

    const metadata = db.getMetadata();
    expect(metadata['count']).toBe('2');
  });

  it('query enforces read-only — rejects INSERT', () => {
    expect(() => db.query("INSERT INTO events VALUES (1, 1, 'a', 'b', '{}', null, null)")).toThrow(
      /Write operations are not allowed/,
    );
  });

  it('query enforces read-only — rejects DROP', () => {
    expect(() => db.query('DROP TABLE events')).toThrow(/Write operations are not allowed/);
  });

  it('query enforces read-only — rejects UPDATE', () => {
    expect(() => db.query("UPDATE events SET category = 'x'")).toThrow(
      /Write operations are not allowed/,
    );
  });

  it('query returns columns even when no rows match', () => {
    db.insertEvent(makeEvent());
    db.flush();

    const result = db.query('SELECT timestamp, category FROM events WHERE id = -999');
    expect(result.rowCount).toBe(0);
    expect(result.columns).toEqual(['timestamp', 'category']);
  });

  it('getEventsByTimeRange filters correctly', () => {
    db.insertEvent(makeEvent({ timestamp: 100 }));
    db.insertEvent(makeEvent({ timestamp: 200 }));
    db.insertEvent(makeEvent({ timestamp: 300 }));
    db.flush();

    const events = db.getEventsByTimeRange(150, 250);
    expect(events).toHaveLength(1);
    expect(events[0]!.timestamp).toBe(200);
  });

  it('getMemoryDeltasByAddress filters correctly', () => {
    // Re-initialize with a smaller batch size to test auto-flushing logic
    const smallBatchDb = new TraceDB({
      dbPath: join(testDir, 'small_batch.db'),
      batchSize: 2,
    });

    // 3 inserts with batchSize=2 will trigger `this.flush()` internally
    smallBatchDb.insertMemoryDelta(makeDelta({ address: '0xAAAA' }));
    smallBatchDb.insertMemoryDelta(makeDelta({ address: '0xBBBB' }));
    smallBatchDb.insertMemoryDelta(makeDelta({ address: '0xAAAA' }));
    // We don't call manual flush() to rely on the side-effect flush that covers line 148

    const deltas = smallBatchDb.getMemoryDeltasByAddress('0xAAAA');
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.address === '0xAAAA')).toBe(true);
    smallBatchDb.close();
  });

  it('throws mapped error when db path is invalid', () => {
    expect(() => {
      const _db = new TraceDB({ dbPath: '/invalid/path/that/cannot/exist/trace.db' });
    }).toThrow(/Cannot open database/);
  });

  it('close flushes pending buffer', () => {
    const closePath = join(testDir, 'close.db');
    const closeDb = new TraceDB({ dbPath: closePath });

    closeDb.insertEvent(makeEvent());
    closeDb.insertEvent(makeEvent());
    expect(closeDb.isClosed).toBe(false);
    closeDb.close(); // Should flush before closing
    expect(closeDb.isClosed).toBe(true);

    // Reopen and verify data was persisted
    const reopened = new TraceDB({ dbPath: closePath });
    try {
      const result = reopened.query('SELECT COUNT(*) as cnt FROM events');
      expect(result.rows[0]![0]).toBe(2);
    } finally {
      reopened.close();
    }
  });

  it('uses WAL journal mode (wal file exists)', async () => {
    // WAL mode creates a -wal file alongside the DB
    // We can't query PRAGMA via the public query() API since it blocks PRAGMA
    // Instead verify the WAL sidecar file is created
    db.insertEvent(makeEvent());
    db.flush();
    const { existsSync } = await import('node:fs');
    expect(existsSync(dbPath + '-wal')).toBe(true);
  });

  it('throws when accessing closed database', () => {
    db.close();
    expect(() => db.insertEvent(makeEvent())).toThrow(/TraceDB is closed/);
  });

  it('dbPath returns the correct path', () => {
    expect(db.dbPath).toBe(dbPath);
  });
});
