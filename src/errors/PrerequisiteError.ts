/**
 * Thrown when a tool's prerequisite is not met (e.g. debugger not enabled,
 * browser not connected, profiling not started).
 *
 * The MCP server catches this and returns a graceful
 * `{ success: false, message }` response instead of `isError: true`.
 *
 * Extends ToolError with code 'PREREQUISITE' for unified error classification.
 * Constructor signature unchanged — backward-compatible with all existing callers.
 */
import { ToolError } from './ToolError.js';

export class PrerequisiteError extends ToolError {
  constructor(message: string) {
    super('PREREQUISITE', message);
    this.name = 'PrerequisiteError';
  }
}
