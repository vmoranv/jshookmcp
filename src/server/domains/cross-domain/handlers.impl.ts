import type { MCPServerContext } from '@server/domains/shared/registry';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import { argBool, argString } from '@server/domains/shared/parse-args';
import type { ToolResponse } from '@server/types';
import type { CrossDomainEvidenceBridge } from './handlers/evidence-graph-bridge';
import { correlateSkiaToJS } from './handlers/skia-correlator';
import type { SkiaSceneTree, JSObjectDescriptor } from './handlers/skia-correlator';
import { correlateMojoToCDP } from './handlers/mojo-cdp-correlator';
import type { MojoMessage, CDPEvent, NetworkRequest } from './handlers/mojo-cdp-correlator';
import { correlateSyscallToJS } from './handlers/syscall-js-correlator';
import type { SyscallEvent, JSStack, JSStackFrame } from './handlers/syscall-js-correlator';
import { buildBinaryToJSPipeline } from './handlers/binary-to-js-pipeline';
import type { GhidraOutput, GhidraFunction } from './handlers/binary-to-js-pipeline';
import { WORKFLOWS, type CrossDomainWorkflowDefinition } from './workflows/missions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function extractSkiaSceneTree(value: unknown): SkiaSceneTree {
  if (!isRecord(value)) {
    return { layers: [], drawCommands: [] };
  }
  const layers: SkiaSceneTree['layers'] = Array.isArray(value['layers']) ? value['layers'] : [];
  const drawCommands: SkiaSceneTree['drawCommands'] = Array.isArray(value['drawCommands'])
    ? value['drawCommands']
    : [];
  return { layers, drawCommands };
}

function extractJSObjectArray(value: unknown): JSObjectDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(
    (item): JSObjectDescriptor => ({
      objectId: typeof item['objectId'] === 'string' ? item['objectId'] : '',
      className: typeof item['className'] === 'string' ? item['className'] : '',
      name: typeof item['name'] === 'string' ? item['name'] : '',
      stringProps: Array.isArray(item['stringProps'])
        ? item['stringProps'].filter((s): s is string => typeof s === 'string')
        : [],
      numericProps: isRecord(item['numericProps'])
        ? Object.fromEntries(
            Object.entries(item['numericProps'] as Record<string, unknown>).filter(
              (entry): entry is [string, number] => typeof entry[1] === 'number',
            ),
          )
        : {},
      colorProps: Array.isArray(item['colorProps'])
        ? item['colorProps'].filter((s): s is string => typeof s === 'string')
        : [],
      urlProps: Array.isArray(item['urlProps'])
        ? item['urlProps'].filter((s): s is string => typeof s === 'string')
        : [],
    }),
  );
}

function extractMojoMessages(value: unknown): MojoMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(
    (item): MojoMessage => ({
      interface: typeof item['interface'] === 'string' ? item['interface'] : '',
      method: typeof item['method'] === 'string' ? item['method'] : '',
      timestamp: typeof item['timestamp'] === 'number' ? item['timestamp'] : 0,
      messageId: typeof item['messageId'] === 'string' ? item['messageId'] : '',
    }),
  );
}

function extractCDPEvents(value: unknown): CDPEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(
    (item): CDPEvent => ({
      eventType: typeof item['eventType'] === 'string' ? item['eventType'] : '',
      timestamp: typeof item['timestamp'] === 'number' ? item['timestamp'] : 0,
      url: typeof item['url'] === 'string' ? item['url'] : undefined,
    }),
  );
}

function extractNetworkRequests(value: unknown): NetworkRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(
    (item): NetworkRequest => ({
      requestId: typeof item['requestId'] === 'string' ? item['requestId'] : '',
      url: typeof item['url'] === 'string' ? item['url'] : '',
      timestamp: typeof item['timestamp'] === 'number' ? item['timestamp'] : 0,
    }),
  );
}

function extractSyscallEvents(value: unknown): SyscallEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(
    (item): SyscallEvent => ({
      pid: typeof item['pid'] === 'number' ? item['pid'] : 0,
      tid: typeof item['tid'] === 'number' ? item['tid'] : 0,
      syscallName: typeof item['syscallName'] === 'string' ? item['syscallName'] : '',
      timestamp: typeof item['timestamp'] === 'number' ? item['timestamp'] : 0,
    }),
  );
}

