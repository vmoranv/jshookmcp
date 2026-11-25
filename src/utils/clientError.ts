/**
 * Safe error for MCP client responses.
 *
 * Raw errors never cross the MCP boundary as-is: absolute filesystem
 * paths are stripped (they leak the server layout), stack frames are
 * dropped, and only the message survives.
 *
 * Usage:
 *   throw toClientError(err);  // or: new ClientError('...')
 */
export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

/** Absolute paths: drive-letter or root-anchored, >= 2 segments. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:)?[\\/](?:[A-Za-z0-9_.~-]+[\\/])+[A-Za-z0-9_.~-]+/g;
/** Stack trace frames, e.g. "    at foo (C:\src\a.ts:1:2)" or "    at C:\src\a.ts:1:2". */
const STACK_FRAME = /^\s*at\s+.+(?::\d+:\d+|\(.*\))\s*$/;

/** Wrap an unknown error as a ClientError: strip paths and stacks, keep message. */
export function toClientError(error: unknown): ClientError {
  if (error instanceof ClientError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const withoutPaths = raw.replace(ABSOLUTE_PATH, '<path>');
  const filtered = raw
    .split('\n')
    .filter((line) => !STACK_FRAME.test(line))
    .join('\n');
  // A single-line message such as "at least one argument required" matches the
  // frame shape only if anchored too loosely; never return an empty message
  // when everything was filtered out.
  const message =
    filtered.trim().length > 0 ? filtered.replace(ABSOLUTE_PATH, '<path>') : withoutPaths;
  return new ClientError(message);
}
