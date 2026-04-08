export interface MojoMonitorConfig {
  pid?: number;
  processName?: string;
  interfaces?: string[];
  maxBuffer?: number;
}

export interface MojoMessage {
  interface: string;
  method: string;
  pipe: string;
  timestamp: string;
  payload: string;
}

export interface FridaMojoScriptConfig {
  hooks: string[];
  interfaceFilters: string[];
  maxMessages: number;
}
