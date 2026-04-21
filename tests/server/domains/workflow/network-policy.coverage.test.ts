import { describe, it, expect, vi } from 'vitest';
import {
  parseWorkflowStringArray,
  parseWorkflowNetworkPolicy,
  authorizeWorkflowUrl,
} from '@server/domains/workflow/handlers/network-policy';
import type { WorkflowNetworkPolicy } from '@server/domains/workflow/handlers/network-policy';

vi.mock('@server/domains/network/ssrf-policy', () => ({
  isLoopbackHost: (host: string) => host === 'localhost' || host === '127.0.0.1',
  isPrivateHost: (host: string) =>
    host === '10.0.0.1' || host === '192.168.1.1' || host === 'localhost' || host === '127.0.0.1',
}));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn((hostname: string) => {
    if (hostname === 'example.com') return Promise.resolve({ address: '93.184.216.34', family: 4 });
    if (hostname === 'private.local') return Promise.resolve({ address: '10.0.0.1', family: 4 });
    if (hostname === 'localhost') return Promise.resolve({ address: '127.0.0.1', family: 4 });
    return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
  }),
}));

const defaultPolicy: WorkflowNetworkPolicy = {
  allowPrivateNetwork: false,
  allowInsecureHttp: false,
  allowedHosts: [],
  allowedRedirectHosts: [],
  allowedCidrs: [],
  allowedCidrBlockList: (() => {
    const bl = new (require('node:net').BlockList)();
    return bl;
  })(),
};

