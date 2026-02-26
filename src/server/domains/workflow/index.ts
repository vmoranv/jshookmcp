/**
 * Workflow domain — composite reverse-engineering tools.
 *
 * These tools compose lower-level browser/network primitives into
 * end-to-end workflows, reducing the number of tool calls an AI
 * orchestrator needs to make for common reverse-engineering tasks.
 */

export { workflowToolDefinitions } from './definitions.js';
export { WorkflowHandlers } from './handlers.js';
