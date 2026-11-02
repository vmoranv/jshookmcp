import type { PlaywrightLikeResponse } from './PlaywrightNetworkMonitor.types';

function normalizeHttpVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'http/1.0' || normalized === '1.0') return '1.0';
  if (normalized === 'http/1.1' || normalized === '1.1') return '1.1';
  if (
    normalized === 'http/2' ||
    normalized === '2' ||
    normalized === '2.0' ||
    normalized === 'h2'
  ) {
    return 'h2';
  }
  if (
    normalized === 'http/3' ||
    normalized === '3' ||
    normalized === '3.0' ||
    normalized === 'h3'
  ) {
    return 'h3';
  }
  return undefined;
}

export function detectHttpVersion(res: PlaywrightLikeResponse): string | undefined {
  const fromHttpVersion = typeof res.httpVersion === 'function' ? res.httpVersion() : undefined;
  const normalizedHttpVersion = normalizeHttpVersion(fromHttpVersion);
  if (normalizedHttpVersion) {
    return normalizedHttpVersion;
  }

  const fromProtocol = typeof res.protocol === 'function' ? res.protocol() : undefined;
  return normalizeHttpVersion(fromProtocol);
}
