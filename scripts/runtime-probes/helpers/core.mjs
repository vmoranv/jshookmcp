export const DIRECT_RUNTIME_PROBED_TOOLS = new Set();
const AUDIT_DEBUG = process.env.RUNTIME_AUDIT_DEBUG === '1';

export function pemToDerHex(pem) {
  return Buffer.from(
    pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, ''),
    'base64',
  ).toString('hex');
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parseContent(result) {
  if (!isRecord(result) || !Array.isArray(result.content) || result.content.length === 0) {
    return result;
  }
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') {
    return result;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

export function getCapability(report, capability) {
  if (!isRecord(report) || !Array.isArray(report.capabilities)) {
    return null;
  }
  return (
    report.capabilities.find((entry) => isRecord(entry) && entry.capability === capability) ?? null
  );
}

export function isCapabilityAvailable(report, capability) {
  const entry = getCapability(report, capability);
  return isRecord(entry) && entry.available === true;
}

export async function withTimeout(promise, label, timeoutMs = 30000) {
  return await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms (${label})`)), timeoutMs),
    ),
  ]);
}

export async function callTool(client, name, args = {}, timeoutMs = 30000) {
  DIRECT_RUNTIME_PROBED_TOOLS.add(name);
  if (AUDIT_DEBUG) {
    console.error(`[runtime-audit] calling ${name}`);
  }
  try {
    const result = parseContent(
      await withTimeout(client.callTool({ name, arguments: args }), name, timeoutMs),
    );
    if (AUDIT_DEBUG) {
      console.error(`[runtime-audit] completed ${name}`);
    }
    return result;
  } catch (error) {
    if (AUDIT_DEBUG) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runtime-audit] failed ${name}: ${message}`);
    }
    throw error;
  }
}

export async function callToolCaptureError(client, name, args = {}, timeoutMs = 30000) {
  try {
    return await callTool(client, name, args, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
      tool: name,
      timedOut: message.includes('Timeout after'),
    };
  }
}

export function flattenStrings(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, output);
    return output;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) flattenStrings(item, output);
  }
  return output;
}

export function extractString(value, keys) {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

export function getArrayFromRecord(value, key) {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

export function findFirstModule(value) {
  return getArrayFromRecord(value, 'modules').find(
    (entry) => isRecord(entry) && typeof entry.baseAddress === 'string',
  );
}

export function findRegion(value, predicate = () => true) {
  return getArrayFromRecord(value, 'regions').find(
    (entry) =>
      isRecord(entry) &&
      typeof entry.baseAddress === 'string' &&
      typeof entry.size === 'number' &&
      predicate(entry),
  );
}

function normalizeHex(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : '';
}

export function takeHexBytes(value, byteCount) {
  const normalized = normalizeHex(value);
  if (normalized.length < byteCount * 2) {
    return normalized;
  }
  return normalized.slice(0, byteCount * 2);
}

export function getTabularRowValue(row, columns, columnName) {
  if (!Array.isArray(row) || !Array.isArray(columns)) {
    return isRecord(row) ? row[columnName] : undefined;
  }
  const columnIndex = columns.indexOf(columnName);
  if (columnIndex === -1) {
    return undefined;
  }
  return row[columnIndex];
}

export function findRequestByUrl(requests, needle) {
  if (!Array.isArray(requests)) return null;
  for (const request of requests) {
    if (!isRecord(request)) continue;
    const haystack = flattenStrings(request).join('\n');
    if (haystack.includes(needle)) {
      return request;
    }
  }
  return null;
}

export function pickScriptForV8Inspection(scripts) {
  if (!Array.isArray(scripts)) {
    return null;
  }

  const candidates = scripts.filter(
    (script) =>
      isRecord(script) && typeof script.scriptId === 'string' && script.scriptId.length > 0,
  );
  if (candidates.length === 0) {
    return null;
  }

  const explicitAuditProbe = candidates.find((script) => {
    const url = typeof script.url === 'string' ? script.url : '';
    return url === 'audit-probe.js' || url.endsWith('/audit-probe.js');
  });
  if (explicitAuditProbe) {
    return explicitAuditProbe;
  }

  const preferred = candidates.find((script) => {
    const url = typeof script.url === 'string' ? script.url : '';
    return (
      url.length > 0 &&
      !url.startsWith('pptr:') &&
      !url.startsWith('extensions::') &&
      !url.startsWith('node:')
    );
  });
  const withUrl = candidates.find(
    (script) => typeof script.url === 'string' && script.url.length > 0,
  );
  return preferred ?? withUrl ?? candidates[0] ?? null;
}

export function pickBrowserCdpTarget(targets, urlNeedle) {
  if (!Array.isArray(targets)) {
    return null;
  }

  const candidates = targets.filter(
    (target) =>
      isRecord(target) && typeof target.targetId === 'string' && target.targetId.length > 0,
  );
  if (candidates.length === 0) {
    return null;
  }

  const exactPage = candidates.find((target) => {
    const type = typeof target.type === 'string' ? target.type : '';
    const url = typeof target.url === 'string' ? target.url : '';
    return type === 'page' && url.includes(urlNeedle);
  });
  if (exactPage) {
    return exactPage;
  }

  const pageTarget = candidates.find((target) => target.type === 'page');
  return pageTarget ?? candidates[0] ?? null;
}

export function buildRuntimeCoverage(registeredTools) {
  const totalRegistered = Array.isArray(registeredTools)
    ? registeredTools.filter((name) => typeof name === 'string').length
    : 0;
  const probedTools = [...DIRECT_RUNTIME_PROBED_TOOLS].toSorted();
  const registeredSet = new Set(
    Array.isArray(registeredTools)
      ? registeredTools.filter((name) => typeof name === 'string')
      : [],
  );
  const unprobedTools = [...registeredSet].filter((name) => !DIRECT_RUNTIME_PROBED_TOOLS.has(name));

  return {
    totalRegistered,
    directRuntimeProbed: probedTools.length,
    coveragePercent:
      totalRegistered === 0 ? 0 : Number(((probedTools.length / totalRegistered) * 100).toFixed(1)),
    probedTools,
    unprobedTools,
  };
}
