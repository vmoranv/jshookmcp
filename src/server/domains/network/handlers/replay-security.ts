import { getSystemTempRoots, getProjectRoot } from '@utils/outputPaths';
import { resolveSafeOutputPath, writeTextFileAtomically } from '@utils/safeOutput';
import type { NetworkAuthorizationInput } from '@utils/network/ssrf-policy';
import type {
  SessionProfile,
  SessionProfileClientHints,
  SessionProfileCookie,
} from '@internal-types/SessionProfile';

interface ReplayAuthorizationCapabilityPayload extends NetworkAuthorizationInput {
  version?: number;
  requestId: string;
}

const BLOCKED_REPLAY_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
]);

const SAFE_METHOD_RE = /^[A-Z][A-Z0-9_-]{0,31}$/;
const CLIENT_HINT_SAME_SITE = new Set(['Strict', 'Lax', 'None'] as const);
const CLIENT_HINT_SOURCE_SCHEME = new Set(['Unset', 'NonSecure', 'Secure'] as const);

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }

  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parseOptionalFiniteNumber(
  value: unknown,
  field: string,
  options?: { integer?: boolean; min?: number; max?: number },
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (options?.integer && !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  if (typeof options?.min === 'number' && value < options.min) {
    throw new Error(`${field} must be >= ${options.min}`);
  }
  if (typeof options?.max === 'number' && value > options.max) {
    throw new Error(`${field} must be <= ${options.max}`);
  }

  return value;
}

function parseHeaderPatch(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const headerPatch = expectRecord(value, 'headerPatch');
  const normalizedHeaders: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(headerPatch)) {
    if (typeof headerValue !== 'string') {
      throw new Error(`headerPatch.${headerName} must be a string`);
    }

    const trimmedName = headerName.trim();
    if (!trimmedName) {
      throw new Error('headerPatch keys must be non-empty');
    }
    if (/[\r\n]/.test(trimmedName) || /[\r\n]/.test(headerValue)) {
      throw new Error(`headerPatch.${trimmedName} must not contain CR/LF characters`);
    }
    if (BLOCKED_REPLAY_HEADERS.has(trimmedName.toLowerCase())) {
      throw new Error(`headerPatch.${trimmedName} is not allowed`);
    }

    normalizedHeaders[trimmedName] = headerValue;
  }

  return normalizedHeaders;
}

function parseSessionProfileCookie(value: unknown, index: number): SessionProfileCookie {
  const cookie = expectRecord(value, `sessionProfile.cookies[${index}]`);
  const name = parseOptionalString(cookie.name, `sessionProfile.cookies[${index}].name`);
  const valueString = parseOptionalString(cookie.value, `sessionProfile.cookies[${index}].value`);
  if (!name) {
    throw new Error(`sessionProfile.cookies[${index}].name is required`);
  }
  if (valueString === undefined) {
    throw new Error(`sessionProfile.cookies[${index}].value is required`);
  }

  const sameSite = parseOptionalString(
    cookie.sameSite,
    `sessionProfile.cookies[${index}].sameSite`,
  );
  if (sameSite && !CLIENT_HINT_SAME_SITE.has(sameSite as 'Strict' | 'Lax' | 'None')) {
    throw new Error(`sessionProfile.cookies[${index}].sameSite is invalid`);
  }

  const sourceScheme = parseOptionalString(
    cookie.sourceScheme,
    `sessionProfile.cookies[${index}].sourceScheme`,
  );
  if (
    sourceScheme &&
    !CLIENT_HINT_SOURCE_SCHEME.has(sourceScheme as 'Secure' | 'Unset' | 'NonSecure')
  ) {
    throw new Error(`sessionProfile.cookies[${index}].sourceScheme is invalid`);
  }

  return {
    name,
    value: valueString,
    domain: parseOptionalString(cookie.domain, `sessionProfile.cookies[${index}].domain`),
    path: parseOptionalString(cookie.path, `sessionProfile.cookies[${index}].path`),
    expires: parseOptionalFiniteNumber(cookie.expires, `sessionProfile.cookies[${index}].expires`),
    size: parseOptionalFiniteNumber(cookie.size, `sessionProfile.cookies[${index}].size`, {
      integer: true,
      min: 0,
    }),
    httpOnly: parseOptionalBoolean(cookie.httpOnly, `sessionProfile.cookies[${index}].httpOnly`),
    secure: parseOptionalBoolean(cookie.secure, `sessionProfile.cookies[${index}].secure`),
    session: parseOptionalBoolean(cookie.session, `sessionProfile.cookies[${index}].session`),
    sameSite: sameSite as 'Strict' | 'Lax' | 'None' | undefined,
    sourceScheme: sourceScheme as 'Secure' | 'Unset' | 'NonSecure' | undefined,
  };
}

