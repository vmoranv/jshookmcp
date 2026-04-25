import type { PuppeteerConfig } from '@internal-types/index';

export interface ChromeLaunchOverrides {
  headless?: boolean;
  args?: string[];
  enableV8NativesSyntax?: boolean;
}

export interface ResolvedChromeLaunchOptions {
  headless: boolean;
  args: string[];
  executablePath?: string;
  v8NativeSyntaxEnabled: boolean;
}

export interface CodeCollectorLaunchResult {
  action: 'launched' | 'reused' | 'relaunched';
  launchOptions: ResolvedChromeLaunchOptions;
  reason?: 'launch-options-changed' | 'replacing-existing-browser-connection';
}

const DEFAULT_CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--ignore-certificate-errors',
];

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function splitJsFlags(value: string): string[] {
  return value
    .split(/\s+/u)
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0);
}

function dedupeArgs(args: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const arg of args) {
    if (seen.has(arg)) {
      continue;
    }
    seen.add(arg);
    deduped.push(arg);
  }

  return deduped;
}

function mergeJsFlags(args: string[], enableV8NativesSyntax: boolean | undefined) {
  const passthroughArgs: string[] = [];
  const jsFlags: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }

    if (current === '--js-flags') {
      const next = args[index + 1];
      if (typeof next === 'string') {
        jsFlags.push(...splitJsFlags(next));
        index += 1;
        continue;
      }
    }

    if (current.startsWith('--js-flags=')) {
      jsFlags.push(...splitJsFlags(current.slice('--js-flags='.length)));
      continue;
    }

    passthroughArgs.push(current);
  }

  const normalizedJsFlags = dedupeArgs(jsFlags);
  const allowNativesSyntax = '--allow-natives-syntax';

  if (enableV8NativesSyntax === true && !normalizedJsFlags.includes(allowNativesSyntax)) {
    normalizedJsFlags.push(allowNativesSyntax);
  }

  const filteredJsFlags =
    enableV8NativesSyntax === false
      ? normalizedJsFlags.filter((flag) => flag !== allowNativesSyntax)
      : normalizedJsFlags;

  return {
    args:
      filteredJsFlags.length > 0
        ? [...dedupeArgs(passthroughArgs), `--js-flags=${filteredJsFlags.join(' ')}`]
        : dedupeArgs(passthroughArgs),
    v8NativeSyntaxEnabled: filteredJsFlags.includes(allowNativesSyntax),
  };
}

export function resolveChromeLaunchOptions(
  config: PuppeteerConfig,
  overrides: ChromeLaunchOverrides | undefined,
  executablePath: string | undefined,
  viewport: { width: number; height: number },
): ResolvedChromeLaunchOptions {
  const requestedArgs = [
    ...normalizeStringArray(config.args),
    ...normalizeStringArray(overrides?.args),
    ...DEFAULT_CHROME_ARGS,
    `--window-size=${viewport.width},${viewport.height}`,
  ];

  const merged = mergeJsFlags(requestedArgs, overrides?.enableV8NativesSyntax);

  return {
    headless: overrides?.headless ?? config.headless,
    args: merged.args,
    executablePath,
    v8NativeSyntaxEnabled: merged.v8NativeSyntaxEnabled,
  };
}

export function sameChromeLaunchOptions(
  left: ResolvedChromeLaunchOptions | null,
  right: ResolvedChromeLaunchOptions,
): boolean {
  if (!left) {
    return false;
  }

  if (
    left.headless !== right.headless ||
    left.executablePath !== right.executablePath ||
    left.v8NativeSyntaxEnabled !== right.v8NativeSyntaxEnabled ||
    left.args.length !== right.args.length
  ) {
    return false;
  }

  return left.args.every((arg, index) => arg === right.args[index]);
}
