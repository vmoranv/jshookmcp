/**
 * JADX decompilation utilities.
 * Class file resolution, method extraction, and file discovery helpers.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface ResolveClassFileResult {
  success: true;
  classFile: string;
  resolvedClassName: string;
}

export interface ResolveClassFileFailure {
  success: false;
  suggestions: string[];
}

export type ResolveClassFileOutput = ResolveClassFileResult | ResolveClassFileFailure;

export async function resolveDecompiledClassFile(
  sourcesDir: string,
  requestedClassName: string,
): Promise<ResolveClassFileOutput> {
  const exactFile = buildExpectedClassFile(sourcesDir, requestedClassName);
  try {
    await readFile(exactFile, 'utf8');
    return {
      success: true,
      classFile: exactFile,
      resolvedClassName: requestedClassName,
    };
  } catch {
    // fall through to best-effort class discovery
  }

  const candidates = await findClassCandidates(sourcesDir, requestedClassName);
  if (candidates.length === 0) {
    return { success: false, suggestions: [] };
  }
  if (candidates.length === 1) {
    const onlyCandidate = candidates[0];
    if (!onlyCandidate) {
      return { success: false, suggestions: [] };
    }
    return {
      success: true,
      classFile: onlyCandidate.classFile,
      resolvedClassName: onlyCandidate.className,
    };
  }

  const best = candidates[0];
  const second = candidates[1];
  if (!best || !second) {
    return {
      success: false,
      suggestions: candidates.slice(0, 10).map((candidate) => candidate.className),
    };
  }

  if (best.score > second.score) {
    return {
      success: true,
      classFile: best.classFile,
      resolvedClassName: best.className,
    };
  }

  return {
    success: false,
    suggestions: candidates.slice(0, 10).map((candidate) => candidate.className),
  };
}

function scoreClassCandidate(requestedPackage: string[], candidatePackage: string[]): number {
  let prefixMatches = 0;
  const prefixLimit = Math.min(requestedPackage.length, candidatePackage.length);
  while (
    prefixMatches < prefixLimit &&
    requestedPackage[prefixMatches] === candidatePackage[prefixMatches]
  ) {
    prefixMatches += 1;
  }

  let suffixMatches = 0;
  const suffixLimit = Math.min(requestedPackage.length, candidatePackage.length);
  while (
    suffixMatches < suffixLimit &&
    requestedPackage[requestedPackage.length - 1 - suffixMatches] ===
      candidatePackage[candidatePackage.length - 1 - suffixMatches]
  ) {
    suffixMatches += 1;
  }

  return prefixMatches * 10 + suffixMatches;
}

export function extractMethodSource(source: string, methodName: string): string | null {
  const methodRegex = new RegExp(
    `(?:public|private|protected|static|final|abstract|synchronized|native)\\s+[\\w<>\\[\\]]+\\s+${methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)\\s*(?:throws[^{]*)?\\{`,
  );
  const matchStart = source.search(methodRegex);
  if (matchStart === -1) {
    return null;
  }

  let depth = 0;
  let index = source.indexOf('{', matchStart);
  for (; index < source.length; index++) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(matchStart, index + 1);
}

export async function findFilesByExtension(
  root: string,
  extensions: string[],
  limit: number,
): Promise<string[]> {
  const out: string[] = [];
  const lowerExts = extensions.map((ext) => ext.toLowerCase());
  const walk = async (directory: string): Promise<void> => {
    if (out.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= limit) return;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!lowerExts.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
      out.push(relative(root, fullPath).replace(/\\/g, '/'));
    }
  };
  await walk(root);
  return out;
}

function buildExpectedClassFile(sourcesDir: string, className: string): string {
  const parts = className.split('.');
  const simpleClassName = (parts[parts.length - 1] ?? '').split('$')[0] ?? '';
  return join(sourcesDir, ...parts.slice(0, -1), `${simpleClassName}.java`);
}

async function findClassCandidates(
  sourcesDir: string,
  requestedClassName: string,
): Promise<Array<{ className: string; classFile: string; score: number }>> {
  const requestedParts = requestedClassName.split('.');
  const requestedSimpleName = (requestedParts[requestedParts.length - 1] ?? '').split('$')[0] ?? '';
  const requestedPackage = requestedParts.slice(0, -1);
  const targetFileName = `${requestedSimpleName}.java`;
  const candidates: Array<{ className: string; classFile: string; score: number }> = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== targetFileName) continue;

      const relativePath = relative(sourcesDir, fullPath)
        .replace(/\\/g, '/')
        .replace(/\.java$/i, '');
      const className = relativePath.split('/').join('.');
      const candidatePackage = className.split('.').slice(0, -1);
      candidates.push({
        className,
        classFile: fullPath,
        score: scoreClassCandidate(requestedPackage, candidatePackage),
      });
    }
  };

  await walk(sourcesDir);
  return candidates.toSorted(
    (left, right) => right.score - left.score || left.className.localeCompare(right.className),
  );
}
