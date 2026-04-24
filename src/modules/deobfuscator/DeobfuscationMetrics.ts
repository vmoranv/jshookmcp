import { logger } from '@utils/logger';

export type ObfuscationCategory =
  | 'string'
  | 'control-flow'
  | 'code-structure'
  | 'encoding'
  | 'dynamic-code'
  | 'bundle'
  | 'anti-analysis'
  | 'vm-protection'
  | 'unknown';

export interface MetricSnapshot {
  timestamp: number;
  stage: string;
  codeLength: number;
  readabilityScore: number;
  obfuscationTypes: ObfuscationCategory[];
  detectionCounts: Record<string, number>;
}

export interface DeobfuscationMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  totalTimeMs: number;
  averageTimeMs: number;
  totalBytesProcessed: number;
  averageCompressionRatio: number;
  obfuscationTypeCounts: Record<string, number>;
  categoryCounts: Record<ObfuscationCategory, number>;
  stageTimings: Record<string, { count: number; totalMs: number; avgMs: number }>;
  snapshots: MetricSnapshot[];
}

export interface StageMetrics {
  stageName: string;
  startTime: number;
  endTime?: number;
  codeLengthBefore: number;
  codeLengthAfter?: number;
  readabilityBefore: number;
  readabilityAfter?: number;
  applied: boolean;
  detections: string[];
}

export class DeobfuscationMetricsCollector {
  private static readonly MAX_STAGE_HISTORY = 1000;
  private static readonly MAX_SNAPSHOTS = 100;

  private metrics: DeobfuscationMetrics;
  private currentStage: StageMetrics | null = null;
  private stageHistory: StageMetrics[] = [];
  private runStartTime: number = 0;

  constructor() {
    this.metrics = this.createInitialMetrics();
  }

