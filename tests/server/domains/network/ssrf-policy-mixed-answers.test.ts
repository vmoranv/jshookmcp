import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import {
  createNetworkAuthorizationPolicy,
  isAuthorizedNetworkTarget,
  resolveNetworkTarget,
} from '@utils/network/ssrf-policy';
import { buildTestUrl } from '@tests/shared/test-urls';

const PUBLIC_ONE = '93.184.216.34';
const PUBLIC_TWO = '93.184.216.35';
const PRIVATE = '10.0.0.5';

function dnsAnswer(...addresses: string[]) {
  return addresses.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4,
  }));
}

describe('ssrf-policy full DNS answer handling', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  describe('resolveNetworkTarget', () => {
    it('rejects an answer that mixes public and private addresses (rebinding)', async () => {
      lookupMock.mockResolvedValue(dnsAnswer(PUBLIC_ONE, PRIVATE));

      await expect(resolveNetworkTarget(buildTestUrl('mixed', { path: '/' }))).rejects.toThrow(
        /mixes public and private/,
      );
    });

    it('returns every resolved address for a uniform public answer', async () => {
      lookupMock.mockResolvedValue(dnsAnswer(PUBLIC_ONE, PUBLIC_TWO));

      const target = await resolveNetworkTarget(buildTestUrl('public', { path: '/' }));

      expect(target.resolvedAddress).toBe(PUBLIC_ONE);
      expect(target.resolvedAddresses).toEqual([PUBLIC_ONE, PUBLIC_TWO]);
    });

    it('returns every resolved address for a uniform private answer', async () => {
      lookupMock.mockResolvedValue(dnsAnswer(PRIVATE));

      const target = await resolveNetworkTarget(buildTestUrl('private', { path: '/' }));

      expect(target.resolvedAddress).toBe(PRIVATE);
      expect(target.resolvedAddresses).toEqual([PRIVATE]);
    });

    it('records the single address for IP literals', async () => {
      const target = await resolveNetworkTarget('http://8.8.8.8/path');

      expect(lookupMock).not.toHaveBeenCalled();
      expect(target.resolvedAddresses).toEqual(['8.8.8.8']);
    });
  });

  describe('isAuthorizedNetworkTarget', () => {
    it('requires every resolved address to be authorized when one CIDR matches', async () => {
      const policy = createNetworkAuthorizationPolicy({ allowedCidrs: ['93.184.216.0/24'] });

      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'mixed.example',
          resolvedAddress: PUBLIC_ONE,
          resolvedAddresses: [PUBLIC_ONE, '8.8.4.4'],
        }),
      ).toBe(false);

      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'mixed.example',
          resolvedAddress: PUBLIC_ONE,
          resolvedAddresses: [PUBLIC_ONE, PUBLIC_TWO],
        }),
      ).toBe(true);
    });

    it('still authorizes an explicitly allow-listed hostname', async () => {
      const policy = createNetworkAuthorizationPolicy({ allowedHosts: ['mixed.example'] });

      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'mixed.example',
          resolvedAddress: '8.8.4.4',
          resolvedAddresses: [PUBLIC_ONE, '8.8.4.4'],
        }),
      ).toBe(true);
    });

    it('falls back to the single resolved address when no set is provided', async () => {
      const policy = createNetworkAuthorizationPolicy({ allowedCidrs: ['10.0.0.0/8'] });

      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'legacy.example',
          resolvedAddress: PRIVATE,
        }),
      ).toBe(true);
    });
  });
});
