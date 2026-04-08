import fs from 'node:fs';
import { parseProcMaps } from '@modules/process/memory/linux/mapsParser.js';
import type { PlatformMemoryAPI } from '../PlatformMemoryAPI.js';
import {
  MemoryProtection,
  type AllocationResult,
  type MemoryReadResult,
  type MemoryRegionInfo,
  type MemoryWriteResult,
  type ModuleInfo,
  type PlatformAvailability,
  type ProcessHandle,
  type ProtectionChangeResult,
} from '../types.js';

export interface MemoryRegion {
  start: bigint;
  end: bigint;
  perms: string;
  path?: string;
}

function isLinuxRuntime(): boolean {
  return process.platform === 'linux';
}

function toProtection(perms: string): MemoryProtection {
  let protection = MemoryProtection.NoAccess;

  if (perms.includes('r')) {
    protection |= MemoryProtection.Read;
  }
  if (perms.includes('w')) {
    protection |= MemoryProtection.Write;
  }
  if (perms.includes('x')) {
    protection |= MemoryProtection.Execute;
  }

  return protection;
}

function toRegionInfo(region: MemoryRegion): MemoryRegionInfo {
  const protection = toProtection(region.perms);
  return {
    baseAddress: region.start,
    size: Number(region.end - region.start),
    protection,
    state: 'committed',
    type: region.path ? 'mapped' : 'private',
    isReadable: (protection & MemoryProtection.Read) !== 0,
    isWritable: (protection & MemoryProtection.Write) !== 0,
    isExecutable: (protection & MemoryProtection.Execute) !== 0,
  };
}

function normalizePattern(pattern: Buffer | string): Buffer {
  if (Buffer.isBuffer(pattern)) {
    return pattern;
  }

  if (pattern.startsWith('0x') && pattern.length % 2 === 0) {
    return Buffer.from(pattern.slice(2), 'hex');
  }

  return Buffer.from(pattern, 'utf8');
}

export class LinuxMemoryProviderImpl implements PlatformMemoryAPI {
  readonly platform = 'linux';

  constructor(private readonly pid: number = process.pid) {}

  isAvailable(): boolean {
    return isLinuxRuntime();
  }

  async read(address: bigint, size: number): Promise<Buffer> {
    const handle = this.openProcess(this.pid, false);
    return this.readMemory(handle, address, size).data;
  }

  async write(address: bigint, data: Buffer): Promise<boolean> {
    const handle = this.openProcess(this.pid, true);
    const result = this.writeMemory(handle, address, data);
    return result.bytesWritten === data.length;
  }

  async scan(pattern: Buffer | string): Promise<bigint[]> {
    const patternBuffer = normalizePattern(pattern);
    const handle = this.openProcess(this.pid, false);
    const regions = await this.queryRegions();
    const matches: bigint[] = [];

    for (const region of regions) {
      if (!region.perms.includes('r')) {
        continue;
      }

      const size = Number(region.end - region.start);
      if (size <= 0) {
        continue;
      }

      try {
        const buffer = this.readMemory(handle, region.start, size).data;
        let offset = buffer.indexOf(patternBuffer);
        while (offset >= 0) {
          matches.push(region.start + BigInt(offset));
          offset = buffer.indexOf(patternBuffer, offset + 1);
        }
      } catch {
        continue;
      }
    }

    return matches;
  }

  async queryRegions(): Promise<MemoryRegion[]> {
    const mapsPath = `/proc/${this.pid}/maps`;
    const content = await fs.promises.readFile(mapsPath, 'utf8');
    const parsed = parseProcMaps(content);

    return parsed.map((region) => ({
      start: region.start,
      end: region.end,
      perms: `${region.permissions.read ? 'r' : '-'}${region.permissions.write ? 'w' : '-'}${region.permissions.exec ? 'x' : '-'}${region.permissions.private ? 'p' : 's'}`,
      path: region.pathname || undefined,
    }));
  }

  async checkAvailability(): Promise<PlatformAvailability> {
    if (!this.isAvailable()) {
      return {
        available: false,
        platform: 'linux',
        reason: 'Not running on Linux',
      };
    }

    return {
      available: true,
      platform: 'linux',
    };
  }

  openProcess(pid: number, writeAccess: boolean): ProcessHandle {
    return {
      pid,
      writeAccess,
    };
  }

  closeProcess(_handle: ProcessHandle): void {}

  readMemory(handle: ProcessHandle, address: bigint, size: number): MemoryReadResult {
    const memPath = `/proc/${handle.pid}/mem`;
    const fileDescriptor = fs.openSync(memPath, handle.writeAccess ? 'r+' : 'r');
    const buffer = Buffer.alloc(size);

    try {
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, size, Number(address));
      return {
        data: buffer.subarray(0, bytesRead),
        bytesRead,
      };
    } finally {
      fs.closeSync(fileDescriptor);
    }
  }

  writeMemory(handle: ProcessHandle, address: bigint, data: Buffer): MemoryWriteResult {
    const memPath = `/proc/${handle.pid}/mem`;
    const fileDescriptor = fs.openSync(memPath, 'r+');

    try {
      const bytesWritten = fs.writeSync(fileDescriptor, data, 0, data.length, Number(address));
      return {
        bytesWritten,
      };
    } finally {
      fs.closeSync(fileDescriptor);
    }
  }

  queryRegion(handle: ProcessHandle, address: bigint): MemoryRegionInfo | null {
    const mapsPath = `/proc/${handle.pid}/maps`;
    const content = fs.readFileSync(mapsPath, 'utf8');
    const parsed = parseProcMaps(content);

    for (const region of parsed) {
      if (address >= region.start && address < region.end) {
        return toRegionInfo({
          start: region.start,
          end: region.end,
          perms: `${region.permissions.read ? 'r' : '-'}${region.permissions.write ? 'w' : '-'}${region.permissions.exec ? 'x' : '-'}${region.permissions.private ? 'p' : 's'}`,
          path: region.pathname || undefined,
        });
      }
    }

    return null;
  }

  changeProtection(
    _handle: ProcessHandle,
    _address: bigint,
    _size: number,
    _newProtection: MemoryProtection,
  ): ProtectionChangeResult {
    throw new Error('Linux memory protection changes are not supported by LinuxMemoryProviderImpl');
  }

  allocateMemory(
    _handle: ProcessHandle,
    _size: number,
    _protection: MemoryProtection,
  ): AllocationResult {
    throw new Error('Linux remote memory allocation is not supported by LinuxMemoryProviderImpl');
  }

  freeMemory(_handle: ProcessHandle, _address: bigint, _size: number): void {
    throw new Error('Linux remote memory free is not supported by LinuxMemoryProviderImpl');
  }

  enumerateModules(handle: ProcessHandle): ModuleInfo[] {
    const mapsPath = `/proc/${handle.pid}/maps`;
    const content = fs.readFileSync(mapsPath, 'utf8');
    const parsed = parseProcMaps(content);
    const modules = new Map<string, ModuleInfo>();

    for (const region of parsed) {
      if (!region.pathname || region.pathname.startsWith('[')) {
        continue;
      }
      const existing = modules.get(region.pathname);
      if (existing) {
        const newSize = Number(region.end - existing.baseAddress);
        modules.set(region.pathname, {
          ...existing,
          size: newSize > existing.size ? newSize : existing.size,
        });
        continue;
      }

      modules.set(region.pathname, {
        name: region.pathname.split('/').pop() ?? region.pathname,
        baseAddress: region.start,
        size: Number(region.end - region.start),
      });
    }

    return [...modules.values()];
  }
}

export class LinuxMemoryProvider extends LinuxMemoryProviderImpl {}
