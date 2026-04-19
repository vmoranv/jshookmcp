import { promises as fs } from 'node:fs';
import { extractAuthFromRequests } from '@server/domains/network/auth-extractor';
import { buildHar } from '@server/domains/network/har';
import type { BuildHarParams } from '@server/domains/network/har';
import { replayRequest } from '@server/domains/network/replay';
import type { NetworkAuthorizationInput } from '@server/domains/network/ssrf-policy';
import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';
import { R } from '@server/domains/shared/ResponseBuilder';

interface ReplayableRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
}

interface ReplayAuthorizationCapabilityPayload extends NetworkAuthorizationInput {
  version?: number;
  requestId: string;
}

const isReplayableRequest = (value: unknown): value is ReplayableRequest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === 'string' &&
    typeof record.url === 'string' &&
    typeof record.method === 'string'
  );
};

const parseStringArray = (value: unknown, field: string): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }

  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
};

const parseOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseOptionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
};

const decodeAuthorizationCapability = (
  capability: unknown,
  requestId: string,
): ReplayAuthorizationCapabilityPayload => {
  if (typeof capability !== 'string' || capability.trim().length === 0) {
    throw new Error('authorizationCapability must be a non-empty base64url string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(capability, 'base64url').toString('utf8'));
  } catch {
    throw new Error('authorizationCapability must be valid base64url-encoded JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('authorizationCapability payload must be an object');
  }

  const payload = parsed as ReplayAuthorizationCapabilityPayload;
  if (payload.version !== undefined && payload.version !== 1) {
    throw new Error(`authorizationCapability version ${String(payload.version)} is not supported`);
  }

  if (payload.requestId !== requestId) {
    throw new Error('authorizationCapability requestId does not match the replay requestId');
  }

  return payload;
};

const parseReplayAuthorization = (
  args: Record<string, unknown>,
  requestId: string,
): NetworkAuthorizationInput | undefined => {
  const authorizationArg = args.authorization;
  const capabilityArg = args.authorizationCapability;

  if (authorizationArg !== undefined && capabilityArg !== undefined) {
    throw new Error('Provide either authorization or authorizationCapability, not both');
  }

  let source: Record<string, unknown> | undefined;
  if (authorizationArg !== undefined) {
    if (
      typeof authorizationArg !== 'object' ||
      authorizationArg === null ||
      Array.isArray(authorizationArg)
    ) {
      throw new Error('authorization must be an object');
    }
    source = authorizationArg as Record<string, unknown>;
  } else if (capabilityArg !== undefined) {
    source = decodeAuthorizationCapability(capabilityArg, requestId) as unknown as Record<
      string,
      unknown
    >;
  } else {
    return undefined;
  }

  const allowedHosts = parseStringArray(source.allowedHosts, 'authorization.allowedHosts');
  const allowedCidrs = parseStringArray(source.allowedCidrs, 'authorization.allowedCidrs');
  const allowPrivateNetwork = parseOptionalBoolean(
    source.allowPrivateNetwork,
    'authorization.allowPrivateNetwork',
  );
  const allowInsecureHttp = parseOptionalBoolean(
    source.allowInsecureHttp,
    'authorization.allowInsecureHttp',
  );
  const expiresAt = parseOptionalString(source.expiresAt, 'authorization.expiresAt');
  const reason = parseOptionalString(source.reason, 'authorization.reason');

  const authorization: NetworkAuthorizationInput = {};
  if (allowedHosts.length > 0) authorization.allowedHosts = allowedHosts;
  if (allowedCidrs.length > 0) authorization.allowedCidrs = allowedCidrs;
  if (allowPrivateNetwork !== undefined) authorization.allowPrivateNetwork = allowPrivateNetwork;
  if (allowInsecureHttp !== undefined) authorization.allowInsecureHttp = allowInsecureHttp;
  if (expiresAt !== undefined) authorization.expiresAt = expiresAt;
  if (reason !== undefined) authorization.reason = reason;

  return authorization;
};

export class AdvancedToolHandlersRuntime extends AdvancedHandlersBase {
  async handleNetworkExtractAuth(args: Record<string, unknown>) {
    try {
      const minConfidence = this.parseNumberArg(args.minConfidence, { defaultValue: 0.4 });
      const requests = this.consoleMonitor.getNetworkRequests();

      if (requests.length === 0) {
        return R.fail(
          'No captured requests found. Call network_enable then page_navigate first.',
        ).json();
      }

      const findings = extractAuthFromRequests(requests).filter(
        (f) => f.confidence >= minConfidence,
      );

      return R.ok()
        .merge({
          scannedRequests: requests.length,
          found: findings.length,
          findings,
          note: 'Values are masked (first 6 + last 4 chars). Use network_replay_request to test with actual values.',
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkExportHar(args: Record<string, unknown>) {
    try {
      const outputPath = args.outputPath as string | undefined;
      const includeBodies = this.parseBooleanArg(args.includeBodies, false);

      let resolvedOutputPath: string | undefined;
      if (outputPath) {
        const path = await import('node:path');
        const fsDynamic = await import('node:fs/promises');
        const resolved = path.resolve(outputPath);
        const cwd = await fsDynamic.realpath(process.cwd());
        const tmpDir = await fsDynamic.realpath((await import('node:os')).tmpdir());
        const parentDir = path.dirname(resolved);
        let realParent: string;
        try {
          realParent = await fsDynamic.realpath(parentDir);
        } catch {
          realParent = parentDir;
        }
        const realPath = path.join(realParent, path.basename(resolved));
        const inCwd = realPath === cwd || realPath.startsWith(cwd + path.sep);
        const inTmp = realPath === tmpDir || realPath.startsWith(tmpDir + path.sep);
        if (!inCwd && !inTmp) {
          return R.fail(
            'outputPath must be within the current working directory or system temp dir.',
          ).json();
        }
        resolvedOutputPath = realPath;
      }

      const requests = this.consoleMonitor.getNetworkRequests();

      if (requests.length === 0) {
        return R.fail(
          'No captured requests to export. Call network_enable then page_navigate first.',
        ).json();
      }

      const getResponse: BuildHarParams['getResponse'] = (id) =>
        this.consoleMonitor.getNetworkActivity(id)?.response as ReturnType<
          BuildHarParams['getResponse']
        >;

      const har = await buildHar({
        requests,
        getResponse,
        getResponseBody: async (id) => {
          try {
            return await this.consoleMonitor.getResponseBody(id);
          } catch {
            return null;
          }
        },
        includeBodies,
        creatorVersion: '1.0.0',
      });

      if (resolvedOutputPath) {
        try {
          const stat = await fs.lstat(resolvedOutputPath);
          if (stat.isSymbolicLink()) {
            return R.fail('outputPath must not be a symbolic link.').json();
          }
        } catch {
          // File doesn't exist yet
        }

        await fs.writeFile(resolvedOutputPath, JSON.stringify(har, null, 2), 'utf-8');
        return R.ok()
          .merge({
            message: `HAR exported to ${resolvedOutputPath}`,
            entryCount: har.log.entries.length,
            outputPath: resolvedOutputPath,
          })
          .json();
      }

      const result = this.detailedDataManager.smartHandle(
        {
          entryCount: har.log.entries.length,
          har,
        },
        51200,
      );

      return R.ok()
        .merge(result as unknown as Record<string, unknown>)
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkReplayRequest(args: Record<string, unknown>) {
    try {
      const requestId = args.requestId as string;
      if (!requestId) {
        return R.fail('requestId is required').json();
      }

      const requests = this.consoleMonitor.getNetworkRequests();
      const base = requests.find(
        (request: unknown): request is ReplayableRequest =>
          isReplayableRequest(request) && request.requestId === requestId,
      );

      if (!base) {
        return R.fail(`Request ${requestId} not found in captured requests`)
          .merge({ hint: 'Use network_get_requests to list available requestIds' })
          .json();
      }

      const authorization = parseReplayAuthorization(args, requestId);
      const result = await replayRequest(base, {
        requestId,
        headerPatch: args.headerPatch as Record<string, string> | undefined,
        bodyPatch: args.bodyPatch as string | undefined,
        methodOverride: args.methodOverride as string | undefined,
        urlOverride: args.urlOverride as string | undefined,
        timeoutMs: args.timeoutMs as number | undefined,
        dryRun: args.dryRun !== false,
        authorization,
      });

      return R.ok()
        .merge(result as unknown as Record<string, unknown>)
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }
}
