import { AdvancedToolHandlersRequests } from './handlers.impl.core.runtime.requests.js';

interface CpuProfileCallFramePayload {
  functionName?: string;
  url?: string;
  lineNumber?: number;
}

interface CpuProfileNodePayload {
  hitCount?: number;
  callFrame?: CpuProfileCallFramePayload;
}

interface CpuProfilePayload {
  nodes: CpuProfileNodePayload[];
  samples?: unknown[];
  startTime: number;
  endTime: number;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? value : undefined;
};

const isCpuProfileNodePayload = (value: unknown): value is CpuProfileNodePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.hitCount !== undefined && typeof value.hitCount !== 'number') {
    return false;
  }

  if (value.callFrame !== undefined && !isObjectRecord(value.callFrame)) {
    return false;
  }
  if (isObjectRecord(value.callFrame)) {
    if (
      value.callFrame.functionName !== undefined &&
      typeof value.callFrame.functionName !== 'string'
    ) {
      return false;
    }
    if (value.callFrame.url !== undefined && typeof value.callFrame.url !== 'string') {
      return false;
    }
    if (value.callFrame.lineNumber !== undefined && typeof value.callFrame.lineNumber !== 'number') {
      return false;
    }
  }

  return true;
};

const toCpuProfilePayload = (value: unknown): CpuProfilePayload | null => {
  if (!isObjectRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.nodes)) {
    return null;
  }
  if (typeof value.startTime !== 'number' || typeof value.endTime !== 'number') {
    return null;
  }
  if (!value.nodes.every((node) => isCpuProfileNodePayload(node))) {
    return null;
  }

  return {
    nodes: value.nodes,
    samples: Array.isArray(value.samples) ? value.samples : undefined,
    startTime: value.startTime,
    endTime: value.endTime,
  };
};

export class AdvancedToolHandlersPerformance extends AdvancedToolHandlersRequests {
  async handlePerformanceGetMetrics(args: Record<string, unknown>) {
    const includeTimeline = args.includeTimeline === true;
    const monitor = this.getPerformanceMonitor();

    const metrics = await monitor.getPerformanceMetrics();

    const result: Record<string, unknown> = {
      success: true,
      metrics,
    };

    if (includeTimeline) {
      result.timeline = await monitor.getPerformanceTimeline();
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handlePerformanceStartCoverage(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    await monitor.startCoverage();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Code coverage collection started',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceStopCoverage(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const coverage = await monitor.stopCoverage();
    const avgCoverage =
      coverage.length > 0
        ? coverage.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverage.length
        : 0;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              coverage,
              totalScripts: coverage.length,
              avgCoverage,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceTakeHeapSnapshot(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const snapshot = await monitor.takeHeapSnapshot();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              snapshotSize: snapshot.length,
              message: 'Heap snapshot taken (data too large to return, saved internally)',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceTraceStart(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const categories = asOptionalStringArray(args.categories);
    const screenshots = asOptionalBoolean(args.screenshots);

    await monitor.startTracing({ categories, screenshots });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Performance tracing started. Call performance_trace_stop to save the trace.',
          }),
        },
      ],
    };
  }

  async handlePerformanceTraceStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const artifactPath = asOptionalString(args.artifactPath);

    const result = await monitor.stopTracing({ artifactPath });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: result.artifactPath,
              eventCount: result.eventCount,
              sizeBytes: result.sizeBytes,
              sizeKB: (result.sizeBytes / 1024).toFixed(1),
              hint: 'Open the trace file in Chrome DevTools → Performance tab → Load profile',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleProfilerCpuStart(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    await monitor.startCPUProfiling();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'CPU profiling started. Call profiler_cpu_stop to save the profile.',
          }),
        },
      ],
    };
  }

  async handleProfilerCpuStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const profileRaw = await monitor.stopCPUProfiling();
    const profile = toCpuProfilePayload(profileRaw) || (profileRaw as CpuProfilePayload);

    const { writeFile } = await import('node:fs/promises');
    const { resolveArtifactPath } = await import('../../../utils/artifacts.js');
    const artifactPath = asOptionalString(args.artifactPath);

    const profileJson = JSON.stringify(profile, null, 2);
    let savedPath: string;

    if (artifactPath) {
      await writeFile(artifactPath, profileJson, 'utf-8');
      savedPath = artifactPath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'profiles',
        toolName: 'cpu-profile',
        ext: 'cpuprofile',
      });
      await writeFile(absolutePath, profileJson, 'utf-8');
      savedPath = displayPath;
    }

    const hotFunctions = profile.nodes
      .filter((n) => (n.hitCount || 0) > 0)
      .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
      .slice(0, 20)
      .map((n) => ({
        functionName: n.callFrame?.functionName || '(anonymous)',
        url: n.callFrame?.url,
        line: n.callFrame?.lineNumber,
        hitCount: n.hitCount,
      }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              totalNodes: profile.nodes.length,
              totalSamples: profile.samples?.length || 0,
              durationMs: profile.endTime - profile.startTime,
              hotFunctions,
              hint: 'Open the .cpuprofile file in Chrome DevTools → Performance tab',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleProfilerHeapSamplingStart(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const samplingInterval = asOptionalNumber(args.samplingInterval);

    await monitor.startHeapSampling({ samplingInterval });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Heap sampling started. Call profiler_heap_sampling_stop to save the report.',
          }),
        },
      ],
    };
  }

  async handleProfilerHeapSamplingStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const artifactPath = asOptionalString(args.artifactPath);
    const topN = asOptionalNumber(args.topN);

    const result = await monitor.stopHeapSampling({ artifactPath, topN });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: result.artifactPath,
              sampleCount: result.sampleCount,
              topAllocations: result.topAllocations,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
