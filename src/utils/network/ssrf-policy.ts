import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import fastUri from 'fast-uri';
import { readEnvBoolean } from '@src/config/environment';

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
  ['2001::', 32],
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

function normalizeAuthorityHost(host: string | undefined): string {
  return (host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Parse a URL with BOTH the WHATWG parser (what Node's fetch/undici will
 * actually use) and an independent RFC 3986 parser (fast-uri), and fail
 * closed whenever the two disagree about the authority. Hostile inputs make
 * the two parsers disagree on precisely the shapes behind the fast-uri 4.1.x
 * advisories — backslash authority introducers, percent-encoded hostnames,
 * unbalanced IP-literal brackets, skipped IDN canonicalization — so an
 * ambiguous URL never reaches DNS resolution.
 *
 * fast-uri must parse the RAW string, not the WHATWG-canonicalized form:
 * canonicalization erases the disagreement (e.g. `http://foo\@evil.com/`
 * re-parses identically once WHATWG has rewritten the backslash).
 */
export function parseUrlForNetworkUse(url: string): URL {
  const parsed = new URL(url);
  let components: ReturnType<typeof fastUri.parse>;
  try {
    components = fastUri.parse(url);
  } catch {
    throw new Error(`URL authority rejected by cross-parser check: "${url}"`);
  }

  const whatwgScheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const rfc3986Scheme = (components.scheme ?? '').toLowerCase();
  const whatwgHost = normalizeAuthorityHost(parsed.hostname);
  const rfc3986Host = normalizeAuthorityHost(components.host);

  if (whatwgScheme !== rfc3986Scheme || whatwgHost !== rfc3986Host) {
    throw new Error(
      `URL authority is parser-ambiguous (whatwg="${whatwgScheme}//${whatwgHost}", ` +
        `rfc3986="${rfc3986Scheme}//${rfc3986Host}"): "${url}"`,
    );
  }

  return parsed;
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
  /**
   * Full DNS answer set. Optional for backward compatibility with callers (and
   * tests) that construct a single-address target by hand.
   */
  resolvedAddresses?: string[];
  isIpLiteral: boolean;
}

export interface ResolvedNetworkTargets {
  parsedUrl: URL;
  hostname: string;
  isIpLiteral: boolean;
  addresses: string[];
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
  return readEnvBoolean('ALLOW_LOCAL_SSRF', false);
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
    const parsed = parseUrlForNetworkUse(url);
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

/**
 * Resolve EVERY address a hostname answers with in a single lookup. DNS
 * rebinding relies on a hostname that flips between public and private
 * addresses, so the full answer set must be inspected — a single-address
 * lookup can miss the private record and let the request through.
 */
export async function resolveNetworkTargets(url: string): Promise<ResolvedNetworkTargets> {
  const parsedUrl = parseUrlForNetworkUse(url);
  const hostname = normalizeHost(parsedUrl.hostname);
  const isIpLiteral = getHostAddressFamily(hostname) !== null;

  if (isIpLiteral) {
    return { parsedUrl, hostname, isIpLiteral, addresses: [hostname] };
  }

  if (hostname === 'localhost') {
    return { parsedUrl, hostname, isIpLiteral, addresses: ['127.0.0.1'] };
  }

  const records = (await lookup(hostname, { all: true })) as unknown as
    | LookupAddress
    | LookupAddress[];
  const addressList = Array.isArray(records) ? records : [records];
  return {
    parsedUrl,
    hostname,
    isIpLiteral,
    addresses: addressList.map((record) => normalizeHost(record.address)).filter(Boolean),
  };
}

/**
 * Single-address view of a target for callers that pin one resolved IP.
 *
 * A mixed public/private answer set is rejected outright: callers of this
 * helper (replay / raw transports) inspect and pin only `resolvedAddress`, so
 * returning either the public or the private record would let the other one
 * through validation while the actual connection re-resolves. `isSsrfTarget`
 * uses `resolveNetworkTargets` directly and remains the full-set entry point.
 */
export async function resolveNetworkTarget(url: string): Promise<ResolvedNetworkTarget> {
  const targets = await resolveNetworkTargets(url);
  const hasPrivateAddress = targets.addresses.some((address) => isPrivateHost(address));
  const hasPublicAddress = targets.addresses.some((address) => !isPrivateHost(address));

  if (hasPrivateAddress && hasPublicAddress) {
    throw new Error(
      `Refusing ambiguous DNS answer for "${targets.hostname}": mixes public and private ` +
        'addresses (possible DNS rebinding)',
    );
  }

  return {
    parsedUrl: targets.parsedUrl,
    hostname: targets.hostname,
    resolvedAddress: targets.addresses[0] ?? null,
    resolvedAddresses: targets.addresses,
    isIpLiteral: targets.isIpLiteral,
  };
}

/**
 * Authorization check for a resolved target. An explicitly allow-listed
 * hostname is always authorized; otherwise EVERY resolved address must fall
 * inside an allowed CIDR. Requiring the full set (when available) closes the
 * mixed-answer bypass where only the first record was inspected.
 */
export function isAuthorizedNetworkTarget(
  policy: NetworkAuthorizationPolicy | undefined,
  target: Pick<ResolvedNetworkTarget, 'hostname' | 'resolvedAddress'> &
    Partial<Pick<ResolvedNetworkTarget, 'resolvedAddresses'>>,
): boolean {
  if (!policy) {
    return false;
  }

  if (isAddressAuthorized(policy, target.hostname)) {
    return true;
  }

  const addresses = target.resolvedAddresses?.length
    ? target.resolvedAddresses
    : target.resolvedAddress
      ? [target.resolvedAddress]
      : [];

  return addresses.length > 0 && addresses.every((address) => isAddressAuthorized(policy, address));
}

export async function isSsrfTarget(
  url: string,
  authorization?: NetworkAuthorizationInput,
): Promise<boolean> {
  try {
    const policy = createNetworkAuthorizationPolicy(authorization);
    if (isNetworkAuthorizationExpired(policy)) return true;
    const parsed = parseUrlForNetworkUse(url);

    // The env bypass is intentionally checked before DNS resolution: without
    // an authorization policy the operator has opted out of SSRF guarding
    // entirely. It never applies to DNS failures once a policy exists —
    // those fail closed below.
    if (!policy && isLocalSsrfBypassEnabled()) return false;

    // Resolve-once-then-pin: check the full DNS answer set, not a single
    // lookup result — a hostname answering with both public and private
    // addresses is a DNS-rebinding vector.
    const target = await resolveNetworkTargets(parsed.toString());

    const targetIsPrivate =
      isPrivateHost(target.hostname) || target.addresses.some((address) => isPrivateHost(address));

    if (!targetIsPrivate) {
      return false;
    }

    if (!policy?.allowPrivateNetwork) {
      return true;
    }

    // Loopback hostnames resolve deterministically — no DNS rebinding is
    // possible, so authorizing the hostname is sufficient.
    if (isLoopbackHost(target.hostname)) {
      return !isAddressAuthorized(policy, target.hostname);
    }

    // Any other hostname: every resolved address must be individually
    // authorized. A single unauthorized address in a mixed public/private
    // answer set keeps the rebinding vector open.
    const allAddressesAuthorized = target.addresses.every((address) =>
      isAddressAuthorized(policy, address),
    );
    return !allAddressesAuthorized;
  } catch {
    return true;
  }
}
