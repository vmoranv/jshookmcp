import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface CliFastPathResult {
  handled: boolean;
  exitCode: number;
  output?: string;
}

function getPackageVersion(moduleUrl: string): string {
  try {
    // Walk up from the module file to find the nearest package.json with a version.
    // Handles both source layout (src/utils/cliFastPath.ts) and
    // dist layout (dist/src/utils/cliFastPath.js).
    let dirUrl = new URL('.', moduleUrl);
    for (let i = 0; i < 5; i++) {
      try {
        const candidate = fileURLToPath(new URL('package.json', dirUrl));
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // Not found at this level — keep walking up
      }
      const parentUrl = new URL('../', dirUrl);
      if (parentUrl.href === dirUrl.href) break; // filesystem root
      dirUrl = parentUrl;
    }
  } catch {
    // URL resolution failed — fall through
  }
  return process.env.npm_package_version ?? '0.0.0';
}

function buildHelpText(version: string): string {
  return [
    `@jshookmcp/jshook ${version}`,
    '',
    'Usage:',
    '  jshook [--help] [--version]',
    '  jshookmcp [--help] [--version]',
    '',
    'Behavior:',
    '  Starts the MCP server by default.',
    '',
    'Common environment variables:',
    '  OPENAI_API_KEY',
    '  DEFAULT_LLM_PROVIDER=openai|anthropic',
    '  MCP_TRANSPORT=stdio|http',
    '  MCP_TOOL_PROFILE=search|workflow|full',
    '',
  ].join('\n');
}

export function resolveCliFastPath(args: string[], moduleUrl: string): CliFastPathResult {
  const normalizedArgs = args.map((arg) => arg.trim()).filter(Boolean);
  const showHelp =
    normalizedArgs.includes('--help') ||
    normalizedArgs.includes('-h') ||
    normalizedArgs[0] === 'help';
  const showVersion =
    normalizedArgs.includes('--version') ||
    normalizedArgs.includes('-v') ||
    normalizedArgs.includes('-V') ||
    normalizedArgs[0] === 'version';

  if (showHelp) {
    const version = getPackageVersion(moduleUrl);
    return {
      handled: true,
      exitCode: 0,
      output: buildHelpText(version),
    };
  }

  if (showVersion) {
    return {
      handled: true,
      exitCode: 0,
      output: `${getPackageVersion(moduleUrl)}\n`,
    };
  }

  return {
    handled: false,
    exitCode: 0,
  };
}
