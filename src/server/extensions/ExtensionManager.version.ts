/**
 * Semver parsing and compatibility checks for extension version constraints.
 */

export function parseVersionParts(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersion(a: string, b: string): number | null {
  const aa = parseVersionParts(a);
  const bb = parseVersionParts(b);
  if (!aa || !bb) return null;
  const [aMajor, aMinor, aPatch] = aa;
  const [bMajor, bMinor, bPatch] = bb;
  if (aMajor > bMajor) return 1;
  if (aMajor < bMajor) return -1;
  if (aMinor > bMinor) return 1;
  if (aMinor < bMinor) return -1;
  if (aPatch > bPatch) return 1;
  if (aPatch < bPatch) return -1;
  return 0;
}

export function isCompatibleVersion(range: string, currentVersion: string): boolean {
  const input = range.trim();
  if (!input || input === '*') return true;

  if (input.startsWith('>=')) {
    const base = input.slice(2).trim();
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0;
  }

  if (input.startsWith('^')) {
    const base = input.slice(1).trim();
    const cc = parseVersionParts(currentVersion);
    const bb = parseVersionParts(base);
    if (!cc || !bb) return false;
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0 && cc[0] === bb[0];
  }

  if (input.startsWith('~')) {
    const base = input.slice(1).trim();
    const cc = parseVersionParts(currentVersion);
    const bb = parseVersionParts(base);
    if (!cc || !bb) return false;
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0 && cc[0] === bb[0] && cc[1] === bb[1];
  }

  const cmp = compareVersion(currentVersion, input);
  return cmp !== null && cmp === 0;
}
