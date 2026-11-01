import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { getArtifactDir } from '@utils/artifacts';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import type {
  ReverseSessionExecutedStep,
  ReverseSessionRecord,
  ReverseSessionRunRecord,
  ReverseSessionStep,
  ReverseSessionTarget,
} from './types';
import { ReverseSessionStore } from './ReverseSessionStore';

export interface CreateReverseSessionInput {
  platform?: string;
  packageName?: string;
  apkPath?: string;
  pid?: number;
  artifactRoot?: string;
}

export interface RunReverseSessionInput {
  sessionId: string;
  maxSteps?: number;
  stopOnError?: boolean;
  includeResults?: boolean;
}

export interface ReverseSessionRunResult {
  success: boolean;
  reason?: string;
  session?: ReverseSessionRecord;
  run?: ReverseSessionRunRecord;
}

export type ReverseSessionToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

interface ParsedToolResult {
  body: unknown;
  isError: boolean;
  text?: string;
}

export class ReverseSessionOrchestrator {
  private readonly store: ReverseSessionStore;
  private readonly toolExecutor?: ReverseSessionToolExecutor;
  constructor(store = new ReverseSessionStore(), toolExecutor?: ReverseSessionToolExecutor) {
    this.store = store;
    this.toolExecutor = toolExecutor;
  }

  create(input: CreateReverseSessionInput): ReverseSessionRecord {
    const target = normalizeTarget(input);
    const artifactRoot = input.artifactRoot ?? getArtifactDir('sessions');
    const steps = buildPlan(target, artifactRoot);
    return this.store.create({
      artifactRoot,
      target,
      steps,
      nextSteps: steps.map((step) => `${step.id}: ${step.tool}`),
    });
  }

  status(sessionId: string): ReverseSessionRecord | undefined {
    return this.store.get(sessionId);
  }

  list(): ReverseSessionRecord[] {
    return this.store.list();
  }

  plan(input: CreateReverseSessionInput): {
    target: ReverseSessionTarget;
    artifactRoot: string;
    steps: ReverseSessionStep[];
    nextSteps: string[];
  } {
    const target = normalizeTarget(input);
    const artifactRoot = input.artifactRoot ?? getArtifactDir('sessions');
    const steps = buildPlan(target, artifactRoot);
    return {
      target,
      artifactRoot,
      steps,
      nextSteps: steps.map((step) => `${step.id}: ${step.tool}`),
    };
  }

  async run(input: RunReverseSessionInput): Promise<ReverseSessionRunResult> {
    const session = this.store.get(input.sessionId);
    if (!session) {
      return {
        success: false,
        reason: `Unknown reverse session: ${input.sessionId}`,
      };
    }

    const executableSteps = session.steps.filter(isExecutableStep);
    if (executableSteps.length === 0) {
      return this.finishWithoutExecutableSteps(session);
    }

    if (!this.toolExecutor) {
      return {
        success: false,
        reason: 'No tool executor is configured for reverse-session run.',
        session,
      };
    }

    const maxSteps = clampRunLimit(input.maxSteps ?? executableSteps.length);
    const stopOnError = input.stopOnError ?? true;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const executedSteps: ReverseSessionExecutedStep[] = [];
    const evidenceRefs: string[] = [];
    session.status = 'active';

    for (const step of session.steps) {
      if (executedSteps.length >= maxSteps) break;
      if (!isExecutableStep(step)) continue;

      const outcome = await this.executeOneStep(session, step, {
        runId,
        includeResults: input.includeResults === true,
        evidenceRefs,
      });
      executedSteps.push(outcome);
      if (!outcome.success && stopOnError) break;
    }

    const blockedSteps = session.steps.filter((step) => step.status === 'blocked');
    const run = createRunRecord({
      runId,
      startedAt,
      status: classifyRunStatus(session.steps, executedSteps),
      executedSteps,
      blockedSteps,
      evidenceRefs,
    });
    session.runs.push(run);
    updateSessionStatus(session);
    this.store.touch(session);
    return {
      success: run.status !== 'failed' && executedSteps.length > 0,
      session,
      run,
      ...(run.status === 'failed' ? { reason: latestFailure(executedSteps) } : {}),
    };
  }
  /** No executable steps remain: record a terminal run and report it. */
  private finishWithoutExecutableSteps(session: ReverseSessionRecord): ReverseSessionRunResult {
    const hasBlocked = session.steps.some((step) => step.status === 'blocked');
    const run = createRunRecord({
      status: hasBlocked ? 'blocked' : 'completed',
      executedSteps: [],
      blockedSteps: session.steps.filter((step) => step.status === 'blocked'),
      evidenceRefs: [],
      reason: hasBlocked
        ? 'No executable steps are available because remaining steps are blocked.'
        : 'All executable steps are already completed.',
    });
    session.runs.push(run);
    updateSessionStatus(session);
    this.store.touch(session);
    return { success: run.status === 'completed', session, run, reason: run.reason };
  }

