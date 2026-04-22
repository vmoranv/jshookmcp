import { describe, expect, it } from 'vitest';

import {
  createNetworkAuthorizationPolicy,
  hasAuthorizedTargets,
  isAuthorizedNetworkTarget,
  isLocalSsrfBypassEnabled,
  isLoopbackHost,
  isLoopbackHttpUrl,
  isNetworkAuthorizationExpired,
  isPrivateHost,
  isSsrfTarget,
  resolveNetworkTarget,
} from '@server/domains/network/ssrf-policy';

describe('network ssrf-policy helpers', () => {
  describe('isPrivateHost', () => {
    it('recognizes localhost as private', async () => {
      expect(isPrivateHost('localhost')).toBe(true);
    });

    it('recognizes 127.0.0.1 as private', async () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
    });

    it('recognizes 10.x as private', async () => {
      expect(isPrivateHost('10.0.0.1')).toBe(true);
    });

    it('recognizes 172.16.x as private', async () => {
      expect(isPrivateHost('172.16.0.1')).toBe(true);
    });

    it('recognizes 192.168.x as private', async () => {
      expect(isPrivateHost('192.168.1.1')).toBe(true);
    });

    it('recognizes 169.254.x as private', async () => {
      expect(isPrivateHost('169.254.1.1')).toBe(true);
    });

    it('recognizes 0.0.0.0 as private', async () => {
      expect(isPrivateHost('0.0.0.0')).toBe(true);
    });

    it('recognizes ::1 as private', async () => {
      expect(isPrivateHost('::1')).toBe(true);
    });

    it('recognizes :: as private', async () => {
      expect(isPrivateHost('::')).toBe(true);
    });

    it('recognizes IPv6-mapped IPv4 private as private', async () => {
      expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    });

    it('recognizes fc00:: as private', async () => {
      expect(isPrivateHost('fc00::1')).toBe(true);
    });

    it('recognizes fe80:: as private', async () => {
      expect(isPrivateHost('fe80::1')).toBe(true);
    });

    it('recognizes public IPs as not private', async () => {
      expect(isPrivateHost('8.8.8.8')).toBe(false);
    });

    it('handles bracketed IPv6', async () => {
      expect(isPrivateHost('[::1]')).toBe(true);
    });

    it('returns false for non-IP hostnames', async () => {
      expect(isPrivateHost('example.com')).toBe(false);
    });
  });

  describe('isLoopbackHost', () => {
    it('recognizes localhost', async () => {
      expect(isLoopbackHost('localhost')).toBe(true);
    });

    it('recognizes 127.0.0.1', async () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
    });

    it('recognizes ::1', async () => {
      expect(isLoopbackHost('::1')).toBe(true);
    });

    it('rejects non-loopback', async () => {
      expect(isLoopbackHost('10.0.0.1')).toBe(false);
    });
  });

  describe('isLoopbackHttpUrl', () => {
    it('recognizes http://localhost as loopback', async () => {
      expect(isLoopbackHttpUrl('http://localhost:3000/path')).toBe(true);
    });

    it('recognizes http://127.0.0.1 as loopback', async () => {
      expect(isLoopbackHttpUrl('http://127.0.0.1/api')).toBe(true);
    });

    it('rejects https URLs', async () => {
      expect(isLoopbackHttpUrl('https://localhost/api')).toBe(false);
    });

    it('rejects non-loopback URLs', async () => {
      expect(isLoopbackHttpUrl('http://example.com/api')).toBe(false);
    });

    it('returns false for invalid URL', async () => {
      expect(isLoopbackHttpUrl('not-a-url')).toBe(false);
    });
  });

  describe('isLocalSsrfBypassEnabled', () => {
    it('returns false by default', async () => {
      delete process.env.ALLOW_LOCAL_SSRF;
      expect(isLocalSsrfBypassEnabled()).toBe(false);
    });

    it('returns true when env is set', async () => {
      process.env.ALLOW_LOCAL_SSRF = 'true';
      expect(isLocalSsrfBypassEnabled()).toBe(true);
      delete process.env.ALLOW_LOCAL_SSRF;
    });
  });

  describe('createNetworkAuthorizationPolicy', () => {
    it('returns undefined for no input', async () => {
      expect(createNetworkAuthorizationPolicy()).toBeUndefined();
      expect(createNetworkAuthorizationPolicy(undefined)).toBeUndefined();
    });

    it('creates policy with empty input', async () => {
      const policy = createNetworkAuthorizationPolicy({});
      expect(policy).toBeDefined();
      expect(policy!.allowPrivateNetwork).toBe(false);
      expect(policy!.allowInsecureHttp).toBe(false);
      expect(policy!.expiresAt).toBeNull();
      expect(policy!.reason).toBeNull();
    });

    it('parses allowedHosts', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedHosts: ['example.com', 'localhost:8080'],
      });
      expect(policy!.allowedHosts.has('example.com')).toBe(true);
      expect(policy!.allowedHosts.has('localhost:8080')).toBe(true);
    });

    it('parses allowedCidrs for IPv4', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedCidrs: ['10.0.0.0/24'],
      });
      expect(policy!.allowedCidrs).toContain('10.0.0.0/24');
    });

    it('parses allowedCidrs for IPv6', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedCidrs: ['::1/128'],
      });
      expect(policy!.allowedCidrs.length).toBe(1);
    });

    it('throws on invalid CIDR format', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['not-a-cidr'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('throws on CIDR with no slash', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['10.0.0.1'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('throws on CIDR with slash at end', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['10.0.0.1/'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('throws on CIDR with invalid prefix', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['10.0.0.0/abc'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('throws on IPv4 CIDR with prefix > 32', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['10.0.0.0/33'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('throws on IPv6 CIDR with prefix > 128', async () => {
      expect(() => createNetworkAuthorizationPolicy({ allowedCidrs: ['::1/129'] })).toThrow(
        'Invalid authorization CIDR',
      );
    });

    it('skips empty CIDR entries', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedCidrs: ['  ', '10.0.0.0/24'],
      });
      expect(policy!.allowedCidrs.length).toBe(1);
    });

    it('parses valid expiresAt', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const policy = createNetworkAuthorizationPolicy({ expiresAt: future });
      expect(policy!.expiresAt).toBe(future);
      expect(policy!.expiresAtMs).toBeGreaterThan(0);
    });

    it('throws on invalid expiresAt', async () => {
      expect(() => createNetworkAuthorizationPolicy({ expiresAt: 'not-a-date' })).toThrow(
        'Invalid authorization expiry',
      );
    });

    it('handles empty expiresAt', async () => {
      const policy = createNetworkAuthorizationPolicy({ expiresAt: '  ' });
      expect(policy!.expiresAt).toBeNull();
    });

    it('stores reason when provided', async () => {
      const policy = createNetworkAuthorizationPolicy({ reason: 'testing' });
      expect(policy!.reason).toBe('testing');
    });

    it('nulls empty reason', async () => {
      const policy = createNetworkAuthorizationPolicy({ reason: '  ' });
      expect(policy!.reason).toBeNull();
    });

    it('sets boolean flags', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
      });
      expect(policy!.allowPrivateNetwork).toBe(true);
      expect(policy!.allowInsecureHttp).toBe(true);
    });
  });

  describe('hasAuthorizedTargets', () => {
    it('returns false for no policy', async () => {
      expect(hasAuthorizedTargets(undefined)).toBe(false);
    });

    it('returns false for empty policy', async () => {
      const policy = createNetworkAuthorizationPolicy({});
      expect(hasAuthorizedTargets(policy)).toBe(false);
    });

    it('returns true when hosts are allowed', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedHosts: ['example.com'],
      });
      expect(hasAuthorizedTargets(policy)).toBe(true);
    });

    it('returns true when CIDRs are allowed', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedCidrs: ['10.0.0.0/24'],
      });
      expect(hasAuthorizedTargets(policy)).toBe(true);
    });
  });

  describe('isNetworkAuthorizationExpired', () => {
    it('returns false for no policy', async () => {
      expect(isNetworkAuthorizationExpired(undefined)).toBe(false);
    });

    it('returns false when no expiry set', async () => {
      const policy = createNetworkAuthorizationPolicy({});
      expect(isNetworkAuthorizationExpired(policy)).toBe(false);
    });

    it('returns false when expiry is in the future', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const policy = createNetworkAuthorizationPolicy({ expiresAt: future });
      expect(isNetworkAuthorizationExpired(policy)).toBe(false);
    });

    it('returns true when expiry is in the past', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const policy = createNetworkAuthorizationPolicy({ expiresAt: past });
      expect(isNetworkAuthorizationExpired(policy, Date.now())).toBe(true);
    });
  });

  describe('isAuthorizedNetworkTarget', () => {
    it('returns false for no policy', async () => {
      expect(isAuthorizedNetworkTarget(undefined, { hostname: 'x', resolvedAddress: null })).toBe(
        false,
      );
    });

    it('returns true when hostname is in allowedHosts', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedHosts: ['example.com'],
      });
      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'example.com',
          resolvedAddress: '1.2.3.4',
        }),
      ).toBe(true);
    });

    it('returns true when resolvedAddress matches CIDR', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedCidrs: ['10.0.0.0/8'],
      });
      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'internal.corp',
          resolvedAddress: '10.1.2.3',
        }),
      ).toBe(true);
    });

    it('returns false for unauthorized address', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedHosts: ['other.com'],
        allowedCidrs: ['192.168.0.0/16'],
      });
      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'example.com',
          resolvedAddress: '8.8.8.8',
        }),
      ).toBe(false);
    });

    it('returns false when resolvedAddress is null', async () => {
      const policy = createNetworkAuthorizationPolicy({
        allowedHosts: ['example.com'],
      });
      expect(
        isAuthorizedNetworkTarget(policy!, {
          hostname: 'other.com',
          resolvedAddress: null,
        }),
      ).toBe(false);
    });
  });

  describe('resolveNetworkTarget', () => {
    it('resolves IP literal without DNS', async () => {
      const target = await resolveNetworkTarget('http://8.8.8.8/path');
      expect(target.isIpLiteral).toBe(true);
      expect(target.resolvedAddress).toBe('8.8.8.8');
      expect(target.hostname).toBe('8.8.8.8');
    });

    it('resolves IPv6 literal without DNS', async () => {
      const target = await resolveNetworkTarget('http://[::1]/path');
      expect(target.isIpLiteral).toBe(true);
      expect(target.resolvedAddress).toBe('::1');
    });

    it('resolves localhost to 127.0.0.1', async () => {
      const target = await resolveNetworkTarget('http://localhost/path');
      expect(target.isIpLiteral).toBe(false);
      expect(target.resolvedAddress).toBe('127.0.0.1');
      expect(target.hostname).toBe('localhost');
    });

    it('throws on invalid URL', async () => {
      await expect(resolveNetworkTarget('not-a-url')).rejects.toThrow();
    });
  });

  describe('isSsrfTarget', () => {
    it('returns false for public URLs', async () => {
      await expect(isSsrfTarget('https://example.com/')).resolves.toBe(false);
    });

    it('returns true for invalid URLs', async () => {
      await expect(isSsrfTarget('not-a-url')).resolves.toBe(true);
    });

    it('returns true for private IP without authorization', async () => {
      await expect(isSsrfTarget('http://192.168.1.1/')).resolves.toBe(true);
    });

    it('returns true for localhost without authorization', async () => {
      await expect(isSsrfTarget('http://localhost/')).resolves.toBe(true);
    });

    it('returns true for expired authorization', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      await expect(
        isSsrfTarget('http://localhost/', {
          allowedHosts: ['localhost'],
          allowPrivateNetwork: true,
          expiresAt: past,
        }),
      ).resolves.toBe(true);
    });

    it('returns false when authorized for private target', async () => {
      await expect(
        isSsrfTarget('http://localhost/', {
          allowedHosts: ['localhost'],
          allowPrivateNetwork: true,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).resolves.toBe(false);
    });

    it('returns false for local SSRF bypass', async () => {
      process.env.ALLOW_LOCAL_SSRF = 'true';
      try {
        await expect(isSsrfTarget('http://localhost/')).resolves.toBe(false);
      } finally {
        delete process.env.ALLOW_LOCAL_SSRF;
      }
    });
  });
});
