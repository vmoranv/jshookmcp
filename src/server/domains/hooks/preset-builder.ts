export function buildHookCode(
  name: string,
  body: string,
  captureStack: boolean,
  logToConsole: boolean
): string {
  const stackCode = captureStack
    ? `const __stack = new Error().stack?.split('\\n').slice(1,4).join(' | ') || '';`
    : `const __stack = '';`;
  const logFn = logToConsole ? `console.log(__msg + (__stack ? ' | Stack: ' + __stack : ''));` : ``;
  return `
(function() {
  if (window.__hookPresets === undefined) window.__hookPresets = {};
  if (window.__hookPresets['${name}']) return;
  ${body.replace(/\{\{STACK_CODE\}\}/g, stackCode).replace(/\{\{LOG_FN\}\}/g, logFn)}
  window.__hookPresets['${name}'] = true;
  window.__aiHooks = window.__aiHooks || {};
  window.__aiHooks['preset-${name}'] = window.__aiHooks['preset-${name}'] || [];
})();`;
}

export type PresetEntry = {
  description: string;
  buildCode: (captureStack: boolean, logToConsole: boolean) => string;
};
