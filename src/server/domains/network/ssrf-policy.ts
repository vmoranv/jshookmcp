import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const RESTRICTED_IPV4_BLOCKLIST = new BlockList();
const RESTRICTED_IPV6_BLOCKLIST = new BlockList();

const RESTRICTED_IPV4_SUBNETS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const;

const RESTRICTED_IPV6_SUBNETS = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['fc00::', 7],
  ['fe80::', 10],
] as const;

for (const [address, prefix] of RESTRICTED_IPV4_SUBNETS) {
  RESTRICTED_IPV4_BLOCKLIST.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of RESTRICTED_IPV6_SUBNETS) {
  RESTRICTED_IPV6_BLOCKLIST.addSubnet(address, prefix, 'ipv6');
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
}

function getHostAddressFamily(host: string): 'ipv4' | 'ipv6' | null {
  const family = isIP(host);
  if (family === 4) return 'ipv4';
  if (family === 6) return 'ipv6';
  return null;
}

export interface NetworkAuthorizationInput {
  allowedHosts?: string[];
  allowedCidrs?: string[];
  allowPrivateNetwork?: boolean;
  allowInsecureHttp?: boolean;
  expiresAt?: string;
  reason?: string;
}

export interface NetworkAuthorizationPolicy {
  allowedHosts: Set<string>;
  allowedCidrs: string[];
  allowPrivateNetwork: boolean;
  allowInsecureHttp: boolean;
  expiresAt: string | null;
  expiresAtMs: number | null;
  reason: string | null;
  ipv4AllowBlockList: BlockList;
  ipv6AllowBlockList: BlockList;
}

export interface ResolvedNetworkTarget {
  parsedUrl: URL;
  hostname: string;
  resolvedAddress: string | null;
  isIpLiteral: boolean;
}