function extractJSStacks(value: unknown): JSStack[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item): JSStack => {
    const frames: JSStack['frames'] = Array.isArray(item['frames'])
      ? item['frames'].filter(isRecord).map(
          (f): JSStackFrame => ({
            functionName: typeof f['functionName'] === 'string' ? f['functionName'] : '',
          }),
        )
      : [];
    return {
      threadId: typeof item['threadId'] === 'number' ? item['threadId'] : 0,
      timestamp: typeof item['timestamp'] === 'number' ? item['timestamp'] : 0,
      frames,
    };
  });
}

function extractGhidraOutput(value: unknown): GhidraOutput | null {
  if (!isRecord(value)) {
    return null;
  }
  const moduleName = typeof value['moduleName'] === 'string' ? value['moduleName'] : '';
  if (!moduleName) {
    return null;
  }
  const functionsRaw = Array.isArray(value['functions']) ? value['functions'] : [];
  const functions: GhidraOutput['functions'] = functionsRaw.filter(isRecord).map(
    (item): GhidraFunction => ({
      name: typeof item['name'] === 'string' ? item['name'] : '',
      moduleName: typeof item['moduleName'] === 'string' ? item['moduleName'] : '',
      address: typeof item['address'] === 'string' ? item['address'] : undefined,
      calledFrom: Array.isArray(item['calledFrom'])
        ? item['calledFrom'].filter((c): c is string => typeof c === 'string')
        : undefined,
    }),
  );
  return { functions, moduleName };
}

const V5_DOMAIN_NAMES = [
  'analysis',
  'browser',
  'network',
  'canvas',
  'skia-capture',
  'v8-inspector',
  'mojo-ipc',
  'syscall-hook',
  'binary-instrument',
  'boringssl-inspector',
  'evidence',
];

export class CrossDomainWorkflowClassifier {
  constructor(
    private readonly ctx: MCPServerContext,
    private readonly evidenceBridgeReady: boolean,
  ) {}

  getCapabilities(): {
    availableDomains: string[];
    missingDomains: string[];
    supportedDomains: string[];
    workflows: Array<{
      workflowKey: string;
      id: string;
      displayName: string;
      stepCount: number;
      requiredDomains: string[];
      availableDomains: string[];
      missingDomains: string[];
      coverage: number;
    }>;
  } {
    const availableDomains = this.getAvailableDomains();
    const missingDomains = V5_DOMAIN_NAMES.filter((d) => !availableDomains.includes(d));

    const workflows = Object.entries(WORKFLOWS).map(([workflowKey, workflow]) => {
      const evaluation = this.evaluateWorkflow(workflow);
      return {
        workflowKey,
        id: workflow.id,
        displayName: workflow.displayName,
        stepCount: workflow.steps.length,
        ...evaluation,
      };
    });

    return { availableDomains, missingDomains, supportedDomains: [...V5_DOMAIN_NAMES], workflows };
  }

