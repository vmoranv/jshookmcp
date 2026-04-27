import { readFile } from 'node:fs/promises';

export async function runBrowserPageInteractionPhase(ctx) {
  const { report, clients, helpers, constants, state } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError } = helpers;
  const { BODY_MARKER, ROOT_RELOAD_KEY, HOOK_PRESET_MARKER } = constants;
  const { auditHost, auditPort, screenshotPath, performanceTracePath } = state.browserContext;

  report.browser.waitForSelector = await callTool(
    client,
    'page_wait_for_selector',
    { selector: '#click-target', timeout: 5000 },
    15000,
  );
  report.browser.setViewport = await callTool(
    client,
    'page_set_viewport',
    { width: 1024, height: 768 },
    15000,
  );
  report.browser.injectScript = await callTool(
    client,
    'page_inject_script',
    {
      script:
        "window.__auditInjectedScript = 'injected'; const output = document.getElementById('inject-output'); if (output) output.textContent = window.__auditInjectedScript;",
    },
    15000,
  );
  report.canvas.seed = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        let canvas = document.getElementById('audit-canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.id = 'audit-canvas';
          canvas.width = 220;
          canvas.height = 120;
          canvas.style.display = 'block';
          canvas.style.border = '1px solid #222';
          canvas.style.marginTop = '16px';
          const host = document.querySelector('main') || document.body;
          host.appendChild(canvas);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#f97316';
          ctx.fillRect(20, 20, 120, 60);
          ctx.fillStyle = '#ffffff';
          ctx.font = '16px sans-serif';
          ctx.fillText('canvas-probe', 28, 58);
        }
        if (!canvas.__auditCanvasBound) {
          canvas.addEventListener('click', () => {
            window.__auditCanvasClicks = (window.__auditCanvasClicks || 0) + 1;
          });
          canvas.__auditCanvasBound = true;
        }
        if (!window.Laya || !window.Laya.__auditFixture) {
          class AuditStage {}
          const stage = {
            __proto__: AuditStage.prototype,
            id: 'audit-stage',
            name: 'AuditStage',
            visible: true,
            mouseEnabled: true,
            alpha: 1,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
            parent: null,
            children: [],
            numChildren: 0,
            clientScaleX: 1,
            clientScaleY: 1,
            localToGlobal(point) {
              const rect = canvas.getBoundingClientRect();
              return { x: rect.left + point.x, y: rect.top + point.y };
            },
            globalToLocal(point) {
              const rect = canvas.getBoundingClientRect();
              return { x: point.x - rect.left, y: point.y - rect.top };
            }
          };
          window.Laya = {
            __auditFixture: true,
            version: '2.x-audit',
            MouseManager: {},
            Browser: { canvas },
            stage
          };
        } else if (window.Laya.Browser) {
          window.Laya.Browser.canvas = canvas;
        }
        if (window.Laya && window.Laya.stage) {
          window.Laya.stage.width = canvas.width;
          window.Laya.stage.height = canvas.height;
        }
        const rect = canvas.getBoundingClientRect();
        return {
          id: canvas.id,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        };
      })()`,
    },
    15000,
  );
  const canvasRect = report.canvas.seed?.result?.rect ?? report.canvas.seed?.rect ?? {};
  const canvasClickX = typeof canvasRect.left === 'number' ? Math.round(canvasRect.left + 32) : 32;
  const canvasClickY = typeof canvasRect.top === 'number' ? Math.round(canvasRect.top + 32) : 32;
  report.canvas.fingerprint = await callTool(
    client,
    'canvas_engine_fingerprint',
    { canvasId: 'audit-canvas' },
    30000,
  );
  report.canvas.sceneDump = await callTool(
    client,
    'canvas_scene_dump',
    { canvasId: 'audit-canvas', maxDepth: 4 },
    30000,
  );
  report.canvas.pick = await callTool(
    client,
    'canvas_pick_object_at_point',
    { x: canvasClickX, y: canvasClickY, canvasId: 'audit-canvas', highlight: false },
    30000,
  );
  report.canvas.skiaDetect = await callToolCaptureError(
    client,
    'skia_detect_renderer',
    { canvasId: 'audit-canvas' },
    30000,
  );
  report.canvas.skiaExtract = await callToolCaptureError(
    client,
    'skia_extract_scene',
    { canvasId: 'audit-canvas' },
    30000,
  );
  report.canvas.skiaCorrelate = await callToolCaptureError(
    client,
    'skia_correlate_objects',
    { canvasId: 'audit-canvas' },
    30000,
  );
  report.canvas.traceClickInput = {
    x: canvasClickX,
    y: canvasClickY,
    canvasId: 'audit-canvas',
    breakpointType: 'click',
  };
  report.canvas.traceClick = await callToolCaptureError(
    client,
    'canvas_trace_click_handler',
    report.canvas.traceClickInput,
    10000,
  );
  report.browser.type = await callTool(
    client,
    'page_type',
    { selector: '#name-input', text: 'AuditName' },
    15000,
  );
  report.browser.pressKey = await callTool(client, 'page_press_key', { key: 'Enter' }, 15000);
  report.browser.select = await callTool(
    client,
    'page_select',
    { selector: '#color-select', values: ['blue'] },
    15000,
  );
  report.browser.hover = await callTool(client, 'page_hover', { selector: '#hover-target' }, 15000);
  report.browser.click = await callTool(client, 'page_click', { selector: '#click-target' }, 15000);
  report.browser.screenshot = await callTool(
    client,
    'page_screenshot',
    { selector: '#click-target', path: screenshotPath, type: 'png' },
    30000,
  );
  try {
    report.browser.screenshotBytes = (await readFile(screenshotPath)).length;
  } catch {}
  report.browser.scroll = await callTool(client, 'page_scroll', { x: 0, y: 1200 }, 15000);
  report.browser.interactionState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        typedValue: window.__auditTypedValue ?? null,
        lastKey: window.__auditLastKey ?? null,
        selectedValue: window.__auditSelectedValue ?? null,
        hoverCount: window.__auditHoverCount ?? 0,
        clickCount: window.__auditClickCount ?? 0,
        injected: window.__auditInjectedScript ?? null,
        scrollY: window.scrollY,
        innerWidth: window.innerWidth
      }))()`,
    },
    15000,
  );
  report.browser.cookiesSet = await callTool(
    client,
    'page_cookies',
    {
      action: 'set',
      cookies: [{ name: 'page_probe', value: '1', domain: auditHost, path: '/' }],
    },
    15000,
  );
  report.browser.cookiesGet = await callTool(client, 'page_cookies', { action: 'get' }, 15000);
  if (typeof report.browser.cookiesGet?.count === 'number') {
    report.browser.cookiesClear = await callTool(
      client,
      'page_cookies',
      { action: 'clear', expectedCount: report.browser.cookiesGet.count },
      15000,
    );
  }
  report.browser.localStorageSet = await callTool(
    client,
    'page_local_storage',
    { action: 'set', key: 'page-probe', value: 'storage-ok' },
    15000,
  );
  report.browser.localStorageGet = await callTool(
    client,
    'page_local_storage',
    { action: 'get' },
    15000,
  );
  report.workflow.apiProbeBatch = await callTool(
    client,
    'api_probe_batch',
    {
      baseUrl: ctx.server.baseUrl,
      paths: ['/body?via=api-probe-batch'],
      includeBodyStatuses: [200],
      maxBodySnippetLength: 64,
      networkPolicy: {
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
        allowedHosts: [auditHost, `${auditHost}:${auditPort}`],
      },
    },
    30000,
  );
  report.browser.seedFrameworkState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        let root = document.getElementById('framework-probe-root');
        if (!root) {
          root = document.createElement('div');
          root.id = 'framework-probe-root';
          document.body.appendChild(root);
        }
        const hookTwo = { memoizedState: ['beta', 'gamma'], next: null };
        const hookOne = { memoizedState: { marker: ${JSON.stringify(BODY_MARKER)}, count: 2 }, next: hookTwo };
        const fiber = { memoizedState: hookOne, type: { name: 'AuditComponent' }, child: null, sibling: null };
        Object.defineProperty(root, '__reactFiber$audit', {
          value: fiber,
          configurable: true,
          enumerable: true
        });
        return { seeded: true, marker: ${JSON.stringify(BODY_MARKER)} };
      })()`,
    },
    15000,
  );
  report.browser.frameworkState = await callTool(
    client,
    'framework_state_extract',
    { framework: 'react', selector: '#framework-probe-root', maxDepth: 2 },
    30000,
  );
  report.browser.seedIndexedDb = await callTool(
    client,
    'page_evaluate',
    {
      code: `(async () => {
        await new Promise((resolve, reject) => {
          const req = indexedDB.open('audit-db', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('items')) {
              db.createObjectStore('items', { keyPath: 'id' });
            }
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('items', 'readwrite');
            tx.objectStore('items').put({ id: 1, marker: ${JSON.stringify(BODY_MARKER)} });
            tx.objectStore('items').put({ id: 2, marker: 'secondary-record' });
            tx.oncomplete = () => {
              db.close();
              resolve({ seeded: true });
            };
            tx.onerror = () => reject(tx.error);
          };
        });
        return { seeded: true, database: 'audit-db' };
      })()`,
    },
    30000,
  );
  report.browser.indexedDbDump = await callTool(
    client,
    'indexeddb_dump',
    { database: 'audit-db', store: 'items', maxRecords: 10 },
    30000,
  );
  report.workflow.pageScriptRegister = await callTool(
    client,
    'page_script_register',
    {
      name: 'runtime_probe',
      description: 'Return a doubled runtime probe value.',
      code: '(() => ({ value: __params__.value, doubled: __params__.value * 2 }))()',
    },
    15000,
  );
  report.workflow.pageScriptRun = await callTool(
    client,
    'page_script_run',
    { name: 'runtime_probe', params: { value: 21 } },
    15000,
  );
  report.performance.traceStart = await callTool(
    client,
    'performance_trace',
    { action: 'start', categories: ['devtools.timeline', 'v8.execute'] },
    30000,
  );
  report.browser.reload = await callTool(client, 'page_reload', {}, 30000);
  report.performance.traceStop = await callTool(
    client,
    'performance_trace',
    { action: 'stop', artifactPath: performanceTracePath },
    60000,
  );
  try {
    report.performance.traceBytes = (await readFile(performanceTracePath)).length;
  } catch {}
  report.browser.reloadState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        reloadCount: Number(localStorage.getItem(${JSON.stringify(ROOT_RELOAD_KEY)}) || '0'),
        externalLoaded: window.__auditRuntimeProbeExternalLoaded === true,
        inlineLoaded: window.__auditRuntimeProbeInlineLoaded === true
      }))()`,
    },
    15000,
  );
  report.browser.resetHumanViewport = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        window.scrollTo(0, 0);
        return { scrollY: window.scrollY };
      })()`,
    },
    15000,
  );
  report.browser.humanMouse = await callTool(
    client,
    'human_mouse',
    { selector: '#click-target', steps: 6, durationMs: 180, click: true },
    30000,
  );
  report.browser.afterHumanMouse = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        clickCount: window.__auditClickCount ?? 0
      }))()`,
    },
    15000,
  );
  report.browser.humanScroll = await callTool(
    client,
    'human_scroll',
    { distance: 240, direction: 'down', durationMs: 180, segments: 3, jitter: 0 },
    30000,
  );
  report.browser.afterHumanScroll = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        scrollY: window.scrollY
      }))()`,
    },
    15000,
  );
  report.browser.humanTyping = await callTool(
    client,
    'human_typing',
    {
      selector: '#name-input',
      text: 'HumanAudit',
      clearFirst: true,
      errorRate: 0,
      wpm: 120,
    },
    30000,
  );
  report.browser.afterHumanTyping = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        typedValue: window.__auditTypedValue ?? null
      }))()`,
    },
    15000,
  );
  report.browser.hookPresetList = await callTool(
    client,
    'hook_preset',
    { listPresets: true },
    15000,
  );
  report.browser.hookPresetInject = await callTool(
    client,
    'hook_preset',
    {
      preset: 'runtime-audit-custom',
      customTemplate: {
        id: 'runtime-audit-custom',
        description: 'Set a runtime audit marker on window.',
        body: `window.__auditHookPresetMarker = ${JSON.stringify(HOOK_PRESET_MARKER)};`,
      },
      method: 'evaluate',
      logToConsole: false,
    },
    30000,
  );
  report.browser.hookPresetState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        marker: window.__auditHookPresetMarker ?? null,
        presets: Object.keys(window.__hookPresets || {})
      }))()`,
    },
    15000,
  );
}
