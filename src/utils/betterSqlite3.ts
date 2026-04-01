import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type BetterSqlite3Issue = 'missing' | 'abi-mismatch' | 'load-failed';

export interface BetterSqlite3ProbeResult {
  status: 'ok' | 'missing' | 'warn';
  detail: string;
  version: string | null;
  issue?: BetterSqlite3Issue;
}

interface BetterSqlite3PackageJson {
  version?: string;
}

interface BetterSqlite3DatabaseLike {
  prepare(sql: string): { get(): unknown };
  close(): void;
}

interface BetterSqlite3Constructor {
  new (path: string): BetterSqlite3DatabaseLike;
}

const BETTER_SQLITE3_VERSION = '12.6.2';
const INSTALL_HINT = `pnpm add -O better-sqlite3@${BETTER_SQLITE3_VERSION}`;
const REBUILD_HINT = 'npm rebuild better-sqlite3 --foreground-scripts';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isBetterSqlite3RelatedError(error: unknown): boolean {
  return /better-sqlite3|better_sqlite3\.node|NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(
    extractErrorMessage(error),
  );
}

export function classifyBetterSqlite3Issue(error: unknown): BetterSqlite3Issue {
  const message = extractErrorMessage(error);

  if (
    /Cannot find module 'better-sqlite3'|Cannot find package 'better-sqlite3'|better-sqlite3 is not installed/i.test(
      message,
    )
  ) {
    return 'missing';
  }

  if (
    /better_sqlite3\.node|NODE_MODULE_VERSION|compiled against a different Node\.js version|module was compiled against/i.test(
      message,
    )
  ) {
    return 'abi-mismatch';
  }

  return 'load-failed';
}

export function formatBetterSqlite3Error(error: unknown): string {
  const issue = classifyBetterSqlite3Issue(error);
  const message = extractErrorMessage(error);

  if (issue === 'missing') {
    return `better-sqlite3 is not installed. Install the optional trace backend with \`${INSTALL_HINT}\`.`;
  }

  if (issue === 'abi-mismatch') {
    return `better-sqlite3 is installed but its native binary is incompatible with the current Node.js runtime (${process.version}, ABI ${process.versions.modules}). Rebuild it with \`${REBUILD_HINT}\` or reinstall dependencies under the active Node version. Original error: ${message}`;
  }

  return `better-sqlite3 failed to initialize. Try \`${REBUILD_HINT}\` or reinstall dependencies under the active Node version. Original error: ${message}`;
}

function readBetterSqlite3Version(): string | null {
  try {
    const packageJsonPath = require.resolve('better-sqlite3/package.json');
    const packageJson = require(packageJsonPath) as BetterSqlite3PackageJson;
    return packageJson.version ?? null;
  } catch {
    /* v8 ignore next -- CI guarantees node_modules installation */
    return null;
  }
}

export function probeBetterSqlite3(): BetterSqlite3ProbeResult {
  const version = readBetterSqlite3Version();

  /* v8 ignore next -- CI guarantees package.json existence */
  if (!version) {
    return {
      status: 'missing',
      detail: `Optional SQLite backend for trace tools is not installed. Install it with: ${INSTALL_HINT}`,
      version: null,
      issue: 'missing',
    };
  }

  try {
    const Database = require('better-sqlite3') as BetterSqlite3Constructor;
    const db = new Database(':memory:');
    try {
      db.prepare('SELECT 1 AS ok').get();
    } finally {
      db.close();
    }

    return {
      status: 'ok',
      detail: `installed (${version}) — native trace backend healthy`,
      version,
    };
  } catch (error) {
    const issue = classifyBetterSqlite3Issue(error);
    /* v8 ignore next -- Native loading exceptions cannot be deterministically forced in pure TS envs */
    if (issue === 'missing') {
      return {
        status: 'missing',
        detail: `Optional SQLite backend for trace tools is not installed. Install it with: ${INSTALL_HINT}`,
        version,
        issue,
      };
    }

    /* v8 ignore next */
    return {
      status: 'warn',
      detail: `installed (${version}) but ${formatBetterSqlite3Error(error)}`,
      version,
      issue,
    };
  }
}
