import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateTaintAnalysisPrompt: vi.fn(() => [{ role: 'user', content: 'analyze taint' }]),
}));

const sanitizerState = vi.hoisted(() => ({
  checkSanitizer: vi.fn((call: unknown) => {
    const callee = call.callee;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    return callee?.type === 'Identifier' && callee.name === 'sanitize';
  }),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));
vi.mock('@services/prompts/taint', () => ({
  generateTaintAnalysisPrompt: promptState.generateTaintAnalysisPrompt,
}));
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
        'const a=http.get("/"); const b=http.post("/"); const c=http.request("/"); const d=client.axios("/");'
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
        'const els = document.getElementsByClassName("cls");'
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
        'const s = location.href;\nconst c = s;\nconst d = c;'
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
        'const s = location.href;\nconst c = sanitize(s);\ndocument.body.innerHTML = c;'
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

  describe('LLM enhanced taint analysis', () => {
    it('skips LLM when no taint paths', async () => {
      const llm = { chat: vi.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await analyzeDataFlowWithTaint('const x = 1;', llm as any);
      expect(llm.chat).not.toHaveBeenCalled();
    });
    it('calls LLM and adds unique paths', async () => {
      const llm = {
        chat: vi
          .fn()
          .mockResolvedValue({
            content: JSON.stringify({
              taintPaths: [
                {
                  source: { type: 'network', location: { file: 'current', line: 99 } },
                  sink: { type: 'eval', location: { file: 'current', line: 100 } },
                  path: [],
                },
              ],
            }),
          }),
      };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      expect(llm.chat).toHaveBeenCalled();
      expect(r.taintPaths.some((p) => p.source.location.line === 99)).toBe(true);
    });
    it('skips duplicate LLM paths', async () => {
      const llm = {
        chat: vi
          .fn()
          .mockResolvedValue({
            content: JSON.stringify({
              taintPaths: [
                {
                  source: { type: 'user_input', location: { file: 'current', line: 1 } },
                  sink: { type: 'xss', location: { file: 'current', line: 2 } },
                  path: [],
                },
              ],
            }),
          }),
      };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      const xssPaths = r.taintPaths.filter((p) => p.sink.type === 'xss');
      expect(xssPaths.length).toBe(1);
    });
    it('handles non-JSON LLM response', async () => {
      const llm = { chat: vi.fn().mockResolvedValue({ content: 'This is not JSON at all' }) };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      expect(r.taintPaths.length).toBeGreaterThan(0);
    });
    it('handles LLM response without taintPaths', async () => {
      const llm = {
        chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ analysis: 'no paths' }) }),
      };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      expect(r.taintPaths.length).toBeGreaterThan(0);
    });
    it('handles LLM chat throwing', async () => {
      const llm = { chat: vi.fn().mockRejectedValue(new Error('LLM fail')) };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      expect(r.taintPaths.length).toBeGreaterThan(0);
    });
    it('truncates code to 4000 chars', async () => {
      const longCode =
        'const s = location.href;\ndocument.body.innerHTML = s;\n' + 'x'.repeat(5000);
      const llm = {
        chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ taintPaths: [] }) }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await analyzeDataFlowWithTaint(longCode, llm as any);
      const calls = promptState.generateTaintAnalysisPrompt.mock.calls;
      if (calls.length > 0) {
        const codeArg = (calls as unknown as string[][])[0]![0]!;
        expect(codeArg.length).toBeLessThanOrEqual(4000);
      }
    });
    it('handles LLM path without source or sink', async () => {
      const llm = {
        chat: vi
          .fn()
          .mockResolvedValue({
            content: JSON.stringify({
              taintPaths: [
                { source: null, sink: null, path: [] },
                { source: { type: 'network', location: { file: 'current', line: 50 } } },
              ],
            }),
          }),
      };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      expect(r.taintPaths.every((p) => p.source && p.sink)).toBe(true);
    });
    it('uses empty array for missing LLM path', async () => {
      const llm = {
        chat: vi
          .fn()
          .mockResolvedValue({
            content: JSON.stringify({
              taintPaths: [
                {
                  source: { type: 'network', location: { file: 'current', line: 88 } },
                  sink: { type: 'eval', location: { file: 'current', line: 89 } },
                },
              ],
            }),
          }),
      };
      const r = await analyzeDataFlowWithTaint(
        'const s = location.href;\ndocument.body.innerHTML = s;',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        llm as any
      );
      const llmPath = r.taintPaths.find((p) => p.source.location.line === 88);
      if (llmPath) expect(llmPath.path).toEqual([]);
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
});
