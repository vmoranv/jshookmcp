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

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/analyzer/SecurityCodeAnalyzer', () => ({
  checkSanitizer: sanitizerState.checkSanitizer,
}));

import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';

describe('CodeAnalyzer data flow analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks taint from browser-controlled sources into xss and eval sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.href;
      const cleaned = sanitize(source);
      document.body.innerHTML = source;
      eval(source);
    `);

    expect(result.sources.some((source) => source.type === 'user_input')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'xss')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'eval')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'eval')).toBe(true);
  });

  it('ignores legacy extra arguments and keeps local taint analysis', async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          taintPaths: [
            {
              source: { type: 'network', location: { file: 'current', line: 99 } },
              sink: { type: 'eval', location: { file: 'current', line: 5 } },
              path: [
                { file: 'current', line: 99 },
                { file: 'current', line: 5 },
              ],
            },
          ],
        }),
      }),
    };

    const result = await (analyzeDataFlowWithTaint as any)(
      `
        const source = location.href;
        document.body.innerHTML = source;
      `,
      llm,
    );

    expect(llm.chat).not.toHaveBeenCalled();
    expect(result.taintPaths.length).toBeGreaterThan(0);
    // @ts-expect-error — auto-suppressed [TS7006]
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
  });

  it('detects network and dom sources, and variable propagation', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const netSource = axios.get('http://example.com');
      let domSource = document.querySelector('#input');
      
      const taintedVar = netSource;
      let taintedVar2;
      taintedVar2 = domSource;
      
      eval(taintedVar);
      eval(taintedVar2);
      setTimeout(domSource);
      setInterval(netSource);
      new Function(netSource);
    `);

    expect(result.sources.some((s) => s.type === 'network')).toBe(true);
    expect(result.sources.some((s) => s.type === 'user_input')).toBe(true);
    expect(result.sinks.some((s) => s.type === 'eval')).toBe(true);
    expect(result.taintPaths.length).toBeGreaterThan(0);
  });

  it('detects sql, command, and file sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.search;

      db.query(source);
      mysql.execute(source);
      client.exec(source);
      runner.run(source);

      child_process.spawn(source);
      shell.execSync(source);
      shell.spawnSync(source);

      fs.readFileSync(source);
      fs.writeFileSync(source);
      fs.readFile(source);
      fs.writeFile(source);
      fs.open(source);
    `);

    expect(result.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
    expect(result.sinks.some((s) => s.type === 'other')).toBe(true);
  });

  it('detects location, cookie, window.name, and storage sources', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const s1 = location.href;
      const s2 = location.search;
      const s3 = location.hash;
      const s4 = location.pathname;
      const s5 = document.cookie;
      const s6 = window.name;
      const s7 = localStorage.getItem('k');
      const s8 = sessionStorage.getItem('k');
      
      eval(s1);
      eval(s2);
      eval(s3);
      eval(s4);
      eval(s5);
      eval(s6);
      eval(s7);
      eval(s8);
    `);

    expect(result.sources.some((s) => s.type === 'user_input')).toBe(true);
  });

  it('handles identifier in sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.hash;
      
      eval(source);
    `);

    expect(result.taintPaths.length).toBeGreaterThanOrEqual(1);
  });

  it('properly recognizes sanitizers', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.search;
      // Real sanitizers defined in the module set
      const clean1 = DOMPurify.sanitize(source);
      const clean2 = Validator.escape(source); // wait Validator isn't in set, validator.escape is
      const clean3 = validator.escape(source);
      const clean4 = xss(source);
      const clean5 = sanitizeHtml(source);
      
      eval(clean1);
      eval(clean3);
      eval(clean4);
      eval(clean5);
    `);

    // Taint should not reach eval because arguments were sanitized
    // Also tests CallExpression inside checkTaintedArguments when iterating args
    expect(result.taintPaths.length).toBe(0);
  });
});
