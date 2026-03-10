/**
 * Linux /proc/<pid>/maps parser
 */

export interface LinuxMemoryRegion {
  start: bigint;
  end: bigint;
  permissions: {
    read: boolean;
    write: boolean;
    exec: boolean;
    private: boolean;
  };
  offset: bigint;
  dev: string;
  inode: number;
  pathname: string;
}

const PROC_MAPS_LINE_RE =
  /^([0-9a-f]+)-([0-9a-f]+)\s+([r-][w-][x-][ps])\s+([0-9a-f]+)\s+(\S+)\s+(\d+)\s*(.*)$/i;

export function parseProcMaps(content: string): LinuxMemoryRegion[] {
  const regions: LinuxMemoryRegion[] = [];

  for (const line of content.split(/\r?\n/)) {
    const match = line.trimEnd().match(PROC_MAPS_LINE_RE);
    if (!match) continue;

    const perms = match[3]!;
    regions.push({
      start: BigInt(`0x${match[1]!}`),
      end: BigInt(`0x${match[2]!}`),
      permissions: {
        read: perms[0] === 'r',
        write: perms[1] === 'w',
        exec: perms[2] === 'x',
        private: perms[3] === 'p',
      },
      offset: BigInt(`0x${match[4]!}`),
      dev: match[5]!,
      inode: parseInt(match[6]!, 10),
      pathname: match[7]?.trim() ?? '',
    });
  }

  return regions;
}

export function formatLinuxProtection(perms: LinuxMemoryRegion['permissions']): string {
  return `${perms.read ? 'r' : '-'}${perms.write ? 'w' : '-'}${perms.exec ? 'x' : '-'}`;
}
