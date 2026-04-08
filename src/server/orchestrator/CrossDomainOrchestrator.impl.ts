import type { MCPServerContext } from '@server/MCPServer.context';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function collectTokens(value: unknown, tokens: Set<string>): void {
  if (typeof value === 'string') {
    for (const part of value.toLowerCase().split(/[^a-z0-9_:/.-]+/i)) {
      if (part) {
        tokens.add(part);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTokens(item, tokens);
    }
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      collectTokens(entry, tokens);
    }
  }
}

export interface StepResult {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  duration: number;
  error?: string;
}

export interface ExecutionRecord {
  workflowId: string;
  startedAt: string;
  totalDuration: number;
  status: 'success' | 'failed' | 'missing';
  evidenceNodes: string[];
}

interface PlannedStep {
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

interface SequencePlan {
  workflowId: string;
  sequence: PlannedStep[];
  prerequisites: Array<{ condition: string; fix: string }>;
  estimatedDuration: number;
}

interface SequenceExecutionResult {
  toolName: string;
  status: 'success' | 'failed';
  output?: unknown;
  error?: string;
  duration: number;
}

interface WorkflowDefinition {
  id: string;
  aliases: string[];
  steps: PlannedStep[];
  evidenceNodes: string[];
}

export interface CrossDomainOrchestratorConfig {
  timeoutPerStep?: number;
  maxRetries?: number;
}

interface MinimalOrchestratorContext {
  executeToolWithTracking: MCPServerContext['executeToolWithTracking'];
  pageController?: unknown;
  workerPool?: unknown;
  debuggerManager?: {
    isEnabled?: () => boolean;
  };
  evidenceHandlers?: unknown;
}

export class CrossDomainOrchestratorImpl {
  private readonly config: Required<CrossDomainOrchestratorConfig>;
  private readonly executionHistory: ExecutionRecord[] = [];
  private readonly workflowDefinitions = new Map<string, WorkflowDefinition>();
  private initialized = false;

