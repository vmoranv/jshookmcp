export function createProbeAssets(constants) {
  const { BODY_MARKER, ROOT_RELOAD_KEY, SOURCEMAP_MARKER, WASM_MARKER, WEBPACK_MARKER } = constants;

  const bodyPayload = `${BODY_MARKER}\n${'x'.repeat(12361 - BODY_MARKER.length - 1)}`;
  const pluginRegistryPayload = {
    plugins: [
      {
        slug: 'runtime-audit-plugin',
        id: 'runtime-audit-plugin',
        source: {
          type: 'git',
          repo: 'https://example.invalid/runtime-audit-plugin.git',
          ref: 'main',
          commit: 'runtime-audit-plugin-commit',
          subpath: '.',
          entry: 'dist/index.js',
        },
        meta: {
          name: 'Runtime Audit Plugin',
          description: 'Local registry fixture for runtime audit coverage.',
          author: 'jshookmcp-runtime-audit',
          source_repo: 'https://example.invalid/runtime-audit-plugin.git',
        },
      },
    ],
  };
  const workflowRegistryPayload = {
    workflows: [
      {
        slug: 'runtime-audit-workflow',
        id: 'runtime-audit-workflow',
        source: {
          type: 'git',
          repo: 'https://example.invalid/runtime-audit-workflow.git',
          ref: 'main',
          commit: 'runtime-audit-workflow-commit',
          subpath: '.',
          entry: 'dist/index.js',
        },
        meta: {
          name: 'Runtime Audit Workflow',
          description: 'Local registry fixture for workflow registry coverage.',
          author: 'jshookmcp-runtime-audit',
          source_repo: 'https://example.invalid/runtime-audit-workflow.git',
        },
      },
    ],
  };
  const graphqlSchemaPayload = {
    data: {
      __schema: {
        queryType: { name: 'Query' },
        mutationType: null,
        subscriptionType: null,
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [
              {
                name: 'auditGreeting',
                args: [{ name: 'name', type: { kind: 'SCALAR', name: 'String' } }],
                type: { kind: 'SCALAR', name: 'String' },
              },
            ],
          },
          { kind: 'SCALAR', name: 'String' },
          { kind: 'SCALAR', name: 'Boolean' },
        ],
        directives: [],
      },
    },
  };
  const graphqlPageScript = [
    'window.runGraphqlAudit = async function(name) {',
    '  const response = await fetch("/graphql", {',
    '    method: "POST",',
    '    headers: { "content-type": "application/json", "x-runtime-audit": "graphql" },',
    '    body: JSON.stringify({',
    '      query: "query AuditGreeting($name: String!) { auditGreeting(name: $name) __typename marker }",',
    '      operationName: "AuditGreeting",',
    '      variables: { name }',
    '    })',
    '  });',
    '  const payload = await response.json();',
    '  window.__graphqlAuditPayload = payload;',
    '  return payload;',
    '};',
  ].join('\n');
  const webpackPageScript = [
    'window.__webpack_module_cache__ = {};',
    'window.__webpack_modules__ = {',
    '  "1": function(module) { module.exports = { marker: ' +
      JSON.stringify(WEBPACK_MARKER) +
      ', value: 42 }; },',
    '  "2": function(module) { module.exports = { nested: { marker: ' +
      JSON.stringify(WEBPACK_MARKER) +
      ' }, label: "runtime-audit" }; }',
    '};',
    'window.__webpack_require__ = function(id) {',
    '  if (window.__webpack_module_cache__[id]) return window.__webpack_module_cache__[id].exports;',
    '  const module = { exports: {} };',
    '  window.__webpack_module_cache__[id] = module;',
    '  window.__webpack_modules__[id](module, module.exports, window.__webpack_require__);',
    '  return module.exports;',
    '};',
    'window.webpackChunkruntimeAudit = Object.assign([], {',
    '  m: window.__webpack_modules__',
    '});',
    'window.webpackChunkruntimeAudit.push([[0], window.__webpack_modules__]);',
  ].join('\n');
  const wasmProbeBytes = Buffer.from(
    'AGFzbQEAAAABCQJgAX8AYAABfwIRAQNlbnYJYXVkaXRfbG9nAAADAgEBBQMBAAEHEQIGbWVtb3J5AgAEbWFpbgABCgoBCABBABAAQQcLCxABAEEACwpXQVNNLUFVRElU',
    'base64',
  );
  const wasmPageScript = [
    'window.__wasmModuleStorage = [];',
    'window.__wasmInstances = [];',
    'window.__wasmRuntimeAudit = { marker: ' + JSON.stringify(WASM_MARKER) + ' };',
    'window.runWasmAudit = async function() {',
    '  const response = await fetch("/wasm/runtime-audit.wasm", { cache: "no-store" });',
    '  const bytes = await response.arrayBuffer();',
    '  window.__wasmModuleStorage = [bytes.slice(0)];',
    '  let instanceRef = null;',
    '  const imports = {',
    '    env: {',
    '      audit_log: function(offset) {',
    '        const memory = instanceRef && instanceRef.exports && instanceRef.exports.memory;',
    '        if (memory && memory.buffer) {',
    '          const view = new Uint8Array(memory.buffer);',
    '          const length = Math.min(10, view.length - offset);',
    '          window.__wasmLastImportText = new TextDecoder().decode(view.slice(offset, offset + length));',
    '        }',
    '        window.__wasmLastImportOffset = offset;',
    '        return offset;',
    '      }',
    '    }',
    '  };',
    '  const result = await WebAssembly.instantiate(bytes, imports);',
    '  instanceRef = result.instance;',
    '  window.__wasmInstances = [result.instance];',
    '  const mainResult = typeof result.instance.exports.main === "function" ? result.instance.exports.main() : null;',
    '  window.__wasmRuntimeAudit = {',
    '    marker: ' + JSON.stringify(WASM_MARKER) + ',',
    '    mainResult,',
    '    importText: window.__wasmLastImportText || null,',
    '    importOffset: window.__wasmLastImportOffset ?? null,',
    '    exportedKeys: Object.keys(result.instance.exports || {})',
    '  };',
    '  return window.__wasmRuntimeAudit;',
    '};',
    'window.runWasmAudit().catch((error) => {',
    '  window.__wasmRuntimeAudit = { marker: ' +
      JSON.stringify(WASM_MARKER) +
      ', error: String(error) };',
    '});',
  ].join('\n');
  const rootAppScript = [
    `window.__auditRuntimeProbeMarker__ = ${JSON.stringify(BODY_MARKER)};`,
    'window.__auditRuntimeProbeExternalLoaded = true;',
    'document.addEventListener("DOMContentLoaded", () => {',
    '  const input = document.getElementById("name-input");',
    '  if (input) {',
    '    input.addEventListener("input", () => {',
    '      window.__auditTypedValue = input.value;',
    '      const output = document.getElementById("typed-output");',
    '      if (output) output.textContent = input.value;',
    '    });',
    '  }',
    '  const select = document.getElementById("color-select");',
    '  if (select) {',
    '    select.addEventListener("change", () => {',
    '      window.__auditSelectedValue = select.value;',
    '      const output = document.getElementById("select-output");',
    '      if (output) output.textContent = select.value;',
    '    });',
    '  }',
    '  const hover = document.getElementById("hover-target");',
    '  if (hover) {',
    '    hover.addEventListener("mouseenter", () => {',
    '      window.__auditHoverCount = (window.__auditHoverCount || 0) + 1;',
    '      const output = document.getElementById("hover-output");',
    '      if (output) output.textContent = String(window.__auditHoverCount);',
    '    });',
    '  }',
    '  document.addEventListener("keydown", (event) => {',
    '    window.__auditLastKey = event.key;',
    '    const output = document.getElementById("key-output");',
    '    if (output) output.textContent = event.key;',
    '  });',
    "  console.log('runtime probe external script loaded');",
    '});',
  ].join('\n');
  const sourceMapPayload = JSON.stringify({
    version: 3,
    file: 'app.min.js',
    sources: ['src/main.ts'],
    sourcesContent: [`export const marker = '${SOURCEMAP_MARKER}';\nconsole.log(marker);\n`],
    names: [],
    mappings: 'AAAA',
  });
  const sourceMapDataUri = `data:application/json;base64,${Buffer.from(sourceMapPayload, 'utf8').toString('base64')}`;
  const sourceMapScript = [
    `window.__SOURCE_MAP_MARKER__ = ${JSON.stringify(SOURCEMAP_MARKER)};`,
    "console.log('sourcemap script loaded');",
    `//# sourceMappingURL=${sourceMapDataUri}`,
  ].join('\n');

  return {
    bodyPayload,
    pluginRegistryPayload,
    workflowRegistryPayload,
    graphqlSchemaPayload,
    graphqlPageScript,
    webpackPageScript,
    wasmProbeBytes,
    wasmPageScript,
    rootAppScript,
    rootPageHtml: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>runtime probe</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 24px; }
      main { max-width: 960px; display: grid; gap: 12px; }
      nav { display: flex; gap: 12px; }
      input, select, button { padding: 8px; font-size: 14px; }
      #hover-target { width: 160px; padding: 12px; border: 1px solid #999; }
      .spacer { height: 1400px; background: linear-gradient(180deg, #f3f3f3 0%, #d9ecff 100%); }
    </style>
    <script>
      const key = ${JSON.stringify(ROOT_RELOAD_KEY)};
      const current = Number(localStorage.getItem(key) || '0');
      localStorage.setItem(key, String(current + 1));
      window.__auditRuntimeProbeInlineLoaded = true;
    </script>
    <script src="/app.js" defer></script>
  </head>
  <body>
    <main>
      <h1>runtime probe</h1>
      <nav>
        <a id="history-link-one" href="/history/one">History One</a>
        <a id="history-link-two" href="/history/two">History Two</a>
      </nav>
      <label for="name-input">Name</label>
      <input id="name-input" name="name" />
      <div id="typed-output"></div>
      <label for="color-select">Color</label>
      <select id="color-select">
        <option value="red">red</option>
        <option value="blue">blue</option>
      </select>
      <div id="select-output"></div>
      <button
        id="click-target"
        onclick="window.__auditClickCount=(window.__auditClickCount||0)+1; document.getElementById('click-output').textContent=String(window.__auditClickCount);"
      >
        Click probe
      </button>
      <div id="click-output">0</div>
      <div id="hover-target">Hover probe</div>
      <div id="hover-output">0</div>
      <div id="key-output"></div>
      <div id="inject-output"></div>
      <div class="spacer"></div>
      <div id="scroll-marker">scroll-target</div>
    </main>
  </body>
</html>`,
    sourceMapPayload,
    sourceMapDataUri,
    sourceMapScript,
  };
}
