/* eslint-disable no-underscore-dangle */
/**
 * P1 灵敏度诊断: 在真实 636-tool registry 上跑参数扰动，
 * 区分 "fixture 太小" vs "rank-based 指标饱和"。
 *
 * 直接调用 full registry engine（不走 worker fixture），测同一组
 * hard queries 在不同参数下 top-K 排名是否变化。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initRegistry, getAllManifests } from '../../src/server/registry/index';
import { ToolSearchEngine } from '../../src/server/search/ToolSearchEngineImpl';

const __filename = fileURLToPath(import.meta.url);

interface ProbeCase {
  id: string;
  query: string;
  expectTop: string; // 期望 top-1
}

// Hard cases: 同义近义 / 弱信号 / 跨域干扰，最能体现参数差异
const HARD_CASES: ProbeCase[] = [
  { id: 'synonym', query: 'sniff HTTP traffic', expectTop: 'network_enable' },
  { id: 'fuzzy', query: 'nagivate page', expectTop: 'page_navigate' },
  { id: 'cross-domain', query: 'capture', expectTop: 'network_enable' },
  { id: 'vague', query: 'monitor', expectTop: 'network_monitor' },
  { id: 'intent', query: 'how to intercept fetch', expectTop: 'console_inject_fetch_interceptor' },
  { id: 'partial', query: 'tls key', expectTop: 'tls_keylog_enable' },
];

interface ParamSet {
  label: string;
  env: Record<string, string>;
}

const PARAM_SETS: ParamSet[] = [
  { label: 'default', env: {} },
  {
    label: 'k1=3 b=1 (extreme tf/len)',
    env: { SEARCH_BM25_K1: '3.0', SEARCH_BM25_B: '1.0' },
  },
  {
    label: 'rrf_k=60 (standard)',
    env: { SEARCH_RRF_K: '60' },
  },
  {
    label: 'low exact match',
    env: { SEARCH_EXACT_NAME_MATCH_MULTIPLIER: '1.5' },
  },
  {
    label: 'high trigram',
    env: { SEARCH_TRIGRAM_WEIGHT: '0.3', SEARCH_TRIGRAM_THRESHOLD: '0.2' },
  },
];

async function buildEngine() {
  const allTools: any[] = [];
  const domainMap = new Map<string, string>();
  for (const m of getAllManifests()) {
    for (const r of m.registrations) {
      allTools.push(r.tool);
      domainMap.set(r.tool.name, m.domain);
    }
  }
  return new ToolSearchEngine(allTools, domainMap, undefined, undefined, undefined);
}

function runInWorker(label: string, env: Record<string, string>): Promise<string> {
  // Spawn a child process with env set — constants.ts reads process.env at load
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', __filename, '--probe-run'], {
      env: { ...process.env, ...env, PROBE_LABEL: label },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', () => resolve(out.trim()));
    child.on('error', reject);
  });
}

async function probeRun() {
  await initRegistry();
  const engine = await buildEngine();
  const label = process.env.PROBE_LABEL ?? '?';
  const rows: string[] = [];
  let top1Hits = 0;
  for (const tc of HARD_CASES) {
    const results = await engine.search(tc.query, 5);
    const top3 = results.slice(0, 3).map((r) => r.name);
    if (results[0]?.name === tc.expectTop) top1Hits++;
    rows.push(
      `  ${tc.id.padEnd(14)} top1=${(results[0]?.name ?? '-').padEnd(36)} top3=${top3.join(',').slice(0, 70)}`,
    );
  }
  console.log(
    JSON.stringify({
      label,
      top1HitRate: top1Hits / HARD_CASES.length,
      detail: rows.join('\n'),
    }),
  );
}

async function main() {
  if (process.argv.includes('--probe-run')) {
    await probeRun();
    return;
  }

  console.log('=== P1 sensitivity probe: full 636-tool registry ===\n');
  for (const ps of PARAM_SETS) {
    const out = await runInWorker(ps.label, ps.env);
    try {
      const parsed = JSON.parse(out);
      console.log(`[${ps.label}] top1HitRate=${parsed.top1HitRate.toFixed(3)}`);
      console.log(parsed.detail);
      console.log('');
    } catch {
      console.log(`[${ps.label}] PARSE FAIL: ${out.slice(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
