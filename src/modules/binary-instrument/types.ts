export interface GhidraFunctionParameter {
  name: string;
  type: string;
}

export interface GhidraFunctionSummary {
  name: string;
  address: string;
  signature: string;
  returnType: string;
  parameters: GhidraFunctionParameter[];
}

export interface GhidraAnalysisOutput {
  functions: GhidraFunctionSummary[];
  callGraph: string[];
  strings: string[];
  imports: string[];
  decompilations: Array<{ name: string; decompiled: string }>;
}

export interface HookParameter {
  name: string;
  type: string;
  description: string;
}

export interface HookTemplate {
  functionName: string;
  hookCode: string;
  description: string;
  parameters: HookParameter[];
}

export interface ExtensionBridgeConfig {
  pluginId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ExtensionBridgeResult {
  success: boolean;
  tool: string;
  action: string;
  data?: unknown;
  error?: string;
}
