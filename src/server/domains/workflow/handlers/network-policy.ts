/**
 * Workflow network policy — SSRF-aware URL authorization.
 */

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { isLoopbackHost, isPrivateHost } from '@server/domains/network/ssrf-policy';

export interface WorkflowNetworkHostPattern {
  scope: 'host' | 'hostname';
  value: string;
}

export interface WorkflowNetworkPolicy {
  allowPrivateNetwork: boolean;
  allowInsecureHttp: boolean;
  allowedHosts: WorkflowNetworkHostPattern[];
  allowedRedirectHosts: WorkflowNetworkHostPattern[];
  allowedCidrs: string[];
  allowedCidrBlockList: BlockList;
}

export interface WorkflowNetworkAuthorization {
  parsedUrl: URL;
  resolvedIp: string | null;
  fetchUrl: string;
  headers: Record<string, string>;
}

function normalizeWorkflowHostname(host: string): string {
  return host
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
}

export function parseWorkflowStringArray(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  const parsed: unknown =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!Array.isArray(parsed)) return null;
  const values = parsed.filter((entry): entry is string => typeof entry === 'string');
  if (values.length !== parsed.length) return null;
  return values.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function normalizeWorkflowHostPattern(raw: string): WorkflowNetworkHostPattern {
  const trimmed = raw.trim();
  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.port.length > 0) {
      return { scope: 'host', value: parsed.host.toLowerCase() };
    }
    return { scope: 'hostname', value: normalizeWorkflowHostname(parsed.hostname) };
  } catch {
    return { scope: 'hostname', value: normalizeWorkflowHostname(trimmed) };
  }
}

function parseWorkflowBoolean(
  raw: unknown,
  fieldName: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: false };
  if (typeof raw !== 'boolean')
    return { ok: false, error: `${fieldName} must be a boolean when provided` };
  return { ok: true, value: raw };
}

export function parseWorkflowNetworkPolicy(args: Record<string, unknown>): {
  policy?: WorkflowNetworkPolicy;
  error?: string;
} {
  const rawNetworkPolicy = args.networkPolicy;
  if (rawNetworkPolicy === undefined) {
    return {
      policy: {
        allowPrivateNetwork: false,
        allowInsecureHttp: false,
        allowedHosts: [],
        allowedRedirectHosts: [],
        allowedCidrs: [],
        allowedCidrBlockList: new BlockList(),
      },
    };
  }

  const parsedInput: unknown =
    typeof rawNetworkPolicy === 'string'
      ? (() => {
          try {
            return JSON.parse(rawNetworkPolicy);
          } catch {
            return null;
          }
        })()
      : rawNetworkPolicy;

  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
    return { error: 'networkPolicy must be an object or valid JSON object string' };
  }

  const record = parsedInput as Record<string, unknown>;

  const allowPrivateNetwork = parseWorkflowBoolean(
    record.allowPrivateNetwork,
    'networkPolicy.allowPrivateNetwork',
  );
  if (!allowPrivateNetwork.ok) return { error: allowPrivateNetwork.error };

  const allowInsecureHttp = parseWorkflowBoolean(
    record.allowInsecureHttp,
    'networkPolicy.allowInsecureHttp',
  );
  if (!allowInsecureHttp.ok) return { error: allowInsecureHttp.error };

  const allowedHosts = parseWorkflowStringArray(record.allowedHosts);
  if (allowedHosts === null)
    return { error: 'networkPolicy.allowedHosts must be an array of strings' };

  const allowedRedirectHosts = parseWorkflowStringArray(record.allowedRedirectHosts);
  if (allowedRedirectHosts === null)
    return { error: 'networkPolicy.allowedRedirectHosts must be an array of strings' };

  const allowedCidrs = parseWorkflowStringArray(record.allowedCidrs);
  if (allowedCidrs === null)
    return { error: 'networkPolicy.allowedCidrs must be an array of strings' };

  const allowedCidrBlockList = new BlockList();
  for (const cidr of allowedCidrs) {
    const [address, prefixRaw] = cidr.split('/');
    if (!address || !prefixRaw)
      return { error: `Invalid CIDR in networkPolicy.allowedCidrs: "${cidr}"` };
    const family = isIP(address);
    if (family === 0)
      return { error: `Invalid CIDR base address in networkPolicy.allowedCidrs: "${cidr}"` };
    const prefix = Number(prefixRaw);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      return { error: `Invalid CIDR prefix in networkPolicy.allowedCidrs: "${cidr}"` };
    }
    allowedCidrBlockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }

  return {
    policy: {
      allowPrivateNetwork: allowPrivateNetwork.value,
      allowInsecureHttp: allowInsecureHttp.value,
      allowedHosts: allowedHosts.map(normalizeWorkflowHostPattern),
      allowedRedirectHosts: allowedRedirectHosts.map(normalizeWorkflowHostPattern),
      allowedCidrs,
      allowedCidrBlockList,
    },
  };
}