  /** Execute one step, updating the step record and collecting evidence. */
  private async executeOneStep(
    session: ReverseSessionRecord,
    step: ReverseSessionStep,
    ctx: { runId: string; includeResults: boolean; evidenceRefs: string[] },
  ): Promise<ReverseSessionExecutedStep> {
    const stepStartedAt = Date.now();
    step.status = 'running';
    step.lastRunAt = new Date().toISOString();
    step.attempts = (step.attempts ?? 0) + 1;
    delete step.error;
    this.store.touch(session);

    try {
      const rawResult = await this.toolExecutor!(step.tool, step.args);
      const parsedResult = parseToolResult(rawResult);
      const body = parsedResult.body;
      const success = isSuccessfulToolResult(parsedResult);
      const durationMs = Date.now() - stepStartedAt;
      const evidenceRef = success ? buildEvidenceRef(ctx.runId, step, body) : undefined;
      if (success) {
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        if (evidenceRef) {
          step.resultRef = evidenceRef;
          ctx.evidenceRefs.push(evidenceRef);
          session.evidenceRefs.push(evidenceRef);
        }
        await promoteBlockedStepsFromResult(session, body);
      } else {
        step.status = 'failed';
        step.error =
          extractToolError(body) ?? parsedResult.text ?? 'Tool returned an unsuccessful result.';
      }
      this.store.touch(session);
      return {
        stepId: step.id,
        tool: step.tool,
        success,
        durationMs,
        ...(evidenceRef ? { evidenceRef } : {}),
        ...(step.error ? { error: step.error } : {}),
        ...(ctx.includeResults ? { result: body } : {}),
      };
    } catch (error) {
      const durationMs = Date.now() - stepStartedAt;
      const message = error instanceof Error ? error.message : String(error);
      step.status = 'failed';
      step.error = message;
      this.store.touch(session);
      return {
        stepId: step.id,
        tool: step.tool,
        success: false,
        durationMs,
        error: message,
      };
    }
  }
}

function normalizeTarget(input: CreateReverseSessionInput): ReverseSessionTarget {
  const platform =
    input.platform === 'android' || input.platform === 'native' || input.platform === 'web'
      ? input.platform
      : input.packageName || input.apkPath
        ? 'android'
        : 'unknown';
  return {
    platform,
    ...(input.packageName ? { packageName: input.packageName } : {}),
    ...(input.apkPath ? { apkPath: input.apkPath } : {}),
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
  };
}

