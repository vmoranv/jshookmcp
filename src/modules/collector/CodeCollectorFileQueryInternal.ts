import type { CodeFile } from '@internal-types/index';
import { logger } from '@utils/logger';
import { calculatePriorityScore } from '@modules/collector/PageScriptCollectors';

export function getCollectedFilesSummaryImpl(collectedFilesCache: Map<string, CodeFile>): Array<{
  url: string;
  size: number;
  type: string;
  truncated?: boolean;
  originalSize?: number;
}> {
  const summaries = Array.from(collectedFilesCache.values()).map((file) => ({
    url: file.url,
    size: file.size,
    type: file.type,
    truncated: typeof file.metadata?.truncated === 'boolean' ? file.metadata.truncated : undefined,
    originalSize:
      typeof file.metadata?.originalSize === 'number' ? file.metadata.originalSize : undefined,
  }));
  logger.info(`Returning summary of ${summaries.length} collected files`);
  return summaries;
}

export function getFileByUrlImpl(
  collectedFilesCache: Map<string, CodeFile>,
  url: string,
): CodeFile | null {
  const file = collectedFilesCache.get(url);
  if (file) {
    logger.info(`Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`);
    return file;
  }
  logger.warn(`File not found: ${url}`);
  return null;
}

export function getFilesByPatternImpl(
  collectedFilesCache: Map<string, CodeFile>,
  pattern: string,
  limit: number,
  maxTotalSize: number,
): {
  files: CodeFile[];
  totalSize: number;
  matched: number;
  returned: number;
  truncated: boolean;
} {
  const regex = new RegExp(pattern);
  const matched: CodeFile[] = [];
  for (const file of collectedFilesCache.values()) {
    if (regex.test(file.url)) {
      matched.push(file);
    }
  }
  const returned: CodeFile[] = [];
  let totalSize = 0;
  let truncated = false;
  for (let i = 0; i < matched.length && i < limit; i++) {
    const file = matched[i];
    if (file && totalSize + file.size <= maxTotalSize) {
      returned.push(file);
      totalSize += file.size;
    } else {
      truncated = true;
      break;
    }
  }
  if (truncated || matched.length > limit) {
    logger.warn(
      `Pattern "${pattern}" matched ${matched.length} files, returning ${returned.length} (limited by size/count)`,
    );
  }
  logger.info(
    ` Pattern "${pattern}": matched ${matched.length}, returning ${returned.length} files (${(totalSize / 1024).toFixed(2)} KB)`,
  );
  return {
    files: returned,
    totalSize,
    matched: matched.length,
    returned: returned.length,
    truncated,
  };
}

export function getTopPriorityFilesImpl(
  collectedFilesCache: Map<string, CodeFile>,
  topN: number,
  maxTotalSize: number,
): {
  files: CodeFile[];
  totalSize: number;
  totalFiles: number;
} {
  const allFiles = Array.from(collectedFilesCache.values());
  const scoredFiles = allFiles.map((file) => ({
    file,
    score: calculatePriorityScore(file),
  }));
  scoredFiles.sort((a, b) => b.score - a.score);
  const selected: CodeFile[] = [];
  let totalSize = 0;
  for (let i = 0; i < Math.min(topN, scoredFiles.length); i++) {
    const item = scoredFiles[i];
    if (item?.file && totalSize + item.file.size <= maxTotalSize) {
      selected.push(item.file);
      totalSize += item.file.size;
    } else {
      break;
    }
  }
  logger.info(
    `Returning top ${selected.length}/${allFiles.length} priority files (${(totalSize / 1024).toFixed(2)} KB)`,
  );
  return {
    files: selected,
    totalSize,
    totalFiles: allFiles.length,
  };
}
