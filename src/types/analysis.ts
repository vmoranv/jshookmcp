import type { CodeLocation } from '@internal-types/common';

export interface UnderstandCodeOptions {
  code: string;
  context?: Record<string, unknown>;
  focus?: 'structure' | 'business' | 'security' | 'all';
}

export interface UnderstandCodeResult {
  structure: CodeStructure;
  techStack: TechStack;
  businessLogic: BusinessLogic;
  dataFlow: DataFlow;
  securityRisks: SecurityRisk[];
  qualityScore: number;
  codePatterns?: Array<{
    name: string;
    location: number;
    description: string;
  }>;
  antiPatterns?: Array<{
    name: string;
    location: number;
    severity: string;
    recommendation: string;
  }>;
  complexityMetrics?: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    halsteadMetrics: {
      vocabulary: number;
      length: number;
      difficulty: number;
      effort: number;
    };
  };
}

export interface CodeStructure {
  functions: FunctionInfo[];
  classes: ClassInfo[];
  modules: ModuleInfo[];
  callGraph: CallGraph;
}

export interface FunctionInfo {
  name: string;
  params: string[];
  returnType?: string;
  location: CodeLocation;
  complexity: number;
}

export interface ClassInfo {
  name: string;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
  location: CodeLocation;
}

export interface PropertyInfo {
  name: string;
  type?: string;
  value?: unknown;
}

export interface ModuleInfo {
  name: string;
  exports: string[];
  imports: string[];
}

export interface CallGraph {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

export interface CallGraphNode {
  id: string;
  name: string;
  type: 'function' | 'method' | 'constructor';
}

export interface CallGraphEdge {
  from: string;
  to: string;
  callCount?: number;
}

export interface TechStack {
  framework?: string;
  bundler?: string;
  uiLibrary?: string;
  stateManagement?: string;
  cryptoLibrary?: string[];
  other: string[];
}

export interface BusinessLogic {
  mainFeatures: string[];
  entities: string[];
  rules: string[];
  dataModel: Record<string, unknown>;
}

export interface DataFlow {
  graph: DataFlowGraph;
  sources: DataSource[];
  sinks: DataSink[];
  taintPaths: TaintPath[];
}

export interface DataFlowGraph {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
}

export interface DataFlowNode {
  id: string;
  type: 'source' | 'sink' | 'transform';
  name: string;
  location: CodeLocation;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  data: string;
}

export interface DataSource {
  type: 'user_input' | 'storage' | 'network' | 'other';
  location: CodeLocation;
}

export interface DataSink {
  type: 'dom' | 'network' | 'storage' | 'eval' | 'xss' | 'sql-injection' | 'other';
  location: CodeLocation;
}

export interface TaintPath {
  source: DataSource;
  sink: DataSink;
  path: CodeLocation[];
  risk?: 'high' | 'medium' | 'low';
}

export interface SecurityRisk {
  type: 'xss' | 'sql-injection' | 'csrf' | 'sensitive-data' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: CodeLocation;
  description: string;
  recommendation: string;
}