function buildPlan(target: ReverseSessionTarget, artifactRoot: string): ReverseSessionStep[] {
  const steps: ReverseSessionStep[] = [];
  if (target.apkPath) {
    steps.push({
      id: 'apk-intake',
      tool: 'apk_dex_intake',
      args: { apkPath: target.apkPath },
      status: 'ready',
    });
  } else {
    steps.push({
      id: 'apk-intake',
      tool: 'apk_dex_intake',
      args: {},
      status: 'blocked',
      reason: 'apkPath is required for local APK/DEX intake.',
    });
  }

  if (target.packageName || target.pid !== undefined) {
    const outputDir = `${artifactRoot.replace(/\\/g, '/')}/android-runtime-dump`;
    steps.push({
      id: 'frida-dex-dump',
      tool: 'frida_dex_dump',
      args: {
        outputDir,
        ...(target.packageName ? { target: target.packageName } : {}),
        ...(target.pid !== undefined ? { pid: target.pid } : {}),
      },
      status: 'planned',
    });
    steps.push({
      id: 'runtime-dump-session',
      tool: 'android_runtime_dump_session',
      args: {
        action: 'start',
        outputDir,
        ...(target.packageName ? { packageName: target.packageName } : {}),
        ...(target.pid !== undefined ? { pid: target.pid } : {}),
      },
      status: 'planned',
    });
  }

  steps.push({
    id: 'transform-workbench',
    tool: 'transform_workbench',
    args: {},
    status: 'blocked',
    reason: 'Select a dumped artifact and provide inputBase64 plus transform steps.',
  });
  return steps;
}

function isExecutableStep(step: ReverseSessionStep): boolean {
  return step.status === 'ready' || step.status === 'planned';
}

function clampRunLimit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(
    1,
    Math.min(Math.floor(value), getReverseEngineeringConfig().reverseSession.runMaxSteps),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolResult(result: unknown): ParsedToolResult {
  if (!isRecord(result)) return { body: result, isError: false };
  const content = result['content'];
  const isError = result['isError'] === true;
  if (!Array.isArray(content)) return { body: result, isError };
  const firstText = content
    .map((entry) => (isRecord(entry) && typeof entry['text'] === 'string' ? entry['text'] : ''))
    .find((text) => text.length > 0);
  if (!firstText) return { body: result, isError };
  try {
    return { body: JSON.parse(firstText) as unknown, isError, text: firstText };
  } catch {
    return { body: firstText, isError, text: firstText };
  }
}

function isSuccessfulToolResult(result: ParsedToolResult): boolean {
  if (result.isError) return false;
  const body = result.body;
  if (!isRecord(body)) return true;
  if (body['success'] === false || body['available'] === false) return false;
  if (typeof body['error'] === 'string' && body['success'] !== true) return false;
  return true;
}

function extractToolError(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = body['error'] ?? body['reason'];
  return typeof error === 'string' ? error : undefined;
}

function buildEvidenceRef(runId: string, step: ReverseSessionStep, body: unknown): string {
  const marker = evidenceMarker(body);
  return marker ? `${runId}/${step.id}/${step.tool}/${marker}` : `${runId}/${step.id}/${step.tool}`;
}

function evidenceMarker(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const artifact = body['artifact'];
  if (isRecord(artifact) && typeof artifact['kind'] === 'string') {
    return safeRefSegment(artifact['kind']);
  }
  for (const key of ['artifactPath', 'outputDir', 'sessionId', 'dumpedFiles']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return safeRefSegment(value);
    }
    if (Array.isArray(value)) {
      return safeRefSegment(`${key}-${value.length}`);
    }
  }
  return undefined;
}

async function promoteBlockedStepsFromResult(
  session: ReverseSessionRecord,
  body: unknown,
): Promise<void> {
  const transformStep = session.steps.find(
    (step) => step.id === 'transform-workbench' && step.status === 'blocked',
  );
  if (!transformStep) return;
  const artifactPath = selectDumpedArtifactPath(body);
  if (!artifactPath) return;
  const fileStat = await stat(artifactPath).catch(() => undefined);
  if (!fileStat?.isFile() || fileStat.size === 0) {
    transformStep.reason = `Dumped artifact is not readable: ${artifactPath}`;
    return;
  }
  const config = getReverseEngineeringConfig().reverseSession;
  if (fileStat.size > config.maxInlineTransformInputBytes) {
    transformStep.reason =
      `Dumped artifact is too large for inline transform input: ${artifactPath} ` +
      `(${fileStat.size} bytes > ${config.maxInlineTransformInputBytes} bytes). Provide inputBase64 explicitly.`;
    return;
  }
  const bytes = await readFile(artifactPath).catch(() => undefined);
  if (!bytes || bytes.length === 0) {
    transformStep.reason = `Dumped artifact is not readable: ${artifactPath}`;
    return;
  }
  transformStep.args = {
    inputBase64: bytes.toString('base64'),
    steps: [{ op: 'entropy' }],
    previewBytes: config.promotedTransformPreviewBytes,
    includeOutputBase64: false,
  };
  transformStep.status = 'planned';
  transformStep.reason = `Ready from dumped artifact: ${artifactPath}`;
}

