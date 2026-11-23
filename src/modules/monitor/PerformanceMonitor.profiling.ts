import type { CDPSession } from 'rebrowser-puppeteer-core';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { logger } from '@utils/logger';
import { cdpLimit } from '@utils/concurrency';
import { writeFile } from 'node:fs/promises';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { writeOutputFile } from '@utils/safeOutput';
import type { CPUProfile } from './PerformanceMonitor.types';
import { isCDPHeapSamplingPayload, collectTopHeapAllocations } from './PerformanceMonitor.types';

async function yieldToEventLoop(): Promise<void> {
  await waitForImmediate();
}

export async function startCPUProfiling(
  cdp: CDPSession,
  options?: { samplingInterval?: number },
): Promise<{ profilerEnabled: true }> {
  await cdp.send('Profiler.enable');
  if (options?.samplingInterval !== undefined) {
    // The sampling interval must be set before Profiler.start; it cannot be
    // changed mid-session. Default is 1000µs (1ms); 30-100µs for high-res.
    await cdp.send('Profiler.setSamplingInterval', { interval: options.samplingInterval });
  }
  await cdp.send('Profiler.start');

  logger.info('CPU profiling started');
  return { profilerEnabled: true };
}

export async function stopCPUProfiling(
  cdp: CDPSession,
  profilerEnabled: boolean,
): Promise<CPUProfile> {
  if (!profilerEnabled) {
    throw new PrerequisiteError('CPU profiling not enabled. Call startCPUProfiling() first.');
  }

  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');

  logger.success('CPU profiling stopped', {
    nodes: profile.nodes.length,
    samples: profile.samples?.length || 0,
  });

  return profile;
}

export async function startHeapSampling(
  cdp: CDPSession,
  heapSamplingEnabled: boolean,
  options?: { samplingInterval?: number },
): Promise<{ heapSamplingEnabled: true }> {
  return cdpLimit(async () => {
    if (heapSamplingEnabled) {
      throw new Error('Heap sampling already in progress. Call stopHeapSampling() first.');
    }

    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: options?.samplingInterval ?? 32768,
    });

    logger.info('Heap sampling profiler started');
    return { heapSamplingEnabled: true };
  });
}

export async function stopHeapSampling(
  cdp: CDPSession,
  heapSamplingEnabled: boolean,
  options?: { artifactPath?: string; topN?: number },
): Promise<{
  artifactPath?: string;
  sampleCount: number;
  topAllocations: Array<{ functionName: string; url: string; selfSize: number }>;
}> {
  return cdpLimit(async () => {
    if (!heapSamplingEnabled) {
      throw new PrerequisiteError('Heap sampling not in progress. Call startHeapSampling() first.');
    }

    const samplingPayload = (await cdp.send('HeapProfiler.stopSampling')) as unknown;
    if (!isCDPHeapSamplingPayload(samplingPayload)) {
      throw new Error('Unexpected HeapProfiler.stopSampling payload shape');
    }
    const { profile } = samplingPayload;
    await cdp.send('HeapProfiler.disable');

    const topN = options?.topN ?? 20;
    await yieldToEventLoop();
    const { sampleCount, topAllocations } = collectTopHeapAllocations(profile.head, topN);

    // Save full profile in compact JSON to reduce serialization overhead.
    await yieldToEventLoop();
    const profileJson = JSON.stringify(profile);
    let savedPath: string | undefined;
    if (options?.artifactPath) {
      savedPath = await writeOutputFile(options.artifactPath, profileJson, {
        allowedRoots: getSafeOutputRoots(),
        allowedRootsDescription: 'project root or system temp directory',
      });
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'profiles',
        toolName: 'heap-sampling',
        ext: 'json',
      });
      await writeFile(absolutePath, profileJson, 'utf-8');
      savedPath = displayPath;
    }

    logger.success('Heap sampling profile saved', { sampleCount, path: savedPath });

    return {
      artifactPath: savedPath,
      sampleCount,
      topAllocations,
    };
  });
}
