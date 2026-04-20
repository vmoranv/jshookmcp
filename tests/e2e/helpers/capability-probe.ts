/**
 * Capability probes for E2E test framework.
 * Determines which capabilities are available before running tools.
 */

import type { ToolResult } from '@tests/e2e/helpers/types';

interface CapabilityState {
  browserLaunch: boolean;
  pageNavigate: boolean;
  debuggerEnabled: boolean;
  debuggerPaused: boolean;
  networkCapture: boolean;
  wasmArtifactPath: string | null;
  graphQLEndpoint: boolean;
  sourceMapAvailable: boolean;
  workflowId: string | null;
}

const state: CapabilityState = {
  browserLaunch: false,
  pageNavigate: false,
  debuggerEnabled: false,
  debuggerPaused: false,
  networkCapture: false,
  wasmArtifactPath: null,
  graphQLEndpoint: false,
  sourceMapAvailable: false,
  workflowId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPass(result: ToolResult): boolean {
  return result.status === 'PASS' || result.ok === true;
}

export function resetCapabilityProbes(): void {
  state.browserLaunch = false;
  state.pageNavigate = false;
  state.debuggerEnabled = false;
  state.debuggerPaused = false;
  state.networkCapture = false;
  state.wasmArtifactPath = null;
  state.graphQLEndpoint = false;
  state.sourceMapAvailable = false;
  state.workflowId = null;
}

export function recordCapabilityObservation(
  name: string,
  parsed: unknown,
  result: ToolResult,
): void {
  if (name === 'browser_launch' && isPass(result)) state.browserLaunch = true;
  if (name === 'page_navigate' && isPass(result)) state.pageNavigate = true;
  if (name === 'debugger_lifecycle' && isPass(result)) state.debuggerEnabled = true;
  if (name === 'debugger_wait_for_paused' && isPass(result)) state.debuggerPaused = true;

  if (name === 'debugger_get_paused_state' && isRecord(parsed) && parsed.paused === true) {
    state.debuggerPaused = true;
  }

  if (
    name === 'network_get_requests' &&
    isRecord(parsed) &&
    Array.isArray(parsed.requests) &&
    parsed.requests.length > 0
  ) {
    state.networkCapture = true;
  }

  if (
    name === 'web_api_capture_session' &&
    isRecord(parsed) &&
    isRecord(parsed.networkSummary) &&
    Array.isArray(parsed.networkSummary.requests) &&
    (parsed.networkSummary.requests as unknown[]).length > 0
  ) {
    state.networkCapture = true;
  }

  if (name === 'wasm_dump' && isRecord(parsed) && typeof parsed.artifactPath === 'string') {
    state.wasmArtifactPath = parsed.artifactPath.includes('(binary not available')
      ? null
      : parsed.artifactPath;
  }

  if (name === 'graphql_introspect' && isRecord(parsed) && parsed.success === true) {
    state.graphQLEndpoint = true;
  }

  if (name === 'sourcemap_discover' && Array.isArray(parsed) && parsed.length > 0) {
    state.sourceMapAvailable = true;
  }

  if (
    name === 'list_extension_workflows' &&
    isRecord(parsed) &&
    Array.isArray(parsed.workflows) &&
    parsed.workflows.length > 0
  ) {
    const first = parsed.workflows[0];
    if (isRecord(first) && typeof first.id === 'string' && first.id.length > 0) {
      state.workflowId = first.id;
    }
  }
}

// Probe functions
export function probeBrowserPage(): boolean {
  return state.browserLaunch && state.pageNavigate;
}
export function probeDebuggerEnabled(): boolean {
  return state.debuggerEnabled;
}
export function probeDebuggerPaused(): boolean {
  return state.debuggerPaused;
}
export function probeNetworkCapture(): boolean {
  return state.networkCapture;
}
export function probeWasmFixture(): boolean {
  return state.wasmArtifactPath !== null;
}
export function probeGraphQLEndpoint(): boolean {
  return state.graphQLEndpoint;
}
export function probeSourceMapAvailable(): boolean {
  return state.sourceMapAvailable;
}
export function probeExtensionRegistry(): boolean {
  return state.workflowId !== null;
}
export function getObservedWasmArtifactPath(): string | null {
  return state.wasmArtifactPath;
}
export function getObservedWorkflowId(): string | null {
  return state.workflowId;
}
