/**
 * Extension file discovery — prefers installed registry metadata, then falls back
 * to scanning plugin/workflow roots for legacy manifest files.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import {
  INSTALLED_EXTENSION_METADATA_FILENAME,
  type InstalledExtensionMetadata,
} from '@server/extensions/types';

type Candidate = {
  file: string;
  key: string;
  isJs: boolean;
  isTs: boolean;
  rootIndex: number;
  priority: number;
};

async function collectMatchingFiles(
  roots: string[],
  matcher: (filename: string) => boolean,
): Promise<string[]> {
  const files = new Set<string>();
  for (const root of roots) {
    let matchedPaths: string[];
    try {
      matchedPaths = await glob('**/*', {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/.pnpm/**'],
      });
    } catch {
      continue;
    }

    for (const file of matchedPaths) {
      if (matcher(basename(file))) {
        files.add(file);
      }
    }
  }
  return [...files].toSorted((a, b) => a.localeCompare(b));
}

function normalizeExtensionCandidateKey(root: string, file: string): string {
  const normalizedRoot = root
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  const relDir = relative(root, dirname(file))
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  if (!relDir || relDir === 'dist') {
    return `${normalizedRoot}::`;
  }

  const normalizedRelDir = relDir.endsWith('/dist') ? relDir.slice(0, -'/dist'.length) : relDir;
  return `${normalizedRoot}::${normalizedRelDir}`;
}

function extensionRank(candidate: Candidate): number {
  if (candidate.isJs) return 0;
  if (candidate.isTs) return 1;
  return 2;
}

function isInstalledExtensionMetadata(
  value: unknown,
  kind: 'plugin' | 'workflow',
): value is InstalledExtensionMetadata {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.kind !== kind) return false;
  if (typeof record.slug !== 'string' || typeof record.id !== 'string') return false;
  if (!record.source || typeof record.source !== 'object') return false;
  const source = record.source as Record<string, unknown>;
  return (
    typeof source.type === 'string' &&
    typeof source.repo === 'string' &&
    typeof source.ref === 'string' &&
    typeof source.commit === 'string' &&
    typeof source.subpath === 'string' &&
    typeof source.entry === 'string'
  );
}

async function collectInstalledEntryCandidates(
  roots: string[],
  kind: 'plugin' | 'workflow',
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (const [rootIndex, root] of roots.entries()) {
    const metadataFiles = await collectMatchingFiles(
      [root],
      (filename) => filename === INSTALLED_EXTENSION_METADATA_FILENAME,
    );

    for (const metadataFile of metadataFiles) {
      let metadataRaw: unknown;
      try {
        metadataRaw = JSON.parse(await readFile(metadataFile, 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (!isInstalledExtensionMetadata(metadataRaw, kind)) {
        continue;
      }

      const entryPath = metadataRaw.source.entry.trim();
      if (!entryPath) {
        continue;
      }

      const file = resolve(dirname(metadataFile), entryPath);
      if (!existsSync(file)) {
        continue;
      }

      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
        priority: 0,
      });
    }
  }

  return candidates;
}

function deduplicateCandidates(candidates: Candidate[]): string[] {
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates.toSorted((a, b) => a.file.localeCompare(b.file))) {
    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, candidate);
      continue;
    }

    const existingRoot = existing.rootIndex;
    const candidateRoot = candidate.rootIndex;
    const existingPriority = existing.priority;
    const candidatePriority = candidate.priority;
    const existingExtRank = extensionRank(existing);
    const candidateExtRank = extensionRank(candidate);

    const shouldReplace =
      candidateRoot < existingRoot ||
      (candidateRoot === existingRoot && candidatePriority < existingPriority) ||
      (candidateRoot === existingRoot &&
        candidatePriority === existingPriority &&
        candidateExtRank < existingExtRank) ||
      (candidateRoot === existingRoot &&
        candidatePriority === existingPriority &&
        candidateExtRank === existingExtRank &&
        candidate.file.localeCompare(existing.file) < 0);

    if (shouldReplace) {
      byKey.set(candidate.key, candidate);
    }
  }
  return [...byKey.values()].map((item) => item.file).toSorted((a, b) => a.localeCompare(b));
}

export async function discoverPluginFiles(pluginRoots: string[]): Promise<string[]> {
  const candidates = await collectInstalledEntryCandidates(pluginRoots, 'plugin');

  for (const [rootIndex, root] of pluginRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) => filename === 'manifest.js' || filename === 'manifest.ts',
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
        priority: 1,
      });
    }
  }

  return deduplicateCandidates(candidates);
}

export async function discoverWorkflowFiles(workflowRoots: string[]): Promise<string[]> {
  const candidates = await collectInstalledEntryCandidates(workflowRoots, 'workflow');

  for (const [rootIndex, root] of workflowRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) =>
        filename.endsWith('.workflow.js') ||
        filename.endsWith('.workflow.ts') ||
        filename === 'workflow.js' ||
        filename === 'workflow.ts',
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
        priority: 1,
      });
    }
  }

  return deduplicateCandidates(candidates);
}
