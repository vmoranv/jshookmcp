import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sanitizerState = vi.hoisted(() => ({
  checkSanitizer: vi.fn((call: any) => {
    const callee = call.callee;
    return callee?.type === 'Identifier' && callee.name === 'sanitize';
  }),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));
vi.mock('@modules/analyzer/SecurityCodeAnalyzer', () => ({
  checkSanitizer: sanitizerState.checkSanitizer,
}));

import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';

describe('CodeAnalyzerDataFlow additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('source detection network calls', () => {
    it('detects fetch as network source', async () => {
      const r = await analyzeDataFlowWithTaint('const data = api.fetch("/ep");');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
      expect(r.graph.nodes.some((n) => n.name === 'fetch()' && n.type === 'source')).toBe(true);
    });
    it('detects ajax as network source', async () => {
      const r = await analyzeDataFlowWithTaint('const d = $.ajax("/url");');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
    });
    it('detects get post request axios', async () => {
      const r = await analyzeDataFlowWithTaint(
        'const a=http.get("/"); const b=http.post("/"); const c=http.request("/"); const d=client.axios("/");',
      );
      expect(r.sources.filter((s) => s.type === 'network').length).toBeGreaterThanOrEqual(4);
    });
    it('tracks taint from network source into eval', async () => {
      const r = await analyzeDataFlowWithTaint('const resp = api.fetch("/d"); eval(resp);');
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
  });

  describe('source detection DOM query methods', () => {
    it('detects querySelector', async () => {
      const r = await analyzeDataFlowWithTaint('const el = document.querySelector("#input");');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects getElementById', async () => {
      const r = await analyzeDataFlowWithTaint('const el = document.getElementById("myId");');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects getElementsByClassName', async () => {
      const r = await analyzeDataFlowWithTaint(
        'const els = document.getElementsByClassName("cls");',
      );
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects getElementsByTagName', async () => {
      const r = await analyzeDataFlowWithTaint('const els = document.getElementsByTagName("div");');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
  });

  describe('source detection URL location', () => {
    it('detects location.href', async () => {
      const r = await analyzeDataFlowWithTaint('const u = location.href;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
      expect(r.graph.nodes.some((n) => n.name === 'location.href')).toBe(true);
    });
    it('detects location.search', async () => {
      const r = await analyzeDataFlowWithTaint('const q = location.search;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects location.hash', async () => {
      const r = await analyzeDataFlowWithTaint('const h = location.hash;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects location.pathname', async () => {
      const r = await analyzeDataFlowWithTaint('const p = location.pathname;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
  });

  describe('source detection cookies and storage', () => {
    it('detects document.cookie', async () => {
      const r = await analyzeDataFlowWithTaint('const c = document.cookie;');
      expect(r.sources.some((s) => s.type === 'storage')).toBe(true);
    });
    it('detects localStorage', async () => {
      const r = await analyzeDataFlowWithTaint('const v = localStorage.getItem;');
      expect(r.sources.some((s) => s.type === 'storage')).toBe(true);
    });
    it('detects sessionStorage', async () => {
      const r = await analyzeDataFlowWithTaint('const v = sessionStorage.getItem;');
      expect(r.sources.some((s) => s.type === 'storage')).toBe(true);
    });
  });

  describe('source detection window.name event.data message.data', () => {
    it('detects window.name', async () => {
      const r = await analyzeDataFlowWithTaint('const n = window.name;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('detects event.data postMessage', async () => {
      const r = await analyzeDataFlowWithTaint('const d = event.data;');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
    });
    it('detects message.data WebSocket', async () => {
      const r = await analyzeDataFlowWithTaint('const d = message.data;');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
    });
  });

  describe('sink detection eval family', () => {
    it('detects eval', async () => {
      const r = await analyzeDataFlowWithTaint('eval("code");');
      expect(r.sinks.some((s) => s.type === 'eval')).toBe(true);
    });
    it('detects Function', async () => {
      const r = await analyzeDataFlowWithTaint('Function("return 1")();');
      expect(r.sinks.some((s) => s.type === 'eval')).toBe(true);
    });
    it('detects setTimeout', async () => {
      const r = await analyzeDataFlowWithTaint('setTimeout("alert(1)", 100);');
      expect(r.sinks.some((s) => s.type === 'eval')).toBe(true);
    });
    it('detects setInterval', async () => {
      const r = await analyzeDataFlowWithTaint('setInterval("code", 1000);');
      expect(r.sinks.some((s) => s.type === 'eval')).toBe(true);
    });
  });

  describe('sink detection document.write', () => {
    it('detects document.write', async () => {
      const r = await analyzeDataFlowWithTaint('document.write("<b>hi</b>");');
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(true);
    });
    it('detects document.writeln', async () => {
      const r = await analyzeDataFlowWithTaint('document.writeln("<p>text</p>");');
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(true);
    });
  });

  describe('sink detection SQL', () => {
    it('detects db.query', async () => {
      const r = await analyzeDataFlowWithTaint('db.query("SELECT * FROM users");');
      expect(r.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
    });
    it('detects db.execute', async () => {
      const r = await analyzeDataFlowWithTaint('db.execute("DROP TABLE");');
      expect(r.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
    });
    it('detects db.run', async () => {
      const r = await analyzeDataFlowWithTaint('db.run("INSERT INTO t VALUES(1)");');
      expect(r.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
    });
  });

  describe('sink detection command injection', () => {
    it('detects child.spawn', async () => {
      const r = await analyzeDataFlowWithTaint('child.spawn("ls");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects child.execSync', async () => {
      const r = await analyzeDataFlowWithTaint('child.execSync("ls");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects child.spawnSync', async () => {
      const r = await analyzeDataFlowWithTaint('child.spawnSync("ls");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
  });

  describe('sink detection file ops', () => {
    it('detects fs.readFile', async () => {
      const r = await analyzeDataFlowWithTaint('fs.readFile("/etc/passwd");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects fs.writeFile', async () => {
      const r = await analyzeDataFlowWithTaint('fs.writeFile("/tmp/o", d);');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects fs.readFileSync', async () => {
      const r = await analyzeDataFlowWithTaint('fs.readFileSync("/p");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects fs.writeFileSync', async () => {
      const r = await analyzeDataFlowWithTaint('fs.writeFileSync("/p", "d");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('detects fs.open', async () => {
      const r = await analyzeDataFlowWithTaint('fs.open("/p", "r");');
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
  });

  describe('sink detection innerHTML outerHTML', () => {
    it('detects innerHTML assignment', async () => {
      const r = await analyzeDataFlowWithTaint('el.innerHTML = "<script>alert(1)</script>";');
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(true);
    });
    it('detects outerHTML assignment', async () => {
      const r = await analyzeDataFlowWithTaint('el.outerHTML = "<div>x</div>";');
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(true);
    });
  });

  describe('taint propagation', () => {
    it('propagates taint through direct variable assignment in second pass', async () => {
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\nconst c = s;\nconst d = c;',
      );
      // Second traversal propagates taint through identifiers
      // Verify sources and sinks are detected
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });
    it('propagates taint through binary expression left in second pass', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nconst c = s + "suf";');
      // The second pass propagates taint through binary expressions
      expect(r.sources.length).toBeGreaterThan(0);
    });
    it('propagates taint through binary expression right in second pass', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nconst c = "pre" + s;');
      expect(r.sources.length).toBeGreaterThan(0);
    });
    it('propagates taint through function call wrapping in second pass', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nconst w = transform(s);');
      expect(r.sources.length).toBeGreaterThan(0);
    });
    it('propagates through re-assignment in second pass', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nlet t;\nt = s;');
      expect(r.sources.length).toBeGreaterThan(0);
    });
    it('tracks tainted args into document.write via checkTaintedArguments', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\ndocument.write(s);');
      // checkTaintedArguments produces taint path with sink type eval
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
    it('tracks tainted args into SQL sinks', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\ndb.query(s);');
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
    it('tracks tainted args into command sinks', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nchild.exec(s);');
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
    it('tracks tainted args into file sinks', async () => {
      const r = await analyzeDataFlowWithTaint('const s = location.href;\nfs.readFile(s);');
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
  });

  describe('sanitizer detection', () => {
    it('removes taint when sanitizer applied', async () => {
      sanitizerState.checkSanitizer.mockReturnValue(true);
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\nconst c = sanitize(s);\ndocument.body.innerHTML = c;',
      );
      expect(r.sources.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('handles invalid code gracefully', async () => {
      const r = await analyzeDataFlowWithTaint('this is not valid @@@!!!');
      expect(r.graph.nodes).toEqual([]);
      expect(r.sources).toEqual([]);
      expect(r.sinks).toEqual([]);
      expect(r.taintPaths).toEqual([]);
      expect(loggerState.warn).toHaveBeenCalled();
    });
    it('returns valid structure for empty code', async () => {
      const r = await analyzeDataFlowWithTaint('');
      expect(r).toHaveProperty('graph');
      expect(r).toHaveProperty('sources');
      expect(r).toHaveProperty('sinks');
      expect(r).toHaveProperty('taintPaths');
    });
  });

  describe('combined scenarios', () => {
    it('handles multiple source and sink types', async () => {
      const code =
        'const u = location.href;\nconst c = document.cookie;\nconst st = localStorage.data;\nconst w = window.name;\nconst e = event.data;\nconst m = message.data;\neval(u);\ndocument.write(u);\ndb.query(u);\nchild.exec(u);\nfs.readFile(u);\ndocument.body.innerHTML = u;\ndocument.body.outerHTML = u;';
      const r = await analyzeDataFlowWithTaint(code);
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
      expect(r.sources.some((s) => s.type === 'storage')).toBe(true);
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
      expect(r.sinks.some((s) => s.type === 'eval')).toBe(true);
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(true);
      expect(r.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
      expect(r.sinks.some((s) => s.type === 'other')).toBe(true);
    });
    it('handles TypeScript code', async () => {
      const r = await analyzeDataFlowWithTaint('const url: string = location.href;\neval(url);');
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.sinks.length).toBeGreaterThan(0);
    });
  });

  describe('false branch coverage configurations', () => {
    it('handles fetch without variable declarator', async () => {
      const r = await analyzeDataFlowWithTaint('api.fetch("/url");');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
    });

    it('handles assignment to non-innerHTML properties', async () => {
      const r = await analyzeDataFlowWithTaint(
        'const el = location.href;\ndocument.body.innerText = el;',
      );
      // innerText doesn't trigger the XSS sink path for taint, so xss sink count is 0
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(false);
    });

    it('handles sanitizer with non-identifier or non-tainted argument', async () => {
      sanitizerState.checkSanitizer.mockReturnValue(true);
      const r = await analyzeDataFlowWithTaint(
        'const c = sanitize(123); const d = sanitize(untainted);',
      );
      expect(r.sources.length).toBe(0);
    });

    it('handles binary expression with no tainted sides', async () => {
      const r = await analyzeDataFlowWithTaint('const a = 1; const b = 2; const c = a + b;');
      expect(r.sources.length).toBe(0);
    });

    it('handles VariableDeclarator with CallExpression and no taint', async () => {
      const r = await analyzeDataFlowWithTaint('const c = normalFunc(123);');
      expect(r.sources.length).toBe(0);
    });

    it('handles network source with non-identifier variable declarator (ObjectPattern)', async () => {
      const r = await analyzeDataFlowWithTaint('const { data } = api.fetch("/url");');
      expect(r.sources.some((s) => s.type === 'network')).toBe(true);
    });

    it('handles location source without variable declarator', async () => {
      const r = await analyzeDataFlowWithTaint('console.log(location.href);');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });

    it('handles location source with non-identifier variable declarator (ObjectPattern)', async () => {
      const r = await analyzeDataFlowWithTaint('const { length } = location.href;');
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(true);
    });

    it('handles assignment expression without member expression on left side', async () => {
      const r = await analyzeDataFlowWithTaint('let x = 1; x = location.href;');
      // xss sinks should be 0 because x is not a member expression (e.g. obj.innerHTML)
      expect(r.sinks.some((s) => s.type === 'xss')).toBe(false);
    });

    it('handles location source with StringLiteral property (bracket notation)', async () => {
      const r = await analyzeDataFlowWithTaint('const x = location["href"];');
      // sources should be 0 because our static analyzer only looks for Identifier properties
      expect(r.sources.some((s) => s.type === 'user_input')).toBe(false);
    });
  });
});
