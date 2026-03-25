import { describe, expect, it } from 'vitest';

type MissionWorkflowModule = {
  default: {
    id: string;
    displayName: string;
    route?: {
      kind: 'mission';
      triggerPatterns: RegExp[];
      requiredDomains: string[];
      priority: number;
      steps: Array<{
        id: string;
        toolName: string;
        description: string;
        prerequisites: string[];
      }>;
    };
  };
};

const MISSION_MODULES = [
  {
    id: 'signature-locate',
    url: new URL('../../../workflows/mission-signature-locate/workflow.js', import.meta.url),
    sampleTask: '找到这个API的签名函数',
  },
  {
    id: 'websocket-reverse',
    url: new URL('../../../workflows/mission-websocket-reverse/workflow.js', import.meta.url),
    sampleTask: 'websocket reverse engineering',
  },
  {
    id: 'bundle-unpack',
    url: new URL('../../../workflows/mission-bundle-unpack/workflow.js', import.meta.url),
    sampleTask: 'bundle unpack this webpack app',
  },
  {
    id: 'login-flow-capture',
    url: new URL('../../../workflows/mission-login-flow-capture/workflow.js', import.meta.url),
    sampleTask: 'login capture the auth flow',
  },
  {
    id: 'anti-detect-diagnosis',
    url: new URL('../../../workflows/mission-anti-detect-diagnosis/workflow.js', import.meta.url),
    sampleTask: 'anti-detect diagnosis scan',
  },
] as const;

async function loadMissionWorkflows() {
  const loaded = await Promise.all(
    MISSION_MODULES.map(async (entry) => {
      const mod = (await import(entry.url.href)) as MissionWorkflowModule;
      return {
        id: entry.id,
        sampleTask: entry.sampleTask,
        workflow: mod.default,
      };
    }),
  );

  return loaded;
}

describe('External mission workflows', () => {
  it('discovers 5 shipped mission workflows from workflows/', async () => {
    const missions = await loadMissionWorkflows();

    expect(missions).toHaveLength(5);
    expect(missions.map((entry) => entry.workflow.id)).toEqual([
      'signature-locate',
      'websocket-reverse',
      'bundle-unpack',
      'login-flow-capture',
      'anti-detect-diagnosis',
    ]);
  });

  it('defines mission route metadata for every shipped workflow', async () => {
    const missions = await loadMissionWorkflows();

    for (const { workflow } of missions) {
      expect(workflow.route?.kind).toBe('mission');
      expect(workflow.route?.requiredDomains.length).toBeGreaterThan(0);
      expect(workflow.route?.priority).toBeGreaterThan(0);
      expect(workflow.route?.steps.length).toBeGreaterThan(0);
    }
  });

  it('matches each sample task against its trigger patterns', async () => {
    const missions = await loadMissionWorkflows();

    for (const { sampleTask, workflow } of missions) {
      expect(workflow.route?.triggerPatterns.some((pattern) => pattern.test(sampleTask))).toBe(
        true,
      );
    }
  });

  it('keeps DAG prerequisites valid for every route step', async () => {
    const missions = await loadMissionWorkflows();

    for (const { workflow } of missions) {
      const stepIds = new Set(workflow.route?.steps.map((step) => step.id));
      for (const step of workflow.route?.steps ?? []) {
        for (const prerequisite of step.prerequisites) {
          expect(stepIds.has(prerequisite)).toBe(true);
        }
      }
    }
  });

  it('points every route step at a current tool name', async () => {
    const knownToolNames = new Set([
      'network_enable',
      'network_get_requests',
      'network_extract_auth',
      'network_export_har',
      'network_replay_request',
      'page_navigate',
      'page_screenshot',
      'debugger_enable',
      'detect_crypto',
      'ai_hook_generate',
      'binary_decode',
      'js_bundle_search',
      'sourcemap_discover',
      'sourcemap_fetch_and_parse',
      'sourcemap_reconstruct_tree',
      'antidebug_detect_protections',
      'antidebug_bypass_all',
    ]);

    const missions = await loadMissionWorkflows();

    for (const { workflow } of missions) {
      for (const step of workflow.route?.steps ?? []) {
        expect(knownToolNames.has(step.toolName)).toBe(true);
      }
    }
  });

  it('preserves the signature-locate dependency chain', async () => {
    const missions = await loadMissionWorkflows();
    const signatureLocate = missions.find((entry) => entry.id === 'signature-locate')?.workflow;
    const steps = new Map(signatureLocate?.route?.steps.map((step) => [step.id, step]));

    expect(signatureLocate?.displayName).toContain('Signature Locate');
    expect(steps.get('network')?.prerequisites).toEqual([]);
    expect(steps.get('capture')?.prerequisites).toEqual(['network']);
    expect(steps.get('debugger')?.prerequisites).toEqual(['capture']);
    expect(steps.get('locate')?.prerequisites).toEqual(['debugger']);
    expect(steps.get('hook')?.prerequisites).toEqual(['locate']);
  });
});
