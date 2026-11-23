/**
 * P1 根因诊断: 对每个 hard case 输出 top-5 的完整打分分解，
 * 确认 ranking 失误的真正原因（affinity 误加权 vs exact-match 弱 vs 无 bias）。
 * 单进程直接 import，env 用 SEARCH_* 前缀直接读 constants 默认值。
 */
import { initRegistry, getAllManifests } from '../../src/server/registry/index';
import { ToolSearchEngine } from '../../src/server/search/ToolSearchEngineImpl';

interface Case {
  id: string;
  query: string;
  wantTop: string;
  acceptTop: string[]; // 可接受的 top-1 候选
}

const CASES: Case[] = [
  {
    id: 'sniff-traffic',
    query: 'sniff HTTP traffic',
    wantTop: 'network_enable',
    acceptTop: ['network_enable', 'network_monitor', 'network_get_requests'],
  },
  {
    id: 'nagivate-fuzzy',
    query: 'nagivate page',
    wantTop: 'page_navigate',
    acceptTop: ['page_navigate'],
  },
  {
    id: 'capture-cross',
    query: 'capture',
    wantTop: 'network_enable',
    acceptTop: ['network_enable', 'network_monitor'],
  },
  {
    id: 'tls-key',
    query: 'tls key',
    wantTop: 'tls_keylog_enable',
    acceptTop: ['tls_keylog_enable'],
  },
  {
    id: 'monitor-vague',
    query: 'monitor',
    wantTop: 'network_monitor',
    acceptTop: ['network_monitor'],
  },
];

async function main() {
  await initRegistry();
  const allTools: any[] = [];
  const domainMap = new Map<string, string>();
  for (const m of getAllManifests()) {
    for (const r of m.registrations) {
      allTools.push(r.tool);
      domainMap.set(r.tool.name, m.domain);
    }
  }
  const engine = new ToolSearchEngine(allTools, domainMap, undefined, undefined, undefined);
  // 等向量预热完成，避免 self-RAG quick path 之外的信号未就绪

  // ── trigram threshold 对 typo 的灵敏度验证 ──
  // "nagivate page" vs page_navigate 的 trigram Jaccard 手算 ≈ 0.167，
  // 默认 threshold 0.47 会把它过滤掉。验证降低 threshold 是否能召回。
  console.log('=== trigram threshold probe (nagivate → page_navigate) ===');
  const triIdx = new (await import('../../src/server/search/TrigramIndex')).TrigramIndex([
    'page_navigate',
    'tab_workflow',
  ]);
  for (const th of [0.47, 0.3, 0.2, 0.15, 0.1]) {
    const scores = triIdx.search('nagivate page', th);
    const nav = scores.get(0); // page_navigate 在 index 0
    const tab = scores.get(1);
    console.log(
      `  th=${th}: page_navigate=${nav?.toFixed(3) ?? '-'} tab_workflow=${tab?.toFixed(3) ?? '-'}`,
    );
  }

  for (const c of CASES) {
    const results = await engine.search(c.query, 8);
    const acceptHit = results.findIndex((r) => c.acceptTop.includes(r.name));
    const status =
      acceptHit === 0 ? 'OK(top1)' : acceptHit > 0 ? `weak(rank${acceptHit + 1})` : 'MISS';
    console.log(`\n[${c.id}] "${c.query}" want=${c.wantTop} → ${status}`);
    console.log(
      results
        .slice(0, 5)
        .map(
          (r, i) => `  ${i + 1}. ${r.name.padEnd(34)} score=${r.score.toFixed(3)} dom=${r.domain}`,
        )
        .join('\n'),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