function selectDumpedArtifactPath(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const direct = readArtifactPath(body);
  if (direct) return direct;

  const outputDir = typeof body['outputDir'] === 'string' ? body['outputDir'] : undefined;
  const dumpedFiles = body['dumpedFiles'];
  if (outputDir && Array.isArray(dumpedFiles)) {
    const selected = dumpedFiles.find(
      (entry): entry is string => typeof entry === 'string' && isDexLikePath(entry),
    );
    if (selected) return resolveArtifactPath(outputDir, selected);
  }

  const evidence = body['evidence'];
  if (outputDir && isRecord(evidence)) {
    const dumpedDex = evidence['dumpedDex'];
    if (isRecord(dumpedDex) && Array.isArray(dumpedDex['files'])) {
      for (const entry of dumpedDex['files']) {
        const path = readArtifactPath(entry);
        if (path && isDexLikePath(path)) return resolveArtifactPath(outputDir, path);
      }
    }
  }

  return undefined;
}

function readArtifactPath(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ['artifactPath', 'path', 'filePath']) {
    const path = value[key];
    if (typeof path === 'string' && path.trim().length > 0) return path.trim();
  }
  return undefined;
}

function resolveArtifactPath(outputDir: string, artifactPath: string): string {
  return normalize(isAbsolute(artifactPath) ? artifactPath : join(outputDir, artifactPath));
}

function isDexLikePath(path: string): boolean {
  return /\.(dex|cdex)$/i.test(path);
}

function safeRefSegment(value: string): string {
  return (
    value
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, getReverseEngineeringConfig().reverseSession.evidenceRefSegmentMaxChars) || 'result'
  );
}

function createRunRecord(input: {
  runId?: string;
  startedAt?: string;
  status: ReverseSessionRunRecord['status'];
  executedSteps: ReverseSessionExecutedStep[];
  blockedSteps: ReverseSessionStep[];
  evidenceRefs: string[];
  reason?: string;
}): ReverseSessionRunRecord {
  const now = new Date().toISOString();
  return {
    runId: input.runId ?? randomUUID(),
    startedAt: input.startedAt ?? now,
    finishedAt: now,
    status: input.status,
    executedSteps: input.executedSteps,
    blockedSteps: input.blockedSteps,
    evidenceRefs: input.evidenceRefs,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function classifyRunStatus(
  steps: ReverseSessionStep[],
  executedSteps: ReverseSessionExecutedStep[],
): ReverseSessionRunRecord['status'] {
  if (executedSteps.some((step) => !step.success)) return 'failed';
  if (steps.every((step) => step.status === 'completed') && executedSteps.length > 0) {
    return 'completed';
  }
  if (executedSteps.length === 0 && steps.some((step) => step.status === 'blocked')) {
    return 'blocked';
  }
  return 'partial';
}

function updateSessionStatus(session: ReverseSessionRecord): void {
  const failed = session.steps.some((step) => step.status === 'failed');
  const blocked = session.steps.some((step) => step.status === 'blocked');
  const pending = session.steps.some(
    (step) => step.status === 'ready' || step.status === 'planned',
  );
  if (failed) {
    session.status = 'failed';
  } else if (!blocked && !pending) {
    session.status = 'completed';
  } else if (session.runs.length > 0 || session.evidenceRefs.length > 0) {
    session.status = 'active';
  }
  session.nextSteps = session.steps
    .filter((step) => step.status !== 'completed')
    .map((step) => `${step.id}: ${step.tool}${step.reason ? ` (${step.reason})` : ''}`);
}

function latestFailure(steps: ReverseSessionExecutedStep[]): string | undefined {
  return steps.findLast((step) => !step.success)?.error;
}