  suggestWorkflow(
    goal: string,
    preferAvailableOnly: boolean,
  ): {
    workflowKey: string;
    id: string;
    displayName: string;
    reason: string;
    requiredDomains: string[];
    availableDomains: string[];
    missingDomains: string[];
    coverage: number;
  } {
    const normalizedGoal = goal.toLowerCase();
    const scored = Object.entries(WORKFLOWS).map(([workflowKey, workflow]) => {
      const keywordScore = this.scoreWorkflowGoal(normalizedGoal, workflowKey, workflow);
      const evaluation = this.evaluateWorkflow(workflow);
      return { workflowKey, workflow, keywordScore, evaluation };
    });

    const candidates = preferAvailableOnly
      ? scored.filter((item) => item.evaluation.missingDomains.length === 0)
      : scored;

    const rankedPool = candidates.length > 0 ? candidates : scored;
    rankedPool.sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) {
        return b.keywordScore - a.keywordScore;
      }
      return b.evaluation.coverage - a.evaluation.coverage;
    });

    const selected = rankedPool[0];
    if (!selected) {
      throw new Error('No workflow definitions are available for cross-domain suggestion');
    }
    const reason = this.describeWorkflowReason(normalizedGoal, selected.evaluation);

    return {
      workflowKey: selected.workflowKey,
      id: selected.workflow.id,
      displayName: selected.workflow.displayName,
      reason,
      ...selected.evaluation,
    };
  }

  getHealth(): {
    evidenceBridgeReady: boolean;
    orchestratorReady: boolean;
    availableDomains: string[];
    missingDomains: string[];
  } {
    const availableDomains = this.getAvailableDomains();
    return {
      evidenceBridgeReady: this.evidenceBridgeReady,
      orchestratorReady: true,
      availableDomains,
      missingDomains: V5_DOMAIN_NAMES.filter((d) => !availableDomains.includes(d)),
    };
  }

  private getAvailableDomains(): string[] {
    const currentEnabledDomains =
      this.ctx.enabledDomains.size > 0
        ? this.ctx.enabledDomains
        : this.ctx.resolveEnabledDomains(this.ctx.selectedTools);

    const available: string[] = [];
    for (const d of V5_DOMAIN_NAMES) {
      if (currentEnabledDomains.has(d)) {
        available.push(d);
      }
    }
    return available;
  }

  private evaluateWorkflow(workflow: CrossDomainWorkflowDefinition): {
    requiredDomains: string[];
    availableDomains: string[];
    missingDomains: string[];
    coverage: number;
  } {
    const requiredSet = new Set<string>();
    for (const step of workflow.steps) {
      for (const d of this.inferDomainsForTool(step.tool)) {
        requiredSet.add(d);
      }
    }
    const requiredDomains = [...requiredSet];
    const available = this.getAvailableDomains().filter((d) => requiredSet.has(d));
    const missing = requiredDomains.filter((d) => !available.includes(d));
    const coverage = requiredDomains.length === 0 ? 1 : available.length / requiredDomains.length;
    return { requiredDomains, availableDomains: available, missingDomains: missing, coverage };
  }

  private inferDomainsForTool(toolName: string): string[] {
    if (toolName.startsWith('deobfuscate') || toolName.startsWith('advanced_deobfuscate')) {
      return ['analysis'];
    }
    if (toolName.startsWith('js_heap') || toolName.startsWith('performance_take_heap_snapshot')) {
      return ['v8-inspector'];
    }
    if (toolName.startsWith('network_')) return ['network'];
    if (toolName.startsWith('console_')) return ['browser'];
    if (toolName.startsWith('tls_') || toolName.startsWith('net_raw_')) return ['boringssl-inspector'];
    if (toolName.startsWith('canvas_')) return ['canvas'];
    if (toolName.startsWith('skia_')) return ['skia-capture'];
    if (toolName.startsWith('v8_')) return ['v8-inspector'];
    if (toolName.startsWith('mojo_')) return ['mojo-ipc'];
    if (toolName.startsWith('syscall_')) return ['syscall-hook'];
    if (toolName.startsWith('adb_')) return ['adb-bridge'];
    if (
      toolName.startsWith('ghidra_') ||
      toolName.startsWith('frida_') ||
      toolName.startsWith('generate_hooks') ||
      toolName.startsWith('unidbg_') ||
      toolName.startsWith('export_hook_script')
    ) {
      return ['binary-instrument'];
    }
    if (toolName.startsWith('extension_') || toolName.startsWith('webhook_')) {
      return ['extension-registry'];
    }
    if (toolName.startsWith('cross_domain_')) {
      return ['cross-domain'];
    }
    if (toolName.startsWith('evidence_')) {
      return ['evidence'];
    }
    if (toolName.startsWith('boringssl_')) {
      return ['boringssl-inspector'];
    }
    return [];
  }

  private scoreWorkflowGoal(
    normalizedGoal: string,
    workflowKey: string,
    workflow: CrossDomainWorkflowDefinition,
  ): number {
    let score = 0;
    if (workflowKey === 'WORKFLOW_REVERSE_OBFUSCATED') {
      if (normalizedGoal.includes('obfus') || normalizedGoal.includes('api')) score += 3;
      if (normalizedGoal.includes('tls') || normalizedGoal.includes('pin')) score += 2;
    }
    if (workflowKey === 'WORKFLOW_GAME_CANVAS_SKIA') {
      if (normalizedGoal.includes('canvas') || normalizedGoal.includes('game')) score += 3;
      if (normalizedGoal.includes('skia') || normalizedGoal.includes('scene')) score += 2;
    }
    if (workflowKey === 'WORKFLOW_BINARY_NATIVE_HOOK') {
      if (normalizedGoal.includes('binary') || normalizedGoal.includes('native')) score += 3;
      if (normalizedGoal.includes('hook') || normalizedGoal.includes('frida')) score += 2;
    }
    if (score === 0 && workflow.displayName.toLowerCase().includes(normalizedGoal)) {
      score += 1;
    }
    return score;
  }

  private describeWorkflowReason(
    normalizedGoal: string,
    evaluation: { missingDomains: string[]; coverage: number },
  ): string {
    if (evaluation.missingDomains.length === 0) {
      return `Matched goal "${normalizedGoal}" and all required domains are enabled.`;
    }
    return `Matched goal "${normalizedGoal}" with ${Math.round(evaluation.coverage * 100)}% domain coverage. Missing: ${evaluation.missingDomains.join(', ')}.`;
  }
}

