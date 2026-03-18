/**
 * Extension file discovery — scans plugin/workflow roots for manifest files.
 */
import { basename, dirname } from 'node:path';
import { glob } from 'tinyglobby';

type Candidate = {
  file: string;
  key: string;
  isJs: boolean;
  isTs: boolean;
  rootIndex: number;
};

async function collectMatchingFiles(
  roots: string[],
  matcher: (filename: string) => boolean
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
  return [...files].sort((a, b) => a.localeCompare(b));
}

function normalizeExtensionCandidateKey(root: string, file: string): string {
  const normalizedRoot = root
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  const relDir = dirname(file)
    .slice(root.length)
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

function deduplicateCandidates(candidates: Candidate[]): string[] {
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates.sort((a, b) => a.file.localeCompare(b.file))) {
    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, candidate);
      continue;
    }

    const existingRoot = existing.rootIndex;
    const candidateRoot = candidate.rootIndex;
    const existingExtRank = extensionRank(existing);
    const candidateExtRank = extensionRank(candidate);

    const shouldReplace =
      candidateRoot < existingRoot ||
      (candidateRoot === existingRoot && candidateExtRank < existingExtRank) ||
      (candidateRoot === existingRoot &&
        candidateExtRank === existingExtRank &&
        candidate.file.localeCompare(existing.file) < 0);

    if (shouldReplace) {
      byKey.set(candidate.key, candidate);
    }
  }
  return [...byKey.values()].map((item) => item.file).sort((a, b) => a.localeCompare(b));
}

export async function discoverPluginFiles(pluginRoots: string[]): Promise<string[]> {
  const candidates: Candidate[] = [];

  for (const [rootIndex, root] of pluginRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) => filename === 'manifest.js' || filename === 'manifest.ts'
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
      });
    }
  }

  return deduplicateCandidates(candidates);
}

export async function discoverWorkflowFiles(workflowRoots: string[]): Promise<string[]> {
  const candidates: Candidate[] = [];

  for (const [rootIndex, root] of workflowRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) =>
        filename.endsWith('.workflow.js') ||
        filename.endsWith('.workflow.ts') ||
        filename === 'workflow.js' ||
        filename === 'workflow.ts'
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
      });
    }
  }

  return deduplicateCandidates(candidates);
}
