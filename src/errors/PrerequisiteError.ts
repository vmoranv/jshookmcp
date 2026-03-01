/**
 * Thrown when a tool's prerequisite is not met (e.g. debugger not enabled,
 * browser not connected, profiling not started).
 *
 * The MCP server catches this and returns a graceful
 * `{ success: false, message }` response instead of `isError: true`.
 */
export class PrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrerequisiteError';
  }
}