export class CrossDomainHandlers {
  constructor(
    private readonly evidenceBridge: CrossDomainEvidenceBridge,
    private readonly workflowClassifier?: CrossDomainWorkflowClassifier,
  ) {}

  async handleCapabilities(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const capabilities = {
        evidenceGraphAvailable: true,
        workflowClassifierAvailable: this.workflowClassifier !== undefined,
      };
      if (this.workflowClassifier) {
        return asJsonResponse({
          capabilities,
          ...this.workflowClassifier.getCapabilities(),
        });
      }
      return asJsonResponse({ capabilities });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleSuggestWorkflow(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const query = argString(args, 'query', '') || argString(args, 'goal', '');
      const preferAvailableOnly = argBool(args, 'preferAvailableOnly', true);
      if (this.workflowClassifier && query) {
        return asJsonResponse(this.workflowClassifier.suggestWorkflow(query, preferAvailableOnly));
      }
      return asJsonResponse({
        message: 'Cross-domain workflow suggestion requires a classifier and query.',
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleHealth(): Promise<ToolResponse> {
    try {
      const stats = this.evidenceBridge.getStats();
      if (this.workflowClassifier) {
        const health = this.workflowClassifier.getHealth();
        return asJsonResponse({ ...health, evidenceGraph: stats });
      }
      return asJsonResponse({
        evidenceBridgeReady: true,
        orchestratorReady: false,
        evidenceGraph: stats,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleCorrelateAll(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const errors: string[] = [];
      const results: Record<string, unknown> = {};

      // SKIA-03
      try {
        const sceneTree = extractSkiaSceneTree(args['sceneTree']);
        const jsObjects = extractJSObjectArray(args['jsObjects']);
        results['skia'] = correlateSkiaToJS(this.evidenceBridge, { sceneTree, jsObjects });
      } catch (e) {
        errors.push(`SKIA-03: ${e instanceof Error ? e.message : String(e)}`);
      }

      // MOJO-03
      try {
        const mojoMessages = extractMojoMessages(args['mojoMessages']);
        const cdpEvents = extractCDPEvents(args['cdpEvents']);
        const networkRequests = extractNetworkRequests(args['networkRequests']);
        results['mojo'] = correlateMojoToCDP(
          this.evidenceBridge,
          mojoMessages,
          cdpEvents,
          networkRequests,
        );
      } catch (e) {
        errors.push(`MOJO-03: ${e instanceof Error ? e.message : String(e)}`);
      }

      // SYSCALL-02
      try {
        const syscallEvents = extractSyscallEvents(args['syscallEvents']);
        const jsStacks = extractJSStacks(args['jsStacks']);
        results['syscall'] = correlateSyscallToJS(this.evidenceBridge, syscallEvents, jsStacks);
      } catch (e) {
        errors.push(`SYSCALL-02: ${e instanceof Error ? e.message : String(e)}`);
      }

      // BIN-04
      try {
        const ghidraOutput = extractGhidraOutput(args['ghidraOutput']);
        if (ghidraOutput) {
          results['binary'] = buildBinaryToJSPipeline(this.evidenceBridge, ghidraOutput);
        }
      } catch (e) {
        errors.push(`BIN-04: ${e instanceof Error ? e.message : String(e)}`);
      }

      const snapshot = this.evidenceBridge.exportGraph();

      return asJsonResponse({
        correlationResults: { ...results, errors },
        evidenceGraph: snapshot,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleEvidenceExport(): Promise<ToolResponse> {
    try {
      return asJsonResponse(this.evidenceBridge.exportGraph());
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleEvidenceStats(): Promise<ToolResponse> {
    try {
      return asJsonResponse(this.evidenceBridge.getStats());
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }
}
