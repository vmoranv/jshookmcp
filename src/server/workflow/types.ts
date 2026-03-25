/**
 * Mission workflow types for structured reverse engineering task orchestration.
 *
 * A mission workflow is a DAG of tool steps that accomplish a complete
 * reverse engineering objective (e.g., signature locate, WebSocket reverse).
 */

/** A single step in a mission workflow DAG. */
export interface MissionStep {
  /** Unique step identifier within the mission. */
  id: string;
  /** MCP tool name to invoke. */
  toolName: string;
  /** Human-readable description of what this step does. */
  description: string;
  /** Step IDs that must complete before this step can run. */
  prerequisites: string[];
  /** If true, can run in parallel with other steps at the same dependency level. */
  parallel?: boolean;
  /** Expected input parameters for the tool. */
  expectedInputs?: Record<string, string>;
  /** What this step contributes to the evidence graph. */
  evidenceNodeType?: string;
}

/** A complete mission workflow definition. */
export interface MissionWorkflow {
  /** Unique mission identifier. */
  id: string;
  /** Human-readable mission name. */
  name: string;
  /** What this mission accomplishes. */
  description: string;
  /** Regex patterns that trigger this mission from route_tool. */
  triggerPatterns: RegExp[];
  /** Ordered list of workflow steps (DAG). */
  steps: MissionStep[];
  /** Domains required for this mission. */
  requiredDomains: string[];
  /** Priority for routing (higher = preferred). */
  priority: number;
}

/** Result of matching a task description to a mission. */
export interface MissionMatch {
  mission: MissionWorkflow;
  confidence: number;
  matchedPattern: string;
}
