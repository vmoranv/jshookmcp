export interface AuditEntry {
  timestamp: string;
  operation: string;
  pid: number | null;
  address: string | null;
  size: number | null;
  result: 'success' | 'failure';
  error?: string;
  durationMs: number;
  user: string;
  // Optional fields for specific operations
  pattern?: string; // For memory scan operations
  resultsCount?: number; // For memory scan results count
  dllPath?: string; // For DLL injection operations
}

export class MemoryAuditTrail {
  private buffer: AuditEntry[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number = 5000) {
    this.capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : 5000;
    this.buffer = [];
  }

  record(entry: Omit<AuditEntry, 'timestamp' | 'user'>): void {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      user: process.env.USERNAME || process.env.USER || 'unknown',
    };

    if (this.count < this.capacity) {
      const writeIndex = (this.head + this.count) % this.capacity;
      this.buffer[writeIndex] = fullEntry;
      this.count += 1;
      return;
    }

    this.buffer[this.head] = fullEntry;
    this.head = (this.head + 1) % this.capacity;
  }

  exportJson(): string {
    const entries: AuditEntry[] = [];

    for (let i = 0; i < this.count; i += 1) {
      const index = (this.head + i) % this.capacity;
      const entry = this.buffer[index];
      if (entry) {
        entries.push(entry);
      }
    }

    return JSON.stringify(entries, null, 2);
  }

  clear(): void {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }

  size(): number {
    return this.count;
  }
}