  private createInitialMetrics(): DeobfuscationMetrics {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalTimeMs: 0,
      averageTimeMs: 0,
      totalBytesProcessed: 0,
      averageCompressionRatio: 1.0,
      obfuscationTypeCounts: {},
      categoryCounts: {
        'string': 0,
        'control-flow': 0,
        'code-structure': 0,
        'encoding': 0,
        'dynamic-code': 0,
        'bundle': 0,
        'anti-analysis': 0,
        'vm-protection': 0,
        'unknown': 0,
      },
      stageTimings: {},
      snapshots: [],
    };
  }

  public startRun(codeLength: number): void {
    this.runStartTime = Date.now();
    this.metrics.totalRuns++;
    this.metrics.totalBytesProcessed += codeLength;
    this.stageHistory = [];
    this.currentStage = null;
    logger.debug(`Metrics: started run #${this.metrics.totalRuns}, ${codeLength} bytes`);
  }

  public startStage(
    stageName: string,
    codeLength: number,
    readabilityScore: number,
  ): void {
    this.currentStage = {
      stageName,
      startTime: Date.now(),
      codeLengthBefore: codeLength,
      readabilityBefore: readabilityScore,
      applied: false,
      detections: [],
    };
  }

  public recordDetection(detectionType: string): void {
    if (this.currentStage) {
      this.currentStage.detections.push(detectionType);
    }
  }

  public endStage(
    codeLengthAfter: number,
    readabilityAfter: number,
    applied: boolean,
  ): void {
    if (!this.currentStage) return;

    const endTime = Date.now();
    this.currentStage.endTime = endTime;
    this.currentStage.codeLengthAfter = codeLengthAfter;
    this.currentStage.readabilityAfter = readabilityAfter;
    this.currentStage.applied = applied;

    const stageMs = endTime - this.currentStage.startTime;
    const stageName = this.currentStage.stageName;
    this.updateStageTiming(stageName, stageMs);

    this.stageHistory.push(this.currentStage);
    if (this.stageHistory.length > DeobfuscationMetricsCollector.MAX_STAGE_HISTORY) {
      this.stageHistory.shift();
    }
    this.currentStage = null;

    logger.debug(
      `Metrics: stage '${stageName}' done in ${stageMs}ms, applied=${applied}`,
    );
  }

  public endRun(success: boolean, outputLength: number): void {
    try {
      if (success) {
        this.metrics.successfulRuns++;
      } else {
        this.metrics.failedRuns++;
      }

      const runDuration = Date.now() - this.runStartTime;
      this.metrics.totalTimeMs += runDuration;
      this.metrics.averageTimeMs = this.metrics.totalTimeMs / this.metrics.totalRuns;

      if (this.stageHistory.length > 0 && this.metrics.totalBytesProcessed > 0) {
        const compressionRatio = outputLength / this.metrics.totalBytesProcessed;
        const prevRatio = this.metrics.averageCompressionRatio;
        const runs = this.metrics.successfulRuns;
        this.metrics.averageCompressionRatio =
          runs > 1 ? (prevRatio * (runs - 1) + compressionRatio) / runs : compressionRatio;
      }

      const snapshot = this.createSnapshot(outputLength);
      this.metrics.snapshots.push(snapshot);

      if (this.metrics.snapshots.length > DeobfuscationMetricsCollector.MAX_SNAPSHOTS) {
        this.metrics.snapshots = this.metrics.snapshots.slice(-DeobfuscationMetricsCollector.MAX_SNAPSHOTS);
      }

      logger.debug(
        `Metrics: ended run, success=${success}, ${outputLength} output bytes`,
      );
    } catch (error) {
      logger.error('Metrics: endRun failed', error);
    }
  }

  public recordObfuscationType(obfuscationType: string): void {
    this.metrics.obfuscationTypeCounts[obfuscationType] =
      (this.metrics.obfuscationTypeCounts[obfuscationType] ?? 0) + 1;

    const category = this.categorizeType(obfuscationType);
    this.metrics.categoryCounts[category]++;
  }

  public recordObfuscationTypes(types: string[]): void {
    for (const type of types) {
      this.recordObfuscationType(type);
    }
  }

  private categorizeType(obfuscationType: string): ObfuscationCategory {
    const type = obfuscationType.toLowerCase();

    if (type.includes('string') || type.includes('array')) return 'string';
    if (type.includes('control') || type.includes('flatten') || type.includes('opaque')) {
      return 'control-flow';
    }
    if (type.includes('dead') || type.includes('unreachable') || type.includes('constant')) {
      return 'code-structure';
    }
    if (type.includes('base64') || type.includes('hex') || type.includes('url') || type.includes('encode') || type.includes('escape')) {
      return 'encoding';
    }
    if (type.includes('eval') || type.includes('dynamic') || type.includes('function')) {
      return 'dynamic-code';
    }
    if (type.includes('webpack') || type.includes('bundle') || type.includes('rollup') || type.includes('vite')) {
      return 'bundle';
    }
    if (type.includes('anti') || type.includes('debug') || type.includes('self-defend')) {
      return 'anti-analysis';
    }
    if (type.includes('vm') || type.includes('virtual')) return 'vm-protection';

    return 'unknown';
  }

  private updateStageTiming(stageName: string, ms: number): void {
    const existing = this.metrics.stageTimings[stageName];
    if (existing) {
      existing.count++;
      existing.totalMs += ms;
      existing.avgMs = existing.totalMs / existing.count;
    } else {
      this.metrics.stageTimings[stageName] = {
        count: 1,
        totalMs: ms,
        avgMs: ms,
      };
    }
  }

  private createSnapshot(codeLength: number): MetricSnapshot {
    const lastSnapshot = this.metrics.snapshots[this.metrics.snapshots.length - 1];
    const lastStage = this.stageHistory[this.stageHistory.length - 1];

    return {
      timestamp: Date.now(),
      stage: lastStage?.stageName ?? 'unknown',
      codeLength,
      readabilityScore: lastStage?.readabilityAfter ?? lastSnapshot?.readabilityScore ?? 0,
      obfuscationTypes: [],
      detectionCounts: this.countDetections(),
    };
  }

  private countDetections(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const stage of this.stageHistory) {
      for (const detection of stage.detections) {
        counts[detection] = (counts[detection] ?? 0) + 1;
      }
    }
    return counts;
  }

  public getMetrics(): DeobfuscationMetrics {
    return { ...this.metrics };
  }

  public getStageHistory(): StageMetrics[] {
    return [...this.stageHistory];
  }

  public getTopObfuscationTypes(limit: number = 5): Array<{ type: string; count: number }> {
    return Object.entries(this.metrics.obfuscationTypeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  public getSlowestStages(limit: number = 5): Array<{ stage: string; avgMs: number }> {
    return Object.entries(this.metrics.stageTimings)
      .map(([stage, timing]) => ({ stage, avgMs: timing.avgMs }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, limit);
  }

  public getCategoryBreakdown(): Record<ObfuscationCategory, number> {
    return { ...this.metrics.categoryCounts };
  }

  public getSuccessRate(): number {
    if (this.metrics.totalRuns === 0) return 0;
    return this.metrics.successfulRuns / this.metrics.totalRuns;
  }

  public reset(): void {
    this.metrics = this.createInitialMetrics();
    this.currentStage = null;
    this.stageHistory = [];
    logger.info('Metrics: reset');
  }

  public getSummary(): string {
    const m = this.metrics;
    return [
      `Deobfuscation Metrics Summary`,
      `═══════════════════════════`,
      `Total runs: ${m.totalRuns} (${m.successfulRuns} success, ${m.failedRuns} failed)`,
      `Success rate: ${(this.getSuccessRate() * 100).toFixed(1)}%`,
      `Average time: ${m.averageTimeMs.toFixed(2)}ms`,
      `Total bytes processed: ${this.formatBytes(m.totalBytesProcessed)}`,
      `Average compression ratio: ${m.averageCompressionRatio.toFixed(3)}`,
      ``,
      `Top obfuscation types:`,
      ...this.getTopObfuscationTypes(3).map(t => `  - ${t.type}: ${t.count}`),
      ``,
      `Slowest stages:`,
      ...this.getSlowestStages(3).map(s => `  - ${s.stage}: ${s.avgMs.toFixed(2)}ms avg`),
      ``,
      `Category breakdown:`,
      ...Object.entries(this.metrics.categoryCounts)
        .filter(([, count]) => count > 0)
        .map(([cat, count]) => `  - ${cat}: ${count}`),
    ].join('\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
}

let globalMetrics: DeobfuscationMetricsCollector | null = null;

export function getGlobalMetrics(): DeobfuscationMetricsCollector {
  if (!globalMetrics) {
    globalMetrics = new DeobfuscationMetricsCollector();
  }
  return globalMetrics;
}

export function resetGlobalMetrics(): void {
  if (globalMetrics) {
    globalMetrics.reset();
  }
  globalMetrics = new DeobfuscationMetricsCollector();
}
