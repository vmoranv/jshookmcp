export async function runConsoleInterceptJsdomPhase(ctx) {
  const { report, server, clients, helpers, constants } = ctx;
  const { client } = clients;
  const { callTool, flattenStrings } = helpers;
  const {
    BODY_MARKER,
    CONSOLE_LOG_MARKER,
    CONSOLE_EXCEPTION_MARKER,
    AUTH_BEARER_MARKER,
    AUTH_API_KEY_MARKER,
    AUTH_SIGNATURE_MARKER,
    INTERCEPT_MARKER,
  } = constants;

  report.network.interceptAdd = await callTool(
    client,
    'network_intercept',
    {
      action: 'add',
      urlPattern: `${server.baseUrl}/intercept-target*`,
      urlPatternType: 'glob',
      responseCode: 200,
      responseHeaders: { 'content-type': 'text/plain; charset=utf-8', 'x-audit-intercept': '1' },
      responseBody: INTERCEPT_MARKER,
    },
    30000,
  );
  report.mojo.monitorStart = await callTool(client, 'mojo_monitor', { action: 'start' }, 30000);
  report.browser.seedAuditProbeScript = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        const script = document.createElement('script');
        script.dataset.auditProbe = 'true';
        script.textContent = 'function auditProbeFn(){ return 7; } window.auditProbeFn = auditProbeFn;\\n//# sourceURL=audit-probe.js';
        document.documentElement.appendChild(script);
        return { inserted: true, scriptCount: document.scripts.length };
      })()`,
    },
    15000,
  );
  report.browser.consoleExecute = await callTool(
    client,
    'console_execute',
    { expression: 'window.auditProbeFn()' },
    15000,
  );
  {
    const largeScriptPayload = `window.__auditLargeText = ${JSON.stringify('L'.repeat(70000))};`;
    report.browser.seedLargeAuditScript = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => {
          const script = document.createElement('script');
          script.dataset.auditLargeProbe = 'true';
          script.textContent = ${JSON.stringify(`${largeScriptPayload}\n//# sourceURL=audit-large.js`)};
          document.documentElement.appendChild(script);
          return {
            inserted: true,
            textLength: script.textContent.length,
            largeTextLength: window.__auditLargeText.length,
          };
        })()`,
      },
      15000,
    );
  }
  report.browser.pageEval = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => new Promise(async (resolve, reject) => {
        const result = {};
        try {
          console.log(${JSON.stringify(CONSOLE_LOG_MARKER)});
          console.warn(${JSON.stringify(`${CONSOLE_LOG_MARKER}-warn`)});
          console.error(${JSON.stringify(`${CONSOLE_LOG_MARKER}-error`)});
          setTimeout(() => {
            throw new Error(${JSON.stringify(CONSOLE_EXCEPTION_MARKER)});
          }, 0);

          const bodyText = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=eval`)}).then((resp) => resp.text());
          result.fetchContainsMarker = bodyText.includes(${JSON.stringify(BODY_MARKER)});
          result.fetchLength = bodyText.length;

          result.ws = await new Promise((resolveWs, rejectWs) => {
            const ws = new WebSocket(${JSON.stringify(server.wsUrl)});
            const messages = [];
            const timer = setTimeout(() => {
              try { ws.close(); } catch {}
              rejectWs(new Error('timeout waiting for websocket messages'));
            }, 5000);
            ws.onopen = () => ws.send('client-ping');
            ws.onmessage = (event) => {
              messages.push(String(event.data));
              if (messages.includes('server-hello') && messages.includes('echo:client-ping')) {
                clearTimeout(timer);
                try { ws.close(); } catch {}
                resolveWs(messages);
              }
            };
            ws.onerror = () => {
              clearTimeout(timer);
              try { ws.close(); } catch {}
              rejectWs(new Error('websocket error'));
            };
          });

          result.sse = await new Promise((resolveSse, rejectSse) => {
            const es = new EventSource(${JSON.stringify(`${server.baseUrl}/sse`)});
            const timer = setTimeout(() => {
              try { es.close(); } catch {}
              rejectSse(new Error('timeout waiting for sse message'));
            }, 5000);
            es.onmessage = (event) => {
              clearTimeout(timer);
              const payload = { data: String(event.data), lastEventId: event.lastEventId || null };
              try { es.close(); } catch {}
              resolveSse(payload);
            };
            es.onerror = () => {
              clearTimeout(timer);
              try { es.close(); } catch {}
              rejectSse(new Error('sse error'));
            };
          });

          await new Promise((resume) => setTimeout(resume, 50));
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }))()`,
    },
    45000,
  );
  report.browser.consoleLogs = await callTool(client, 'console_get_logs', { limit: 20 }, 15000);
  {
    const consoleLogStrings = flattenStrings(report.browser.consoleLogs);
    report.browser.consoleHasLogMarker = consoleLogStrings.some((entry) =>
      entry.includes(CONSOLE_LOG_MARKER),
    );
    report.browser.consoleHasWarnMarker = consoleLogStrings.some((entry) =>
      entry.includes(`${CONSOLE_LOG_MARKER}-warn`),
    );
    report.browser.consoleHasErrorMarker = consoleLogStrings.some((entry) =>
      entry.includes(`${CONSOLE_LOG_MARKER}-error`),
    );
  }
  report.network.consoleExceptions = await callTool(
    client,
    'console_get_exceptions',
    { limit: 20 },
    15000,
  );
  {
    const consoleExceptionStrings = flattenStrings(report.network.consoleExceptions);
    report.network.consoleExceptionHasMarker = consoleExceptionStrings.some((entry) =>
      entry.includes(CONSOLE_EXCEPTION_MARKER),
    );
  }
  report.network.consoleInjectXhrActive = await callTool(
    client,
    'console_inject_xhr_interceptor',
    { persistent: false },
    15000,
  );
  report.browser.interceptorExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => new Promise(async (resolve, reject) => {
        try {
          const dynamic = document.createElement('script');
          dynamic.textContent = 'window.__auditDynamicScriptSeen = true;';
          document.documentElement.appendChild(dynamic);

          const fetchText = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=inject-fetch`)}).then((resp) => resp.text());

          const xhrText = await new Promise((resolveXhr, rejectXhr) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', ${JSON.stringify(`${server.baseUrl}/body?via=inject-xhr`)}, true);
            xhr.onload = () => resolveXhr(xhr.responseText || '');
            xhr.onerror = () => rejectXhr(new Error('xhr error'));
            xhr.send();
          });

          resolve({
            dynamicScriptSeen: window.__auditDynamicScriptSeen === true,
            fetchHasMarker: fetchText.includes(${JSON.stringify(BODY_MARKER)}),
            xhrHasMarker: xhrText.includes(${JSON.stringify(BODY_MARKER)}),
          });
        } catch (error) {
          reject(error);
        }
      }))()`,
    },
    30000,
  );
  report.network.xhrInterceptorState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => ({
        injected: window.__xhrInterceptorInjected ?? null,
        installed: window.__xhrInterceptorInstalled ?? null,
        recordCount: Array.isArray(window.__xhrRequests) ? window.__xhrRequests.length : null,
        firstUrl: Array.isArray(window.__xhrRequests) && window.__xhrRequests[0]
          ? window.__xhrRequests[0].url ?? null
          : null,
      }))()`,
    },
    15000,
  );
  report.network.interceptFetch = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => new Promise(async (resolve, reject) => {
        try {
          const response = await fetch(${JSON.stringify(`${server.baseUrl}/intercept-target?via=intercept`)});
          resolve({
            status: response.status,
            header: response.headers.get('x-audit-intercept'),
            body: await response.text(),
          });
        } catch (error) {
          reject(error);
        }
      }))()`,
    },
    30000,
  );
  report.network.interceptList = await callTool(
    client,
    'network_intercept',
    { action: 'list' },
    15000,
  );
  report.network.interceptDisable = await callTool(
    client,
    'network_intercept',
    { action: 'disable', all: true },
    15000,
  );
  report.network.authExercise = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => new Promise(async (resolve, reject) => {
        try {
          const response = await fetch(${JSON.stringify(`${server.baseUrl}/body?via=auth`)}, {
            method: 'POST',
            headers: {
              Authorization: ${JSON.stringify(`Bearer ${AUTH_BEARER_MARKER}`)},
              'X-Api-Key': ${JSON.stringify(AUTH_API_KEY_MARKER)},
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ signature: ${JSON.stringify(AUTH_SIGNATURE_MARKER)} }),
          });
          const body = await response.text();
          resolve({ status: response.status, bodyHasMarker: body.includes(${JSON.stringify(BODY_MARKER)}) });
        } catch (error) {
          reject(error);
        }
      }))()`,
    },
    30000,
  );
  report.network.consoleBuffersClear = await callTool(
    client,
    'console_buffers',
    { action: 'clear' },
    15000,
  );
  report.network.consoleBuffersReset = await callTool(
    client,
    'console_buffers',
    { action: 'reset' },
    15000,
  );
  report.browser.jsdomParse = await callTool(
    client,
    'browser_jsdom_parse',
    {
      html: '<!doctype html><html><head><title>JSDOM Probe</title></head><body><main id="app"><a class="item" href="/docs">Docs</a><div id="output"></div></main></body></html>',
      url: `${server.baseUrl}/jsdom-probe`,
      runScripts: 'outside-only',
    },
    15000,
  );
  report.browser.jsdomSessionId =
    typeof report.browser.jsdomParse?.sessionId === 'string'
      ? report.browser.jsdomParse.sessionId
      : null;
  if (report.browser.jsdomSessionId) {
    report.browser.jsdomQuery = await callTool(
      client,
      'browser_jsdom_query',
      {
        sessionId: report.browser.jsdomSessionId,
        selector: '#app .item',
        includeHtml: true,
        attributes: ['href', 'class'],
      },
      15000,
    );
    report.browser.jsdomExecute = await callTool(
      client,
      'browser_jsdom_execute',
      {
        sessionId: report.browser.jsdomSessionId,
        code: `document.querySelector('#output').textContent = String(3 + 4); console.log('jsdom-probe-log'); ({ output: document.querySelector('#output').textContent, title: document.title });`,
      },
      15000,
    );
    report.browser.jsdomSerialize = await callTool(
      client,
      'browser_jsdom_serialize',
      {
        sessionId: report.browser.jsdomSessionId,
        selector: '#app',
        pretty: true,
      },
      15000,
    );
    report.browser.jsdomCookieSet = await callTool(
      client,
      'browser_jsdom_cookies',
      {
        sessionId: report.browser.jsdomSessionId,
        action: 'set',
        cookie: { name: 'probe', value: 'cookie-ok', path: '/' },
      },
      15000,
    );
    report.browser.jsdomCookieGet = await callTool(
      client,
      'browser_jsdom_cookies',
      {
        sessionId: report.browser.jsdomSessionId,
        action: 'get',
      },
      15000,
    );
    report.browser.jsdomCookieClear = await callTool(
      client,
      'browser_jsdom_cookies',
      {
        sessionId: report.browser.jsdomSessionId,
        action: 'clear',
      },
      15000,
    );
  }
}
