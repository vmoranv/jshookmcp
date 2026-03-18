import { readFileSync } from 'node:fs';

export interface CliFastPathResult {
  handled: boolean;
  exitCode: number;
  output?: string;
}

function getPackageVersion(moduleUrl: string): string {
  try {
    const packageJsonUrl = new URL('../package.json', moduleUrl);
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string };
    return packageJson.version ?? '0.0.0';
  } catch {
    return process.env.npm_package_version ?? '0.0.0';
  }
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
