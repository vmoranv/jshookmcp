/**
 * Dataset loader for profile-tier tuning cases.
 * Provides cross-tier escape / in-tier protect scenarios.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolProfile } from '../../../src/server/ToolCatalog';
import { buildSearchQualityFixture } from '../../../tests/server/search/fixtures/search-quality.fixture';

export interface ProfileTierCase {
  readonly id: string;
  readonly title: string;
  readonly query: string;
  readonly topK: number;
  readonly expectations: ReadonlyArray<{ tool: string; gain: 1 | 2 | 3 }>;
  readonly baseTier: ToolProfile;
  readonly visibleDomains: readonly string[];
  readonly tags: readonly string[];
}

export interface LoadedProfileTierDataset {
  readonly name: 'profile-tier';
  readonly tools: readonly Tool[];
  readonly domainOverrides: ReadonlyMap<string, string>;
  readonly cases: readonly ProfileTierCase[];
}

const PROFILE_CASES: readonly ProfileTierCase[] = [
  // search profile: browser active, query for full-tier tools
  {
    id: 'profile-search-tls-explicit',
    title: 'search tier: explicit "tls_keylog_enable" should escape penalty',
    query: 'call tls_keylog_enable',
    topK: 10,
    expectations: [{ tool: 'tls_keylog_enable', gain: 3 }],
    baseTier: 'search',
    visibleDomains: ['browser'],
    tags: ['boringssl', 'explicit-name'],
  },
  {
    id: 'profile-search-frida-lexical',
    title: 'search tier: strong lexical "attach Frida" should still surface',
    query: 'attach Frida to process',
    topK: 10,
    expectations: [{ tool: 'frida_attach', gain: 3 }],
    baseTier: 'search',
    visibleDomains: ['browser'],
    tags: ['binary-instrument', 'strong-lexical'],
  },
  {
    id: 'profile-search-browser-protect',
    title: 'search tier: browser query should rank in-tier tools higher',
    query: 'navigate to URL and click',
    topK: 10,
    expectations: [
      { tool: 'page_navigate', gain: 3 },
      { tool: 'page_click', gain: 3 },
    ],
    baseTier: 'search',
    visibleDomains: ['browser'],
    tags: ['browser', 'in-tier-protect'],
  },
  // workflow profile: browser+network active, query for full-tier tools
  {
    id: 'profile-workflow-v8-escape',
    title: 'workflow tier: "V8 bytecode extract" should surface with light penalty',
    query: 'extract V8 bytecode',
    topK: 10,
    expectations: [{ tool: 'v8_bytecode_extract', gain: 3 }],
    baseTier: 'workflow',
    visibleDomains: ['browser', 'network', 'debugger'],
    tags: ['v8-inspector', 'cross-tier-escape'],
  },
  {
    id: 'profile-workflow-network-protect',
    title: 'workflow tier: network query should rank in-tier tools higher',
    query: 'capture network requests',
    topK: 10,
    expectations: [{ tool: 'network_enable', gain: 3 }],
    baseTier: 'workflow',
    visibleDomains: ['browser', 'network', 'debugger'],
    tags: ['network', 'in-tier-protect'],
  },
  {
    id: 'profile-workflow-syscall-explicit',
    title: 'workflow tier: explicit syscall tool should escape',
    query: 'call syscall_start_monitor',
    topK: 10,
    expectations: [{ tool: 'syscall_start_monitor', gain: 3 }],
    baseTier: 'workflow',
    visibleDomains: ['browser', 'network', 'debugger'],
    tags: ['syscall-hook', 'explicit-name'],
  },
  // generic queries: should protect current tier
  {
    id: 'profile-search-generic-debug',
    title: 'search tier: generic "debug" query should not promote off-tier debugger tools',
    query: 'debug JavaScript code',
    topK: 10,
    expectations: [{ tool: 'debug_pause', gain: 2 }],
    baseTier: 'search',
    visibleDomains: ['browser'],
    tags: ['debugger', 'generic'],
  },
];

export function loadProfileTierDataset(): LoadedProfileTierDataset {
  const fixture = buildSearchQualityFixture();
  return {
    name: 'profile-tier',
    tools: fixture.tools,
    domainOverrides: fixture.domainByToolName,
    cases: PROFILE_CASES,
  };
}
