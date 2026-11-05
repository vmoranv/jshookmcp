#!/usr/bin/env node
// Deterministic, dependency-free HTTP fixture for the e2e real-task layer.
//
// WHY THIS EXISTS
// ---------------
// `pnpm bench:e2e` (scripts/bench-e2e.mjs) runs every tests/e2e/**/*.test.ts
// three times (pass^k). ~10 of those files gate on E2E_TARGET_URL and actually
// navigate a real browser to that HTTP origin. It used to point at the public
// VitePress site (https://vmoranv.github.io/jshookmcp/), so the measurement
// depended on external network + a third-party deploy being up: a 5xx or a
// deploy in progress silently turned the whole e2e-tasks column into an empty
// result. Self-hosting the target makes the layer deterministic and offline.
//
// WHAT IT SERVES (the minimum surface the e2e files assert — see the mapping
// in tests/benchmarks/README.md):
//   - `/` AND a catch-all for ANY path: sandbox-oopif.e2e.test.ts navigates to
//     `<target>/level/3`; unknown paths must return a real document, not 404.
//   - a real HTML doc with <title>/<body>/<script> so page_navigate
//     (waitUntil load/networkidle) resolves and document.title/location work.
//   - a genuine HTTP origin (data: URLs cannot hold cookies/localStorage),
//     plus sub-resources so network_get_requests / HAR export capture traffic.
//   - `.VPNav` / `.VPHero` / `.VPFeatures` and the `#e2e_*` element ids used
//     by full-tool-e2e.test.ts selectors (its phases also inject their own).
//   - HEAD + OPTIONS support: syscall-hook.e2e.test.ts does
//     fetch(window.location.href, { method: 'HEAD' }).
//
// NO new dependencies: node:http only. The port is FIXED (default 4173, or
// E2E_FIXTURE_PORT / PORT) so CI can set E2E_TARGET_URL to a known value.
//
//   node scripts/serve-e2e-fixture.mjs                 # foreground, port 4173
//   E2E_FIXTURE_PORT=4180 node scripts/serve-e2e-fixture.mjs
//   node scripts/serve-e2e-fixture.mjs --check        # probe / and exit
//
// Signals: SIGINT/SIGTERM close the server cleanly.

import http from 'node:http';

const PORT = Number.parseInt(process.env.E2E_FIXTURE_PORT ?? process.env.PORT ?? '4173', 10);
const HOST = '127.0.0.1';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JSHookMCP e2e fixture</title>
  <link rel="stylesheet" href="/fixture.css" />
</head>
<body>
  <nav class="VPNav"><span>JSHookMCP</span></nav>
  <section class="VPHero"><h1>JSHookMCP e2e fixture</h1></section>
  <section class="VPFeatures">
    <button id="e2e_click_target" type="button">E2E Click</button>
    <input id="e2e_text_input" type="text" value="" />
    <input id="e2e_human_input" type="text" value="" />
    <div id="e2e_hover_target" style="width:120px;height:32px">E2E Hover</div>
    <select id="test_select_e2e"><option value="a">a</option><option value="b">b</option></select>
    <div id="scroll-marker" style="height:1200px">scroll</div>
  </section>
  <script src="/fixture.js"></script>
  <script>
    window.__e2e = true;
    document.title = 'JSHookMCP e2e fixture';
  </script>
</body>
</html>
`;

const CSS =
  `body{margin:0;font-family:system-ui,sans-serif}` +
  `.VPNav{padding:8px 16px;border-bottom:1px solid #ccc}` +
  `.VPHero{padding:24px}.VPFeatures{padding:16px;display:grid;gap:12px}`;

const JS =
  `window.__fixtureScriptLoaded = true;\n` +
  `document.getElementById('e2e_click_target')?.addEventListener('click', () => {\n` +
  `  window.__e2eClickCount = (window.__e2eClickCount || 0) + 1;\n` +
  `});\n` +
  `// A tiny same-origin fetch gives network monitors / HAR export a real request.\n` +
  `fetch('/fixture-ping.json').catch(() => {});\n`;

function send(res, status, body, type = 'text/html; charset=utf-8', headOnly = false) {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    'content-type': type,
    'content-length': buf.length,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(headOnly ? undefined : buf);
}

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] || '/';

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'GET,HEAD,OPTIONS' });
    res.end();
    return;
  }
  const headOnly = method === 'HEAD';

  // Dedicated sub-resources (capturable by network_get_requests / HAR).
  if (path === '/fixture.css') return send(res, 200, CSS, 'text/css; charset=utf-8', headOnly);
  if (path === '/fixture.js')
    return send(res, 200, JS, 'application/javascript; charset=utf-8', headOnly);
  if (path === '/fixture-ping.json')
    return send(res, 200, '{"ok":true}', 'application/json', headOnly);

  // Catch-all: every other path (including /level/3) returns the real document.
  if (method === 'GET' || headOnly)
    return send(res, 200, HTML, 'text/html; charset=utf-8', headOnly);

  res.writeHead(405, { allow: 'GET, HEAD, OPTIONS' });
  res.end();
});

const CHECK_MODE = process.argv.includes('--check');

if (CHECK_MODE) {
  // Pure client probe — NEVER bind a server here. CI uses this in a retry loop
  // while the real server runs in a separate background process.
  const probe = http.get(`http://${HOST}:${PORT}/`, (r) => {
    r.resume();
    process.exit(r.statusCode === 200 ? 0 : 1);
  });
  probe.on('error', () => process.exit(1));
} else {
  server.listen(PORT, HOST, () => {
    console.log(`[e2e-fixture] ready http://${HOST}:${PORT}/`);
  });

  function stop() {
    server.close(() => process.exit(0));
    // Don't let keep-alive sockets hold the process open during shutdown.
    setTimeout(() => process.exit(0), 1000).unref();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