function parseClientHints(value: unknown): SessionProfileClientHints | undefined {
  if (value === undefined) {
    return undefined;
  }

  const hints = expectRecord(value, 'sessionProfile.clientHints');
  const parse = (field: keyof SessionProfileClientHints) =>
    parseOptionalString(hints[field], `sessionProfile.clientHints.${field}`);

  return {
    secChUa: parse('secChUa'),
    secChUaMobile: parse('secChUaMobile'),
    secChUaPlatform: parse('secChUaPlatform'),
    secChUaPlatformVersion: parse('secChUaPlatformVersion'),
    secChUaArch: parse('secChUaArch'),
    secChUaFullVersion: parse('secChUaFullVersion'),
    secChUaFullVersionList: parse('secChUaFullVersionList'),
    secChUaModel: parse('secChUaModel'),
    secChUaBitness: parse('secChUaBitness'),
    secChUaWow64: parse('secChUaWow64'),
  };
}

function parseSessionProfile(value: unknown): SessionProfile | undefined {
  if (value === undefined) {
    return undefined;
  }

  const profile = expectRecord(value, 'sessionProfile');
  if (!Array.isArray(profile.cookies)) {
    throw new Error('sessionProfile.cookies must be an array');
  }

  return {
    cookies: profile.cookies.map((cookie, index) => parseSessionProfileCookie(cookie, index)),
    userAgent: parseOptionalString(profile.userAgent, 'sessionProfile.userAgent'),
    acceptLanguage: parseOptionalString(profile.acceptLanguage, 'sessionProfile.acceptLanguage'),
    referer: parseOptionalString(profile.referer, 'sessionProfile.referer'),
    clientHints: parseClientHints(profile.clientHints),
    platform: parseOptionalString(profile.platform, 'sessionProfile.platform'),
    origin: parseOptionalString(profile.origin, 'sessionProfile.origin'),
    collectedAt:
      parseOptionalFiniteNumber(profile.collectedAt, 'sessionProfile.collectedAt', {
        integer: true,
        min: 0,
      }) ?? Date.now(),
    ttlSec:
      parseOptionalFiniteNumber(profile.ttlSec, 'sessionProfile.ttlSec', {
        integer: true,
        min: 0,
      }) ?? 0,
  };
}

