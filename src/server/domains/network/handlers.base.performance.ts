/**
 * Performance & Profiler handlers — extends NetworkHandlersCore.
 *
 * Covers: performance metrics, code coverage, heap snapshots,
 * performance tracing, CPU profiling, and heap sampling.
 */

import { NetworkHandlersCore } from './handlers.base.core';
import { argEnum } from '@server/domains/shared/parse-args';
import {
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalString,
  asOptionalStringArray,
  toCpuProfilePayload,
  type CpuProfilePayload,
} from './handlers.base.types';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

export class NetworkHandlersPerformance extends NetworkHandlersCore {
  async handlePerformanceGetMetrics(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const includeTimeline = args.includeTimeline === true;
      const monitor = this.getPerformanceMonitor();
      const metrics = await monitor.getPerformanceMetrics();
      const builder = R.ok().set('metrics', metrics);
      if (includeTimeline) {
        builder.set('timeline', await monitor.getPerformanceTimeline());
      }
      return builder.json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceCoverage(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = argEnum(args, 'action', new Set(['start', 'stop'] as const));
    return action === 'stop'
      ? this.handlePerformanceStopCoverage(args)
      : this.handlePerformanceStartCoverage(args);
  }

  async handlePerformanceStartCoverage(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      await monitor.startCoverage();
      return R.ok().set('message', 'Code coverage collection started').json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceStopCoverage(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const coverage = await monitor.stopCoverage();
      const avgCoverage =
        coverage.length > 0
          ? coverage.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverage.length
          : 0;
      return R.ok().merge({ coverage, totalScripts: coverage.length, avgCoverage }).json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceTakeHeapSnapshot(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const snapshot = await monitor.takeHeapSnapshot();
      return R.ok()
        .merge({
          snapshotSize: snapshot.length,
          message: 'Heap snapshot taken (data too large to return, saved internally)',
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceTraceStart(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const categories = asOptionalStringArray(args.categories);
      const screenshots = asOptionalBoolean(args.screenshots);
      await monitor.startTracing({ categories, screenshots });
      return R.ok()
        .set(
          'message',
          'Performance tracing started. Call performance_trace_stop to save the trace.',
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceTraceStop(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const artifactPath = asOptionalString(args.artifactPath);
      const result = await monitor.stopTracing({ artifactPath });
      return R.ok()
        .merge({
          artifactPath: result.artifactPath,
          eventCount: result.eventCount,
          sizeBytes: result.sizeBytes,
          sizeKB: (result.sizeBytes / 1024).toFixed(1),
          hint: 'Open the trace file in Chrome DevTools → Performance tab → Load profile',
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleProfilerCpuStart(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      await monitor.startCPUProfiling();
      return R.ok()
        .set('message', 'CPU profiling started. Call profiler_cpu_stop to save the profile.')
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleProfilerCpuStop(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const profileRaw = await monitor.stopCPUProfiling();

      const profile = toCpuProfilePayload(profileRaw) || (profileRaw as CpuProfilePayload);

      const { writeFile } = await import('node:fs/promises');
      const { resolveArtifactPath } = await import('@utils/artifacts');
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
        .toSorted((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
        .slice(0, 20)
        .map((n) => ({
          functionName: n.callFrame?.functionName || '(anonymous)',
          url: n.callFrame?.url,
          line: n.callFrame?.lineNumber,
          hitCount: n.hitCount,
        }));

      return R.ok()
        .merge({
          artifactPath: savedPath,
          totalNodes: profile.nodes.length,
          totalSamples: profile.samples?.length || 0,
          durationMs: profile.endTime - profile.startTime,
          hotFunctions,
          hint: 'Open the .cpuprofile file in Chrome DevTools → Performance tab',
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleProfilerHeapSamplingStart(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const samplingInterval = asOptionalNumber(args.samplingInterval);
      await monitor.startHeapSampling({ samplingInterval });
      return R.ok()
        .set(
          'message',
          'Heap sampling started. Call profiler_heap_sampling_stop to save the report.',
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleProfilerHeapSamplingStop(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const monitor = this.getPerformanceMonitor();
      const artifactPath = asOptionalString(args.artifactPath);
      const topN = asOptionalNumber(args.topN);
      const result = await monitor.stopHeapSampling({ artifactPath, topN });
      return R.ok()
        .merge({
          artifactPath: result.artifactPath,
          sampleCount: result.sampleCount,
          topAllocations: result.topAllocations,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handlePerformanceTraceDispatch(args: Record<string, unknown>): Promise<ToolResponse> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handlePerformanceTraceStop(args)
      : this.handlePerformanceTraceStart(args);
  }
  async handleProfilerCpuDispatch(args: Record<string, unknown>): Promise<ToolResponse> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handleProfilerCpuStop(args)
      : this.handleProfilerCpuStart(args);
  }
  async handleProfilerHeapSamplingDispatch(args: Record<string, unknown>): Promise<ToolResponse> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handleProfilerHeapSamplingStop(args)
      : this.handleProfilerHeapSamplingStart(args);
  }
}