export async function authorizeWorkflowUrl(
  targetUrl: string,
  policy: WorkflowNetworkPolicy,
  options: {
    label: string;
    allowRedirectHosts?: boolean;
    rewriteHttpHostToResolvedIp?: boolean;
  },
): Promise<WorkflowNetworkAuthorization> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw new Error(`Invalid ${options.label}: ${targetUrl}`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `Unsupported protocol for ${options.label}: ${parsedUrl.protocol} — only http/https allowed`,
    );
  }

  const normalizedHostname = normalizeWorkflowHostname(parsedUrl.hostname);
  const parsedHost = parsedUrl.host.toLowerCase();
  const ipFamily = isIP(normalizedHostname);
  const resolvedIp =
    ipFamily !== 0
      ? normalizedHostname
      : await lookup(normalizedHostname)
          .then((result) => result.address)
          .catch((error) => {
            throw new Error(`DNS resolution failed for "${targetUrl}"`, { cause: error });
          });

  const resolvedFamily = isIP(resolvedIp);
  const matchesAllowedCidr =
    resolvedFamily !== 0 &&
    policy.allowedCidrs.length > 0 &&
    policy.allowedCidrBlockList.check(resolvedIp, resolvedFamily === 4 ? 'ipv4' : 'ipv6');
  const hostPatterns =
    options.allowRedirectHosts && policy.allowedRedirectHosts.length > 0
      ? policy.allowedRedirectHosts
      : policy.allowedHosts;
  const matchesAllowedHost = hostPatterns.some((pattern) =>
    pattern.scope === 'host' ? pattern.value === parsedHost : pattern.value === normalizedHostname,
  );
  const hasHostOrCidrRules = hostPatterns.length > 0 || policy.allowedCidrs.length > 0;
  const isAuthorizedTarget = !hasHostOrCidrRules || matchesAllowedHost || matchesAllowedCidr;

  const privateTarget = isPrivateHost(normalizedHostname) || isPrivateHost(resolvedIp);
  if (privateTarget) {
    if (!policy.allowPrivateNetwork) {
      throw new Error(
        `Blocked: ${options.label} "${targetUrl}" resolves to a private/reserved address`,
      );
    }
    if (!hasHostOrCidrRules || !isAuthorizedTarget) {
      throw new Error(
        `Blocked: ${options.label} "${targetUrl}" requires an explicit networkPolicy host or CIDR allow rule`,
      );
    }
  } else if (hasHostOrCidrRules && !isAuthorizedTarget) {
    throw new Error(`Blocked: ${options.label} "${targetUrl}" is not authorized by networkPolicy`);
  }

  const loopbackTarget = isLoopbackHost(normalizedHostname) || isLoopbackHost(resolvedIp);
  if (parsedUrl.protocol === 'http:' && !loopbackTarget) {
    if (!policy.allowInsecureHttp) {
      throw new Error(
        `Blocked: insecure HTTP requires networkPolicy.allowInsecureHttp for "${targetUrl}"`,
      );
    }
    if (!hasHostOrCidrRules || !isAuthorizedTarget) {
      throw new Error(
        `Blocked: insecure HTTP target "${targetUrl}" requires an explicit networkPolicy host or CIDR allow rule`,
      );
    }
  }

  const fetchHeaders: Record<string, string> = {};
  let fetchUrl = parsedUrl.toString();
  if (options.rewriteHttpHostToResolvedIp && parsedUrl.protocol === 'http:' && ipFamily === 0) {
    const originalHost = parsedUrl.host;
    const pinnedUrl = new URL(parsedUrl.toString());
    pinnedUrl.hostname = resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp;
    fetchUrl = pinnedUrl.toString();
    fetchHeaders.Host = originalHost;
  }

  return { parsedUrl, resolvedIp, fetchUrl, headers: fetchHeaders };
}
