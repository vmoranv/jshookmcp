export const DEFAULT_TRACE_DIR: string;
export function isTraceDisabled(env?: NodeJS.ProcessEnv): boolean;
export function resolveTraceDir(env?: NodeJS.ProcessEnv, cwd?: string): string | null;
