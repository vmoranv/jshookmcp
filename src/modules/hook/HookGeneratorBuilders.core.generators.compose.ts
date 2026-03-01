import type { HookResult } from '../../types/index.js';

export function generateHookChain(hooks: HookResult[]): string {
  const scripts = hooks.map((h) => h.script).join('\n\n');
  return `

${scripts}

console.log('[Hook Chain] All ${hooks.length} hooks initialized');
`.trim();
}

