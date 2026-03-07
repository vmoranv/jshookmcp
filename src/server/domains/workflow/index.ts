/**
 * Workflow domain — composite analysis tools.
 *
 * These tools compose lower-level browser/network primitives into
 * end-to-end workflows, reducing the number of tool calls an AI
 * orchestrator needs to make for common analysis tasks.
 */

export { workflowToolDefinitions } from '@server/domains/workflow/definitions';
export { WorkflowHandlers } from '@server/domains/workflow/handlers';
