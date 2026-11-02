import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { logger } from '@utils/logger';
import { cdpLimit } from '@utils/concurrency';
import { writeFile } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import { countTraceEvents } from './PerformanceMonitor.types';

/** Default cap on saved trace size; larger traces are truncated with a warning. */
const DEFAULT_MAX_TRACE_SIZE_MB = 500;

export async function startTracing(
  collector: CodeCollector,
  tracingEnabled: boolean,
  options?: { categories?: string[]; screenshots?: boolean },
): Promise<{ tracingEnabled: true; tracingPage: Page }> {
  return cdpLimit(async () => {
    if (tracingEnabled) {
      throw new Error('Tracing already in progress. Call stopTracing() first.');
    }

    const page = await collector.getActivePage();
    const categories = options?.categories ?? [
      '-*',
      'devtools.timeline',
      'v8.execute',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'toplevel',
      'blink.console',
      'blink.user_timing',
      'latencyInfo',
      ...(options?.screenshots ? ['disabled-by-default-devtools.screenshot'] : []),
    ];

    await page.tracing.start({
      categories,
      screenshots: options?.screenshots,
    });

    logger.info('Performance tracing started', { categories: categories.length });
    return { tracingEnabled: true, tracingPage: page };
  });
}

export async function stopTracing(
  collector: CodeCollector,
  tracingPage: Page | null,
  tracingEnabled: boolean,
  options?: {
    artifactPath?: string;
    maxSizeMB?: number;
  },
): Promise<{
  artifactPath?: string;
  eventCount: number;
  sizeBytes: number;
  truncated?: boolean;
  originalSizeBytes?: number;
}> {
  return cdpLimit(async () => {
    if (!tracingEnabled) {
      throw new PrerequisiteError('Tracing not in progress. Call startTracing() first.');
    }

    const page = tracingPage ?? (await collector.getActivePage());
    let rawBuffer: Buffer;
    try {
      const stopped = await page.tracing.stop();
      rawBuffer = stopped ? Buffer.from(stopped) : Buffer.alloc(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to stop performance tracing: ${msg}`, { cause: err });
    }

    // Cap trace size: toString + regex scan on a multi-GB trace multiplies
    // memory ~3x; oversized traces are truncated and written as raw Buffer.
    const maxSizeMB = options?.maxSizeMB ?? DEFAULT_MAX_TRACE_SIZE_MB;
    const limitBytes = maxSizeMB * 1024 * 1024;
    const oversized = rawBuffer.length > limitBytes;
    const outBuffer = oversized ? rawBuffer.subarray(0, limitBytes) : rawBuffer;
    if (oversized) {
      logger.warn(
        `Trace is ${rawBuffer.length} bytes, exceeding maxSizeMB=${maxSizeMB}; ` +
          `truncated to ${limitBytes} bytes`,
      );
    }

    // Counting markers is much cheaper than materializing a large trace JSON object.
    const eventCount = countTraceEvents(outBuffer);
    const sizeBytes = outBuffer.length;
    const traceData = oversized ? undefined : outBuffer.toString('utf-8');

    // Save to artifact file
    let savedPath: string | undefined;
    if (options?.artifactPath) {
      await writeFile(options.artifactPath, traceData ?? outBuffer, 'utf-8');
      savedPath = options.artifactPath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'traces',
        toolName: 'performance-trace',
        ext: 'json',
      });
      await writeFile(absolutePath, traceData ?? outBuffer, 'utf-8');
      savedPath = displayPath;
    }

    logger.success('Performance trace saved', {
      eventCount,
      sizeBytes,
      path: savedPath,
      ...(oversized ? { truncated: true, originalSizeBytes: rawBuffer.length } : {}),
    });

    return {
      artifactPath: savedPath,
      eventCount,
      sizeBytes,
      ...(oversized ? { truncated: true, originalSizeBytes: rawBuffer.length } : {}),
    };
  });
}
