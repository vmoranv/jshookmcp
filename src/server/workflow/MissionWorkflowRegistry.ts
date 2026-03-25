/**
 * MissionWorkflowRegistry — discovers and matches mission workflows.
 *
 * Requirements: MISN-01, MISN-02
 */
import type { MissionWorkflow, MissionMatch } from './types';

// Built-in mission definitions
import { signatureLocateMission } from './missions/signature-locate';
import { websocketReverseMission } from './missions/websocket-reverse';
import { bundleUnpackMission } from './missions/bundle-unpack';
import { loginFlowCaptureMission } from './missions/login-flow-capture';
import { antiDetectDiagnosisMission } from './missions/anti-detect-diagnosis';

const BUILT_IN_MISSIONS: MissionWorkflow[] = [
  signatureLocateMission,
  websocketReverseMission,
  bundleUnpackMission,
  loginFlowCaptureMission,
  antiDetectDiagnosisMission,
];

export class MissionWorkflowRegistry {
  private readonly missions = new Map<string, MissionWorkflow>();

  constructor() {
    for (const mission of BUILT_IN_MISSIONS) {
      this.missions.set(mission.id, mission);
    }
  }

  /** Get a mission by ID. */
  getMission(id: string): MissionWorkflow | undefined {
    return this.missions.get(id);
  }

  /** List all registered missions. */
  listMissions(): MissionWorkflow[] {
    return [...this.missions.values()];
  }

  /**
   * Match a task description to the best mission workflow.
   * Returns null if no mission matches.
   */
  matchMission(taskDescription: string): MissionMatch | null {
    let bestMatch: MissionMatch | null = null;

    for (const mission of this.missions.values()) {
      for (const pattern of mission.triggerPatterns) {
        if (pattern.test(taskDescription)) {
          const confidence = mission.priority / 100;
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = {
              mission,
              confidence,
              matchedPattern: pattern.source,
            };
          }
          break; // One match per mission is enough
        }
      }
    }

    return bestMatch;
  }

  /** Register a custom mission workflow. */
  registerMission(mission: MissionWorkflow): void {
    this.missions.set(mission.id, mission);
  }
}
