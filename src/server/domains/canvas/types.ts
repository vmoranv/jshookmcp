import type {
  CDPSessionLike,
  DebuggerManager,
  EvidenceStore,
  PageController,
  TraceRecorder,
} from './dependencies';

export type CanvasContextType = '2d' | 'webgl' | 'webgl2' | 'webgpu';
export type CanvasTraceBreakpointType = 'click' | 'mousedown' | 'pointerdown';
export type CanvasDumpCompleteness = 'full' | 'partial';
export type CanvasHitTestMethod = 'engine' | 'manual' | 'none';
export type CanvasNetworkProtocol = 'http' | 'websocket' | 'fetch';

/**
 * Adapter contract for engine-specific canvas probing implementations.
 */
export interface CanvasEngineAdapter {
  readonly id: string;
  readonly engine: string;
  readonly version?: string;
  detect(env: CanvasProbeEnv): Promise<CanvasDetection | null>;
  dumpScene(env: CanvasProbeEnv, opts: DumpOpts): Promise<CanvasSceneDump>;
  pickAt(env: CanvasProbeEnv, opts: PickOpts): Promise<CanvasPickResult>;
  traceClick?(
    env: CanvasProbeEnv,
    opts: TraceOpts,
    services: TraceServices,
  ): Promise<CanvasTraceResult>;
}

/**
 * Runtime environment passed to canvas adapters.
 */
export interface CanvasProbeEnv {
  pageController: PageController;
  cdpSession: CDPSessionLike;
  tabId: string;
  frameId?: string;
}

export interface CanvasDetection {
  engine: string;
  version?: string;
  confidence: number;
  evidence: string[];
  adapterId: string;
}

export interface DumpOpts {
  canvasId?: string;
  maxDepth?: number;
  onlyInteractive?: boolean;
  onlyVisible?: boolean;
}

export interface PickOpts {
  x: number;
  y: number;
  canvasId?: string;
}

export interface TraceOpts {
  targetNodeId?: string;
  breakpointType?: CanvasTraceBreakpointType;
  maxFrames?: number;
}

/**
 * Cross-domain services used during click tracing.
 */
export interface TraceServices {
  debuggerManager: DebuggerManager;
  traceRecorder: TraceRecorder;
  evidenceStore: EvidenceStore;
}

/**
 * A single node in the extracted canvas scene tree.
 */
export interface CanvasSceneNode {
  id: string;
  type: string;
  name?: string;
  visible: boolean;
  interactive: boolean;
  mouseEnabled?: boolean;
  alpha: number;
  x: number;
  y: number;
  width: number;
  height: number;
  worldBounds: WorldBounds;
  path: string;
  children?: CanvasSceneNode[];
  customData?: Record<string, unknown>;
}

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSceneDump {
  engine: string;
  version?: string;
  canvas: {
    id?: string;
    width: number;
    height: number;
    dpr: number;
    contextType: CanvasContextType;
  };
  sceneTree: CanvasSceneNode | null;
  totalNodes: number;
  completeness: CanvasDumpCompleteness;
  partialReason?: string;
}

export interface CanvasPickResult {
  success: boolean;
  picked: CanvasSceneNode | null;
  candidates: Array<{ node: CanvasSceneNode; depth: number }>;
  coordinates: {
    screen: { x: number; y: number };
    canvas: { x: number; y: number };
    stage?: { x: number; y: number };
  };
  hitTestMethod: CanvasHitTestMethod;
}

export interface CanvasTraceResult {
  inputFlow: string[];
  hitTarget: CanvasSceneNode | null;
  domEventChain: DOMEventFrame[];
  engineDispatchChain: string[];
  handlerFrames: StackFrame[];
  handlersTriggered: HandlerInfo[];
  networkEmitted: NetworkEvent[];
}

export interface DOMEventFrame {
  type: string;
  target?: string;
  phase: 'capturing' | 'at-target' | 'bubbling';
}

export interface StackFrame {
  functionName: string;
  scriptUrl?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface HandlerInfo {
  functionName: string;
  scriptUrl?: string;
  lineNumber?: number;
}

export interface NetworkEvent {
  protocol: CanvasNetworkProtocol;
  url?: string;
  method?: string;
  payloadPreview?: string;
}