describe('network-policy', () => {
  describe('parseWorkflowStringArray', () => {
    it('returns empty array for undefined', () => {
      expect(parseWorkflowStringArray(undefined)).toEqual([]);
    });

    it('parses JSON string array', () => {
      expect(parseWorkflowStringArray('["a","b"]')).toEqual(['a', 'b']);
    });

    it('returns null for invalid JSON string', () => {
      expect(parseWorkflowStringArray('not json')).toBeNull();
    });

    it('returns null for non-array', () => {
      expect(parseWorkflowStringArray(42)).toBeNull();
    });

    it('returns null for mixed array', () => {
      expect(parseWorkflowStringArray(['a', 1])).toBeNull();
    });

    it('trims entries and filters empty', () => {
      expect(parseWorkflowStringArray([' a ', '', 'b '])).toEqual(['a', 'b']);
    });
  });

  describe('parseWorkflowNetworkPolicy', () => {
    it('returns default policy when no networkPolicy arg', () => {
      const result = parseWorkflowNetworkPolicy({});
      expect(result.policy).toBeDefined();
      expect(result.policy!.allowPrivateNetwork).toBe(false);
      expect(result.policy!.allowedHosts).toEqual([]);
    });

    it('parses networkPolicy from object', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: {
          allowPrivateNetwork: true,
          allowInsecureHttp: true,
          allowedHosts: ['example.com'],
          allowedRedirectHosts: ['redirect.com'],
          allowedCidrs: [],
        },
      });
      expect(result.policy).toBeDefined();
      expect(result.policy!.allowPrivateNetwork).toBe(true);
      expect(result.policy!.allowInsecureHttp).toBe(true);
    });

    it('parses networkPolicy from JSON string', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: JSON.stringify({
          allowPrivateNetwork: false,
          allowInsecureHttp: false,
          allowedHosts: ['example.com'],
          allowedCidrs: [],
        }),
      });
      expect(result.policy).toBeDefined();
    });

    it('returns error for invalid JSON string', () => {
      const result = parseWorkflowNetworkPolicy({ networkPolicy: 'not json' });
      expect(result.error).toBeDefined();
    });

    it('returns error for non-object networkPolicy', () => {
      const result = parseWorkflowNetworkPolicy({ networkPolicy: 42 });
      expect(result.error).toContain('must be an object');
    });

    it('returns error for array networkPolicy', () => {
      const result = parseWorkflowNetworkPolicy({ networkPolicy: [] });
      expect(result.error).toContain('must be an object');
    });

    it('returns error for non-boolean allowPrivateNetwork', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowPrivateNetwork: 'yes' },
      });
      expect(result.error).toContain('must be a boolean');
    });

    it('returns error for non-boolean allowInsecureHttp', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowInsecureHttp: 1 },
      });
      expect(result.error).toContain('must be a boolean');
    });

    it('returns error for non-string allowedHosts', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedHosts: [123] },
      });
      expect(result.error).toContain('allowedHosts');
    });

    it('returns error for invalid CIDR format', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedCidrs: ['not-a-cidr'] },
      });
      expect(result.error).toContain('Invalid CIDR');
    });

    it('returns error for non-IP CIDR address', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedCidrs: ['example.com/24'] },
      });
      expect(result.error).toContain('Invalid CIDR base address');
    });

    it('returns error for invalid CIDR prefix', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedCidrs: ['10.0.0.0/33'] },
      });
      expect(result.error).toContain('Invalid CIDR prefix');
    });

    it('parses valid CIDR', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedCidrs: ['10.0.0.0/8'] },
      });
      expect(result.policy).toBeDefined();
      expect(result.policy!.allowedCidrs).toEqual(['10.0.0.0/8']);
    });

    it('normalizes host patterns with port', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedHosts: ['example.com:8080'] },
      });
      expect(result.policy!.allowedHosts[0]).toEqual({
        scope: 'host',
        value: 'example.com:8080',
      });
    });

    it('normalizes host patterns without port', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedHosts: ['example.com'] },
      });
      expect(result.policy!.allowedHosts[0]).toEqual({
        scope: 'hostname',
        value: 'example.com',
      });
    });

    it('handles IPv6 CIDR', () => {
      const result = parseWorkflowNetworkPolicy({
        networkPolicy: { allowedCidrs: ['::1/128'] },
      });
      expect(result.policy).toBeDefined();
      expect(result.policy!.allowedCidrs).toEqual(['::1/128']);
    });
  });

  describe('authorizeWorkflowUrl', () => {
    it('authorizes HTTPS to public host', async () => {
      const result = await authorizeWorkflowUrl('https://example.com/path', defaultPolicy, {
        label: 'fetch',
      });
      expect(result.parsedUrl.hostname).toBe('example.com');
      expect(result.resolvedIp).toBe('93.184.216.34');
    });

    it('rejects invalid URL', async () => {
      await expect(
        authorizeWorkflowUrl('not-a-url', defaultPolicy, { label: 'fetch' }),
      ).rejects.toThrow('Invalid fetch');
    });

    it('rejects unsupported protocol', async () => {
      await expect(
        authorizeWorkflowUrl('ftp://example.com/', defaultPolicy, { label: 'fetch' }),
      ).rejects.toThrow('Unsupported protocol');
    });

    it('rejects private host by default', async () => {
      await expect(
        authorizeWorkflowUrl('https://private.local/', defaultPolicy, { label: 'fetch' }),
      ).rejects.toThrow('private');
    });

    it('rejects HTTP to non-loopback by default', async () => {
      await expect(
        authorizeWorkflowUrl('http://example.com/', defaultPolicy, { label: 'fetch' }),
      ).rejects.toThrow('insecure HTTP');
    });

    it('allows HTTP to loopback when allowed', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
        allowedHosts: [{ scope: 'hostname', value: '127.0.0.1' }],
        allowedRedirectHosts: [],
        allowedCidrs: [],
        allowedCidrBlockList: new BlockList(),
      };
      const result = await authorizeWorkflowUrl('http://127.0.0.1/', policy, { label: 'fetch' });
      expect(result.parsedUrl.hostname).toBe('127.0.0.1');
    });

    it('allows HTTP to localhost when allowed', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
        allowedHosts: [{ scope: 'hostname', value: 'localhost' }],
        allowedRedirectHosts: [],
        allowedCidrs: [],
        allowedCidrBlockList: new BlockList(),
      };
      const result = await authorizeWorkflowUrl('http://localhost/', policy, { label: 'fetch' });
      expect(result.parsedUrl.hostname).toBe('localhost');
    });

    it('rejects unauthorized host when host allowlist exists', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        ...defaultPolicy,
        allowedHosts: [{ scope: 'hostname', value: 'allowed.com' }],
        allowedCidrBlockList: new BlockList(),
      };
      await expect(
        authorizeWorkflowUrl('https://example.com/', policy, { label: 'fetch' }),
      ).rejects.toThrow('not authorized');
    });

    it('allows authorized host from allowlist', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        ...defaultPolicy,
        allowedHosts: [{ scope: 'hostname', value: 'example.com' }],
        allowedCidrBlockList: new BlockList(),
      };
      const result = await authorizeWorkflowUrl('https://example.com/', policy, { label: 'fetch' });
      expect(result.resolvedIp).toBe('93.184.216.34');
    });

    it('uses redirect hosts when allowRedirectHosts option is set', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        ...defaultPolicy,
        allowedHosts: [{ scope: 'hostname', value: 'other.com' }],
        allowedRedirectHosts: [{ scope: 'hostname', value: 'example.com' }],
        allowedCidrBlockList: new BlockList(),
      };
      const result = await authorizeWorkflowUrl('https://example.com/', policy, {
        label: 'redirect',
        allowRedirectHosts: true,
      });
      expect(result.resolvedIp).toBe('93.184.216.34');
    });

    it('rewrites HTTP host to resolved IP when option set', async () => {
      const { BlockList } = require('node:net');
      const policy: WorkflowNetworkPolicy = {
        ...defaultPolicy,
        allowInsecureHttp: true,
        allowedHosts: [{ scope: 'hostname', value: 'example.com' }],
        allowedCidrBlockList: new BlockList(),
      };
      const result = await authorizeWorkflowUrl('http://example.com/', policy, {
        label: 'fetch',
        rewriteHttpHostToResolvedIp: true,
      });
      expect(result.fetchUrl).toContain('93.184.216.34');
      expect(result.headers.Host).toBe('example.com');
    });

    it('handles DNS failure', async () => {
      await expect(
        authorizeWorkflowUrl('https://nonexistent.invalid/', defaultPolicy, { label: 'fetch' }),
      ).rejects.toThrow('DNS resolution failed');
    });

    it('handles direct IP URL', async () => {
      const result = await authorizeWorkflowUrl('https://93.184.216.34/', defaultPolicy, {
        label: 'fetch',
      });
      expect(result.resolvedIp).toBe('93.184.216.34');
    });
  });
});