function decodeAuthorizationCapability(
  capability: unknown,
  requestId: string,
): ReplayAuthorizationCapabilityPayload {
  if (typeof capability !== 'string' || capability.trim().length === 0) {
    throw new Error('authorizationCapability must be a non-empty base64url string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(capability, 'base64url').toString('utf8'));
  } catch {
    throw new Error('authorizationCapability must be valid base64url-encoded JSON');
  }

  const raw = expectRecord(parsed, 'authorizationCapability payload');
  const payload = raw as unknown as ReplayAuthorizationCapabilityPayload;
  if (payload.version !== undefined && payload.version !== 1) {
    throw new Error(`authorizationCapability version ${String(payload.version)} is not supported`);
  }
  if (payload.requestId !== requestId) {
    throw new Error('authorizationCapability requestId does not match the replay requestId');
  }

  return payload;
}

function parseReplayAuthorization(
  args: Record<string, unknown>,
  requestId: string,
): NetworkAuthorizationInput | undefined {
  const authorizationArg = args.authorization;
  const capabilityArg = args.authorizationCapability;

  if (authorizationArg !== undefined && capabilityArg !== undefined) {
    throw new Error('Provide either authorization or authorizationCapability, not both');
  }

  let source: Record<string, unknown> | undefined;
  if (authorizationArg !== undefined) {
    source = expectRecord(authorizationArg, 'authorization');
  } else if (capabilityArg !== undefined) {
    source = decodeAuthorizationCapability(capabilityArg, requestId) as unknown as Record<
      string,
      unknown
    >;
  } else {
    return undefined;
  }

  // TS cannot prove that source is always assigned here (the early-return exhausts
  // the undefined case), so assign to a new variable to close the analysis gap.
  const auth = source!;

  const allowedHosts = parseStringArray(auth.allowedHosts, 'authorization.allowedHosts');
  const allowedCidrs = parseStringArray(auth.allowedCidrs, 'authorization.allowedCidrs');
  const allowPrivateNetwork = parseOptionalBoolean(
    auth.allowPrivateNetwork,
    'authorization.allowPrivateNetwork',
  );
  const allowInsecureHttp = parseOptionalBoolean(
    auth.allowInsecureHttp,
    'authorization.allowInsecureHttp',
  );
  const expiresAt = parseOptionalString(auth.expiresAt, 'authorization.expiresAt');
  const reason = parseOptionalString(auth.reason, 'authorization.reason');

  const authorization: NetworkAuthorizationInput = {};
  if (allowedHosts.length > 0) authorization.allowedHosts = allowedHosts;
  if (allowedCidrs.length > 0) authorization.allowedCidrs = allowedCidrs;
  if (allowPrivateNetwork !== undefined) authorization.allowPrivateNetwork = allowPrivateNetwork;
  if (allowInsecureHttp !== undefined) authorization.allowInsecureHttp = allowInsecureHttp;
  if (expiresAt !== undefined) authorization.expiresAt = expiresAt;
  if (reason !== undefined) authorization.reason = reason;

  return authorization;
}

export interface ParsedReplayRequestArgs {
  requestId: string;
  headerPatch?: Record<string, string>;
  sessionProfile?: SessionProfile;
  bodyPatch?: string;
  methodOverride?: string;
  urlOverride?: string;
  timeoutMs?: number;
  dryRun: boolean;
  authorization?: NetworkAuthorizationInput;
}

export function parseReplayRequestArgs(args: Record<string, unknown>): ParsedReplayRequestArgs {
  const requestId = parseOptionalString(args.requestId, 'requestId');
  if (!requestId) {
    throw new Error('requestId is required');
  }

  const methodOverride = parseOptionalString(args.methodOverride, 'methodOverride');
  if (methodOverride && !SAFE_METHOD_RE.test(methodOverride.toUpperCase())) {
    throw new Error('methodOverride must be a valid HTTP token');
  }

  const urlOverride = parseOptionalString(args.urlOverride, 'urlOverride');
  if (urlOverride) {
    try {
      const parsedUrl = new URL(urlOverride);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('urlOverride must use http or https');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'urlOverride must use http or https') {
        throw error;
      }
      throw new Error('urlOverride must be an absolute http(s) URL', { cause: error });
    }
  }

  const bodyPatch = parseOptionalString(args.bodyPatch, 'bodyPatch');
  const timeoutMs = parseOptionalFiniteNumber(args.timeoutMs, 'timeoutMs', {
    integer: true,
    min: 1_000,
    max: 120_000,
  });
  const dryRun = args.dryRun === undefined ? true : parseOptionalBoolean(args.dryRun, 'dryRun');
  if (dryRun === undefined) {
    throw new Error('dryRun must be a boolean');
  }

  return {
    requestId,
    headerPatch: parseHeaderPatch(args.headerPatch),
    sessionProfile: parseSessionProfile(args.sessionProfile),
    bodyPatch,
    methodOverride: methodOverride?.toUpperCase(),
    urlOverride,
    timeoutMs,
    dryRun,
    authorization: parseReplayAuthorization(args, requestId),
  };
}

export async function writeHarToSafePath(outputPath: string, har: unknown): Promise<string> {
  const allowedRoots = [getProjectRoot(), ...getSystemTempRoots()];
  const absolutePath = await resolveSafeOutputPath(outputPath, {
    allowedRoots,
    allowedRootsDescription: 'project root or system temp directory',
  });
  // Compact serialization (no pretty-print) so a large HAR does not inflate to
  // 2-3x its size as one resident string before the atomic write.
  await writeTextFileAtomically(absolutePath, JSON.stringify(har), {
    allowedRoots,
  });
  return absolutePath;
}
