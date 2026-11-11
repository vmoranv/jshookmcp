/**
 * Debugger domain benchmark (offline blackbox pattern subset — no live browser required).
 *
 * Ground truth:
 *  - blackbox_add: normalizes shell wildcard (e.g. *react*.js -> .*react.*\.js) into regex
 *  - blackbox_add_common: installs 13 standard vendor library patterns (react, vue, lodash, etc.)
 *  - blackbox_list: returns all active blackboxed regex patterns in deterministic array
 */
import { BlackboxHandlers } from '@server/domains/debugger/handlers/blackbox-handlers';
import { BlackboxManager } from '@modules/debugger/BlackboxManager';
import { expectSuccess, type BenchSuite } from '../harness';

function createBlackboxFixture() {
  const cdpSession = {
    send: async () => ({}),
  } as never;
  const blackboxManager = new BlackboxManager(cdpSession);
  const debuggerManager = {
    ensureAdvancedFeatures: async () => {},
    getBlackboxManager: () => blackboxManager,
  } as never;
  const handlers = new BlackboxHandlers({ debuggerManager });
  return { blackboxManager, handlers };
}

export const debuggerSuite: BenchSuite = {
  name: 'debugger-blackbox',
  domain: 'debugger',
  description:
    'Offline-pure blackbox pattern registry: wildcard normalization, common library presets, pattern listing',
  cases: [
    {
      name: 'blackbox_add/normalizes-wildcard-pattern',
      tool: 'blackbox_add',
      origin: 'homemade',
      reference: 'normalizes shell wildcard *react*.js to regex pattern and confirms addition',
      run: () => {
        const { handlers } = createBlackboxFixture();
        return handlers.handleBlackboxAdd({ urlPattern: '*react*.js' });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true || b.urlPattern !== '*react*.js')
          return `unexpected blackbox_add response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'blackbox_add_common/installs-vendor-presets',
      tool: 'blackbox_add_common',
      origin: 'homemade',
      reference:
        'installs standard vendor library patterns (jquery, react, vue, angular, lodash, webpack)',
      run: () => {
        const { handlers } = createBlackboxFixture();
        return handlers.handleBlackboxAddCommon({});
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true)
          return `unexpected blackbox_add_common response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'blackbox_list/enumerates-patterns',
      tool: 'blackbox_list',
      origin: 'homemade',
      reference: 'lists all registered normalized blackbox patterns',
      run: async () => {
        const { handlers } = createBlackboxFixture();
        await handlers.handleBlackboxAddCommon({});
        await handlers.handleBlackboxAdd({ urlPattern: '*custom-auth*.js' });
        return handlers.handleBlackboxList({});
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true || !Array.isArray(b.patterns))
          return `expected patterns array, got: ${JSON.stringify(b)}`;
        if (b.patterns.length < 13)
          return `expected >=13 patterns after add_common + custom, got ${b.patterns.length}`;
        const text = JSON.stringify(b.patterns);
        if (!text.includes('custom-auth')) return 'missing custom pattern in blackbox_list output';
        return true;
      },
    },
  ],
};
