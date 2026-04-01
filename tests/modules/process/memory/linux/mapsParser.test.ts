import { describe, it, expect } from 'vitest';

import { formatLinuxProtection, parseProcMaps } from '@modules/process/memory/linux/mapsParser';

describe('memory/linux/mapsParser', () => {
  it('parses readable regions and ignores malformed lines', () => {
    const regions = parseProcMaps(`
00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat
bad line that should be ignored
7f7dd0a00000-7f7dd0c00000 rw-p 00000000 00:00 0    [heap]
`);

    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({
      start: 0x00400000n,
      end: 0x00452000n,
      pathname: '/usr/bin/cat',
    });
    expect(regions[1]).toMatchObject({
      permissions: {
        read: true,
        write: true,
        exec: false,
        private: true,
      },
      pathname: '[heap]',
    });
  });

  it('formats linux protections from permissions flags', () => {
    expect(formatLinuxProtection({ read: true, write: false, exec: true, private: false })).toBe(
      'r-x',
    );
  });
});
