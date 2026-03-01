export interface ProcessInfo {
  pid: number;
  name: string;
  executablePath?: string;
  commandLine?: string;
  windowTitle?: string;
  windowHandle?: string;
  parentPid?: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface WindowInfo {
  handle: string;
  title: string;
  className: string;
  processId: number;
  threadId: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ChromiumProcess {
  mainProcess?: ProcessInfo;
  rendererProcesses: ProcessInfo[];
  gpuProcess?: ProcessInfo;
  utilityProcesses: ProcessInfo[];
  targetWindow?: WindowInfo;
}

/**
 * Configuration for target application discovery
 */
export interface TargetAppConfig {
  processNamePattern?: string | RegExp;
  windowTitlePattern?: string | RegExp;
  windowClassPattern?: string | RegExp;
}

/**
 * Default configuration for Chromium-based applications
 */
export const DEFAULT_CHROMIUM_CONFIG: TargetAppConfig = {
  processNamePattern: /^(chromium|chrome|msedge)$/i,
  windowClassPattern: 'Chrome_WidgetWin',
};
