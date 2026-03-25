import { describe, expect, it, beforeEach } from 'vitest';
import { MissionWorkflowRegistry } from '@server/workflow/MissionWorkflowRegistry';

describe('MissionWorkflowRegistry (MISN-01~05)', () => {
  let registry: MissionWorkflowRegistry;

  beforeEach(() => {
    registry = new MissionWorkflowRegistry();
  });

  it('discovers 5 built-in missions (MISN-01)', () => {
    const missions = registry.listMissions();
    expect(missions).toHaveLength(5);

    const ids = missions.map((m) => m.id);
    expect(ids).toContain('signature-locate');
    expect(ids).toContain('websocket-reverse');
    expect(ids).toContain('bundle-unpack');
    expect(ids).toContain('login-flow-capture');
    expect(ids).toContain('anti-detect-diagnosis');
  });

  it('getMission returns correct DAG for signature-locate (MISN-02)', () => {
    const mission = registry.getMission('signature-locate');
    expect(mission).toBeDefined();
    expect(mission!.name).toContain('签名定位');
    expect(mission!.steps).toHaveLength(5);

    // Verify DAG prerequisites
    const stepMap = new Map(mission!.steps.map((s) => [s.id, s]));
    expect(stepMap.get('network')!.prerequisites).toEqual([]);
    expect(stepMap.get('capture')!.prerequisites).toEqual(['network']);
    expect(stepMap.get('debugger')!.prerequisites).toEqual(['capture']);
    expect(stepMap.get('locate')!.prerequisites).toEqual(['debugger']);
    expect(stepMap.get('hook')!.prerequisites).toEqual(['locate']);
  });

  it('matchMission returns workflow graph for task description (MISN-03)', () => {
    const match = registry.matchMission('找到这个API的签名函数');
    expect(match).not.toBeNull();
    expect(match!.mission.id).toBe('signature-locate');
    expect(match!.confidence).toBeGreaterThan(0);
  });

  it('matchMission returns null for unrelated task', () => {
    const match = registry.matchMission('help me write a README');
    expect(match).toBeNull();
  });

  it('mission workflow DAG has valid prerequisites for each step (MISN-04)', () => {
    for (const mission of registry.listMissions()) {
      const stepIds = new Set(mission.steps.map((s) => s.id));

      for (const step of mission.steps) {
        for (const prereq of step.prerequisites) {
          expect(stepIds.has(prereq)).toBe(true);
        }
      }
    }
  });

  it('all missions have required domains defined', () => {
    for (const mission of registry.listMissions()) {
      expect(mission.requiredDomains.length).toBeGreaterThan(0);
    }
  });

  it('all mission steps point to current real tool names', () => {
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

    for (const mission of registry.listMissions()) {
      for (const step of mission.steps) {
        expect(knownToolNames.has(step.toolName)).toBe(true);
      }
    }
  });

  it('matchMission matches websocket-reverse', () => {
    const match = registry.matchMission('websocket reverse engineering');
    expect(match).not.toBeNull();
    expect(match!.mission.id).toBe('websocket-reverse');
  });

  it('matchMission matches anti-detect-diagnosis', () => {
    const match = registry.matchMission('anti-detect diagnosis scan');
    expect(match).not.toBeNull();
    expect(match!.mission.id).toBe('anti-detect-diagnosis');
  });

  it('matchMission matches login-flow-capture', () => {
    const match = registry.matchMission('login capture the auth flow');
    expect(match).not.toBeNull();
    expect(match!.mission.id).toBe('login-flow-capture');
  });

  it('matchMission matches bundle-unpack', () => {
    const match = registry.matchMission('bundle unpack this webpack app');
    expect(match).not.toBeNull();
    expect(match!.mission.id).toBe('bundle-unpack');
  });

  it('registerMission adds custom mission', () => {
    registry.registerMission({
      id: 'custom-mission',
      name: 'Custom',
      description: 'Test',
      triggerPatterns: [/custom test/i],
      steps: [],
      requiredDomains: ['browser'],
      priority: 50,
    });

    expect(registry.listMissions()).toHaveLength(6);
    expect(registry.getMission('custom-mission')).toBeDefined();
  });

  it('getMission returns undefined for missing ID', () => {
    expect(registry.getMission('nonexistent')).toBeUndefined();
  });
});