  constructor(
    private readonly context: MinimalOrchestratorContext,
    config: CrossDomainOrchestratorConfig = {},
  ) {
    this.config = {
      timeoutPerStep: typeof config.timeoutPerStep === 'number' ? config.timeoutPerStep : 10_000,
      maxRetries: typeof config.maxRetries === 'number' ? config.maxRetries : 1,
    };
    this.registerDefaultDefinitions();
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  getCapabilityFlags(): {
    v8BytecodeAvailable: boolean;
    workerPoolAvailable: boolean;
    debuggerEnabled: boolean;
  } {
    return {
      v8BytecodeAvailable: this.context.pageController !== undefined,
      workerPoolAvailable:
        this.context.workerPool !== null && this.context.workerPool !== undefined,
      debuggerEnabled: this.context.debuggerManager?.isEnabled?.() === true,
    };
  }

  planSequence(toolName: string, input: Record<string, unknown>): SequencePlan {
    const definition = this.workflowDefinitions.get(toolName);
    if (definition) {
      return {
        workflowId: definition.id,
        sequence: definition.steps.map((step) => ({
          ...step,
          input: { ...step.input, ...input },
        })),
        prerequisites: this.buildPrerequisites(definition.id),
        estimatedDuration: definition.steps.length * this.config.timeoutPerStep,
      };
    }

    return {
      workflowId: toolName,
      sequence: [
        {
          toolName,
          input,
          description: `Direct execution for ${toolName}`,
        },
      ],
      prerequisites: [],
      estimatedDuration: this.config.timeoutPerStep,
    };
  }

  suggestWorkflow(query: string): { workflowId: string; reason: string } | null {
    const normalized = query.toLowerCase();
    if (normalized.includes('heap') || normalized.includes('memory')) {
      return {
        workflowId: 'v8_heap_snapshot_capture',
        reason: 'Matched heap and memory workflow heuristics',
      };
    }
    return null;
  }

  async executeSequence(
    plan: SequencePlan,
    input: Record<string, unknown>,
  ): Promise<SequenceExecutionResult[]> {
    const results: SequenceExecutionResult[] = [];

    for (const step of plan.sequence) {
      const startedAt = Date.now();
      let attempts = 0;
      let completed = false;

      while (!completed && attempts <= this.config.maxRetries) {
        attempts += 1;
        try {
          const output = await this.context.executeToolWithTracking(step.toolName, {
            ...step.input,
            ...input,
          });

          results.push({
            toolName: step.toolName,
            status: 'success',
            output,
            duration: Date.now() - startedAt,
          });
          completed = true;
        } catch (error) {
          if (attempts > this.config.maxRetries) {
            results.push({
              toolName: step.toolName,
              status: 'failed',
              error: toErrorMessage(error),
              duration: Date.now() - startedAt,
            });
            completed = true;
          }
        }
      }
    }

    return results;
  }

  async executeWorkflow(
    workflowId: string,
    input: Record<string, unknown>,
  ): Promise<{ steps: StepResult[]; totalDuration: number; evidenceNodes: string[] }> {
    await this.init();

    const definition = this.workflowDefinitions.get(workflowId);
    if (!definition) {
      const missingStep: StepResult = {
        toolName: workflowId,
        input,
        output: null,
        duration: 0,
        error: `Workflow definition "${workflowId}" not found`,
      };
      this.executionHistory.unshift({
        workflowId,
        startedAt: new Date().toISOString(),
        totalDuration: 0,
        status: 'missing',
        evidenceNodes: [],
      });
      return {
        steps: [missingStep],
        totalDuration: 0,
        evidenceNodes: [],
      };
    }

    const startedAt = Date.now();
    const sequence = this.planSequence(workflowId, input);
    const sequenceResults = await this.executeSequence(sequence, input);
    const steps: StepResult[] = sequenceResults.map((result, index) => ({
      toolName: result.toolName,
      input: sequence.sequence[index]?.input ?? {},
      output: result.output ?? null,
      duration: result.duration,
      error: result.error,
    }));
    const totalDuration = Date.now() - startedAt;
    const hasFailure = steps.some(
      (step) => typeof step.error === 'string' && step.error.length > 0,
    );

    this.executionHistory.unshift({
      workflowId,
      startedAt: new Date(startedAt).toISOString(),
      totalDuration,
      status: hasFailure ? 'failed' : 'success',
      evidenceNodes: [...definition.evidenceNodes],
    });

    return {
      steps,
      totalDuration,
      evidenceNodes: [...definition.evidenceNodes],
    };
  }

  async correlateDomains(
    evidenceA: unknown,
    evidenceB: unknown,
  ): Promise<{ score: number; reasoning: string }> {
    const left = new Set<string>();
    const right = new Set<string>();

    collectTokens(evidenceA, left);
    collectTokens(evidenceB, right);

    if (left.size === 0 && right.size === 0) {
      return {
        score: 0,
        reasoning: 'No comparable evidence tokens were extracted from either side',
      };
    }

    let intersection = 0;
    for (const token of left) {
      if (right.has(token)) {
        intersection += 1;
      }
    }

    const union = new Set<string>([...left, ...right]).size;
    const score = union === 0 ? 0 : Number((intersection / union).toFixed(2));
    return {
      score,
      reasoning: `Matched ${intersection} shared evidence tokens across ${union} unique tokens`,
    };
  }

  getExecutionHistory(limit?: number): ExecutionRecord[] {
    if (typeof limit === 'number' && limit >= 0) {
      return this.executionHistory.slice(0, limit);
    }
    return [...this.executionHistory];
  }

  healthCheck(): 'healthy' | 'degraded' {
    const flags = this.getCapabilityFlags();
    if (!flags.v8BytecodeAvailable || !flags.workerPoolAvailable) {
      return 'degraded';
    }
    return 'healthy';
  }

  private buildPrerequisites(workflowId: string): Array<{ condition: string; fix: string }> {
    if (workflowId === 'v8_heap_snapshot_capture') {
      return [
        {
          condition: 'pageController must be available',
          fix: 'Load the browser domain before executing heap workflows',
        },
      ];
    }
    return [];
  }

  private registerDefaultDefinitions(): void {
    const heapWorkflow: WorkflowDefinition = {
      id: 'v8_heap_snapshot_capture',
      aliases: ['heap snapshot', 'memory leak'],
      steps: [
        {
          toolName: 'v8_heap_snapshot_capture',
          input: {},
          description: 'Capture a V8 heap snapshot',
        },
      ],
      evidenceNodes: ['request', 'script', 'captured-data'],
    };

    this.workflowDefinitions.set(heapWorkflow.id, heapWorkflow);
  }
}

export class CrossDomainOrchestrator extends CrossDomainOrchestratorImpl {}