function parsePolicyExpiry(expiresAt?: string): {
  expiresAt: string | null;
  expiresAtMs: number | null;
} {
  if (typeof expiresAt !== 'string') {
    return { expiresAt: null, expiresAtMs: null };
  }

  const trimmed = expiresAt.trim();
  if (trimmed.length === 0) {
    return { expiresAt: null, expiresAtMs: null };
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid authorization expiry "${expiresAt}"`);
  }

  return { expiresAt: trimmed, expiresAtMs: parsed };
}

function addAuthorizedCidrs(
  allowedCidrs: string[],
  ipv4AllowBlockList: BlockList,
  ipv6AllowBlockList: BlockList,
): string[] {
  const normalizedCidrs: string[] = [];

  for (const rawCidr of allowedCidrs) {
    const trimmed = rawCidr.trim();
    if (trimmed.length === 0) continue;

    const slashIndex = trimmed.lastIndexOf('/');
    if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
      throw new Error(`Invalid authorization CIDR "${rawCidr}"`);
    }

    const address = trimmed.slice(0, slashIndex).trim();
    const prefixText = trimmed.slice(slashIndex + 1).trim();
    const prefix = Number(prefixText);
    const family = getHostAddressFamily(address);

    if (!Number.isInteger(prefix) || !family) {
      throw new Error(`Invalid authorization CIDR "${rawCidr}"`);
    }

    if (family === 'ipv4' && (prefix < 0 || prefix > 32)) {
      throw new Error(`Invalid authorization CIDR "${rawCidr}"`);
    }

    if (family === 'ipv6' && (prefix < 0 || prefix > 128)) {
      throw new Error(`Invalid authorization CIDR "${rawCidr}"`);
    }

    if (family === 'ipv4') {
      ipv4AllowBlockList.addSubnet(address, prefix, family);
    } else {
      ipv6AllowBlockList.addSubnet(address, prefix, family);
    }

    normalizedCidrs.push(`${normalizeHost(address)}/${prefix}`);
  }

  return normalizedCidrs;
}

function isAddressAuthorized(
  policy: NetworkAuthorizationPolicy | undefined,
  address: string | null,
): boolean {
  if (!policy || !address) return false;

  const normalized = normalizeHost(address);
  if (policy.allowedHosts.has(normalized)) {
    return true;
  }

  const family = getHostAddressFamily(normalized);
  if (!family) {
    return false;
  }

  return family === 'ipv4'
    ? policy.ipv4AllowBlockList.check(normalized, family)
    : policy.ipv6AllowBlockList.check(normalized, family);
}

export function isLocalSsrfBypassEnabled(): boolean {
  return process.env.ALLOW_LOCAL_SSRF === 'true';
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function isPrivateHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized === 'localhost') return true;

  const family = getHostAddressFamily(normalized);
  if (!family) return false;

  return family === 'ipv4'
    ? RESTRICTED_IPV4_BLOCKLIST.check(normalized, family)
    : RESTRICTED_IPV6_BLOCKLIST.check(normalized, family);
}

export function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function createNetworkAuthorizationPolicy(
  input?: NetworkAuthorizationInput,
): NetworkAuthorizationPolicy | undefined {
  if (!input) {
    return undefined;
  }

  const allowedHosts = new Set(
    (input.allowedHosts ?? []).map((host) => normalizeHost(host)).filter((host) => host.length > 0),
  );
  const ipv4AllowBlockList = new BlockList();
  const ipv6AllowBlockList = new BlockList();
  const normalizedCidrs = addAuthorizedCidrs(
    input.allowedCidrs ?? [],
    ipv4AllowBlockList,
    ipv6AllowBlockList,
  );
  const { expiresAt, expiresAtMs } = parsePolicyExpiry(input.expiresAt);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';

  return {
    allowedHosts,
    allowedCidrs: normalizedCidrs,
    allowPrivateNetwork: input.allowPrivateNetwork === true,
    allowInsecureHttp: input.allowInsecureHttp === true,
    expiresAt,
    expiresAtMs,
    reason: reason.length > 0 ? reason : null,
    ipv4AllowBlockList,
    ipv6AllowBlockList,
  };
}

export function hasAuthorizedTargets(policy: NetworkAuthorizationPolicy | undefined): boolean {
  if (!policy) return false;
  return policy.allowedHosts.size > 0 || policy.allowedCidrs.length > 0;
}

export function isNetworkAuthorizationExpired(
  policy: NetworkAuthorizationPolicy | undefined,
  now = Date.now(),
): boolean {
  if (!policy || policy.expiresAtMs === null) {
    return false;
  }

  return now > policy.expiresAtMs;
}

export async function resolveNetworkTarget(url: string): Promise<ResolvedNetworkTarget> {
  const parsedUrl = new URL(url);
  const hostname = normalizeHost(parsedUrl.hostname);
  const isIpLiteral = getHostAddressFamily(hostname) !== null;

  if (isIpLiteral) {
    return {
      parsedUrl,
      hostname,
      resolvedAddress: hostname,
      isIpLiteral,
    };
  }

  if (hostname === 'localhost') {
    return {
      parsedUrl,
      hostname,
      resolvedAddress: '127.0.0.1',
      isIpLiteral,
    };
  }

  const { address } = await lookup(hostname);
  return {
    parsedUrl,
    hostname,
    resolvedAddress: normalizeHost(address),
    isIpLiteral,
  };
}

export function isAuthorizedNetworkTarget(
  policy: NetworkAuthorizationPolicy | undefined,
  target: Pick<ResolvedNetworkTarget, 'hostname' | 'resolvedAddress'>,
): boolean {
  if (!policy) {
    return false;
  }

  return (
    isAddressAuthorized(policy, target.hostname) ||
    isAddressAuthorized(policy, target.resolvedAddress)
  );
}

export async function isSsrfTarget(
  url: string,
  authorization?: NetworkAuthorizationInput,
): Promise<boolean> {
  try {
    const policy = createNetworkAuthorizationPolicy(authorization);
    if (isNetworkAuthorizationExpired(policy)) return true;
    const parsed = new URL(url);
    if (!policy && isLocalSsrfBypassEnabled()) return false;

    const target = await resolveNetworkTarget(parsed.toString());
    const targetIsPrivate =
      isPrivateHost(target.hostname) || isPrivateHost(target.resolvedAddress ?? '');

    if (!targetIsPrivate) {
      return false;
    }

    if (!policy?.allowPrivateNetwork) {
      return true;
    }

    return !isAuthorizedNetworkTarget(policy, target);
  } catch {
    return true;
  }
}
