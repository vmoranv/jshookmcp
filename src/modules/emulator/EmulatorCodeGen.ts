import type { DetectedEnvironmentVariables, MissingAPI, EmulationCode } from '../../types/index.js';

export function generateEmulationCode(
  manifest: Record<string, unknown>,
  targetRuntime: 'nodejs' | 'python' | 'both',
  includeComments: boolean
): EmulationCode {
  let nodejs = '';
  let python = '';

  if (targetRuntime === 'nodejs' || targetRuntime === 'both') {
    nodejs = generateNodeJSCode(manifest, includeComments);
  }

  if (targetRuntime === 'python' || targetRuntime === 'both') {
    python = generatePythonCode(manifest, includeComments);
  }

  return { nodejs, python };
}

export function generateNodeJSCode(
  manifest: Record<string, unknown>,
  includeComments: boolean
): string {
  const lines: string[] = [];

  if (includeComments) {
    lines.push('/**');
    lines.push(' *  (Node.js)');
    lines.push(' *  ' + new Date().toISOString());
    lines.push(' * ');
    lines.push(' * Environment setup for VM-protected JavaScript (JSVMP etc.)');
    lines.push(' */');
    lines.push('');
  }

  lines.push('// === Base Variable Declarations ===');
  lines.push('const window = global;');
  lines.push('const document = {};');
  lines.push('const navigator = {};');
  lines.push('const location = {};');
  lines.push('const screen = {};');
  lines.push('');

  if (includeComments) {
    lines.push('// === Window Property Aliases ===');
  }
  lines.push('window.window = window;');
  lines.push('window.self = window;');
  lines.push('window.top = window;');
  lines.push('window.parent = window;');
  lines.push('window.document = document;');
  lines.push('window.navigator = navigator;');
  lines.push('window.location = location;');
  lines.push('window.screen = screen;');
  lines.push('');

  if (includeComments) {
    lines.push('// === Timer & Animation Functions ===');
  }
  lines.push('window.requestAnimationFrame = function(callback) {');
  lines.push('  return setTimeout(callback, 16);');
  lines.push('};');
  lines.push('');
  lines.push('window.cancelAnimationFrame = function(id) {');
  lines.push('  clearTimeout(id);');
  lines.push('};');
  lines.push('');
  lines.push('window.setTimeout = setTimeout;');
  lines.push('window.setInterval = setInterval;');
  lines.push('window.clearTimeout = clearTimeout;');
  lines.push('window.clearInterval = clearInterval;');
  lines.push('');

  if (includeComments) {
    lines.push('// === Network Stubs ===');
  }
  lines.push('window.XMLHttpRequest = function() {');
  lines.push('  this.open = function() {};');
  lines.push('  this.send = function() {};');
  lines.push('  this.setRequestHeader = function() {};');
  lines.push('};');
  lines.push('');

  if (includeComments) {
    lines.push('// === SDK Extensions ===');
  }
  lines.push('window._sdkGlueVersionMap = {};');
  lines.push('');

  if (includeComments) {
    lines.push('// === Chrome Object ===');
  }
  lines.push('window.chrome = {');
  lines.push('  runtime: {},');
  lines.push('  loadTimes: function() {},');
  lines.push('  csi: function() {},');
  lines.push('  app: {}');
  lines.push('};');
  lines.push('');

  if (includeComments) {
    lines.push('// === Manifest Variables ===');
  }

  const categories = categorizeManifest(manifest);

  for (const [category, vars] of Object.entries(categories)) {
    if (vars.length === 0) continue;

    if (includeComments) {
      lines.push(`// --- ${category} ---`);
    }

    for (const [path, value] of vars) {
      const parts = path.split('.');
      if (parts.length === 1) continue;

      const objName = parts[0];
      const propPath = parts.slice(1).join('.');

      if (parts.length === 2) {
        lines.push(`${objName}.${propPath} = ${formatValueForJS(value)};`);
      } else {
        const parentPath = parts.slice(0, -1).join('.');
        const lastProp = parts[parts.length - 1];
        lines.push(`if (!${parentPath}) ${parentPath} = {};`);
        lines.push(`${parentPath}.${lastProp} = ${formatValueForJS(value)};`);
      }
    }

    lines.push('');
  }

  if (includeComments) {
    lines.push('// === Exports ===');
  }
  // Intentionally CommonJS in generated output for require()-based runners.
  lines.push('// Intentionally CommonJS export for compatibility with require()-based loaders.');
  lines.push('module.exports = { window, document, navigator, location, screen };');
  lines.push('');

  return lines.join('\n');
}

export function generatePythonCode(
  manifest: Record<string, unknown>,
  includeComments: boolean
): string {
  const lines: string[] = [];

  if (includeComments) {
    lines.push('"""');
    lines.push(' (Python + execjs/PyExecJS)');
    lines.push(' ' + new Date().toISOString());
    lines.push('');
    lines.push('// VM-protected JavaScript (JSVMP etc.) environment');
    lines.push('');
    lines.push(':');
    lines.push('1. pip install PyExecJS');
    lines.push('2. JS obfuscated.js');
    lines.push('3. ');
    lines.push('"""');
    lines.push('');
  }

  lines.push('import execjs');
  lines.push('');

  if (includeComments) {
    lines.push('# ========== Environment Variables ==========');
  }

  lines.push('env_code = """');
  lines.push('');
  lines.push('const window = global;');
  lines.push('const document = {};');
  lines.push('const navigator = {};');
  lines.push('const location = {};');
  lines.push('const screen = {};');
  lines.push('');

  lines.push('');
  lines.push('window.window = window;');
  lines.push('window.self = window;');
  lines.push('window.top = window;');
  lines.push('window.parent = window;');
  lines.push('window.document = document;');
  lines.push('window.navigator = navigator;');
  lines.push('window.location = location;');
  lines.push('window.screen = screen;');
  lines.push('');

  lines.push('');
  lines.push('window.requestAnimationFrame = function(callback) {');
  lines.push('  return setTimeout(callback, 16);');
  lines.push('};');
  lines.push('');
  lines.push('window.cancelAnimationFrame = function(id) {');
  lines.push('  clearTimeout(id);');
  lines.push('};');
  lines.push('');
  lines.push('window.setTimeout = setTimeout;');
  lines.push('window.setInterval = setInterval;');
  lines.push('window.clearTimeout = clearTimeout;');
  lines.push('window.clearInterval = clearInterval;');
  lines.push('');

  lines.push('');
  lines.push('window.XMLHttpRequest = function() {');
  lines.push('  this.open = function() {};');
  lines.push('  this.send = function() {};');
  lines.push('  this.setRequestHeader = function() {};');
  lines.push('};');
  lines.push('');

  lines.push('');
  lines.push('window._sdkGlueVersionMap = {};');
  lines.push('');

  lines.push('');
  lines.push('window.chrome = {');
  lines.push('  runtime: {},');
  lines.push('  loadTimes: function() {},');
  lines.push('  csi: function() {},');
  lines.push('  app: {}');
  lines.push('};');
  lines.push('');

  lines.push('');
  const categories = categorizeManifest(manifest);

  for (const [category, vars] of Object.entries(categories)) {
    if (vars.length === 0) continue;

    lines.push(`// ${category}`);

    for (const [path, value] of vars) {
      const parts = path.split('.');
      if (parts.length === 1) continue;

      const objName = parts[0];
      const propPath = parts.slice(1).join('.');

      if (parts.length === 2) {
        lines.push(`${objName}.${propPath} = ${formatValueForJS(value)};`);
      } else {
        const parentPath = parts.slice(0, -1).join('.');
        const lastProp = parts[parts.length - 1];
        lines.push(`if (!${parentPath}) ${parentPath} = {};`);
        lines.push(`${parentPath}.${lastProp} = ${formatValueForJS(value)};`);
      }
    }

    lines.push('');
  }

  lines.push('"""');
  lines.push('');

  if (includeComments) {
    lines.push('# ========== Browser JavaScript APIs ==========');
  }

  lines.push('# JS');
  lines.push('with open("obfuscated.js", "r", encoding="utf-8") as f:');
  lines.push('    obfuscated_code = f.read()');
  lines.push('');

  lines.push('# ');
  lines.push('full_code = env_code + obfuscated_code');
  lines.push('');

  if (includeComments) {
    lines.push('# ========== JavaScript Utilities ==========');
  }

  lines.push('# JavaScript');
  lines.push('ctx = execjs.compile(full_code)');
  lines.push('');

  if (includeComments) {
    lines.push('# ========== Special Variables ==========');
    lines.push('# Special: a_bogus parameter');
  }

  lines.push('def get_a_bogus(url, user_agent):');
  lines.push('    """');
  lines.push('    JSsigna_bogus');
  lines.push('    ');
  lines.push('    Args:');
  lines.push('        url: URL');
  lines.push('        user_agent: User-Agent');
  lines.push('    ');
  lines.push('    Returns:');
  lines.push('        a_bogus');
  lines.push('    """');
  lines.push('    try:');
  lines.push('        # window.byted_acrawler.sign');
  lines.push('        result = ctx.call("window.byted_acrawler.sign", {');
  lines.push('            "url": url,');
  lines.push('            "user_agent": user_agent');
  lines.push('        })');
  lines.push('        return result');
  lines.push('    except Exception as e:');
  lines.push('        print(f": {e}")');
  lines.push('        return None');
  lines.push('');

  if (includeComments) {
    lines.push('# ========== Network Requests ==========');
  }

  lines.push('if __name__ == "__main__":');
  lines.push('    # ');
  lines.push('    test_url = "https://www.example.com"');
  lines.push('    test_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"');
  lines.push('    ');
  lines.push('    # a_bogus');
  lines.push('    a_bogus = get_a_bogus(test_url, test_ua)');
  lines.push('    print(f"a_bogus: {a_bogus}")');
  lines.push('');

  return lines.join('\n');
}

export function categorizeManifest(
  manifest: Record<string, unknown>
): Record<string, Array<[string, unknown]>> {
  const categories: Record<string, Array<[string, unknown]>> = {
    window: [],
    document: [],
    navigator: [],
    location: [],
    screen: [],
    other: [],
  };

  for (const [path, value] of Object.entries(manifest)) {
    if (path.startsWith('window.')) {
      categories.window!.push([path, value]);
    } else if (path.startsWith('document.')) {
      categories.document!.push([path, value]);
    } else if (path.startsWith('navigator.')) {
      categories.navigator!.push([path, value]);
    } else if (path.startsWith('location.')) {
      categories.location!.push([path, value]);
    } else if (path.startsWith('screen.')) {
      categories.screen!.push([path, value]);
    } else {
      categories.other!.push([path, value]);
    }
  }

  return categories;
}

function isFunctionMarker(value: unknown): value is { __type: 'Function' } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    '__type' in value &&
    (value as { __type?: unknown }).__type === 'Function'
  );
}

export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'string') {
    const stringValue = value as string;
    return `"${stringValue.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  if (type === 'number' || type === 'boolean') {
    return String(value);
  }
  if (type === 'function' || value === '[Function]') {
    return 'function() {}';
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((item) => formatValue(item));
    return `[${items.join(', ')}]`;
  }

  if (type === 'object') {
    const entries = Object.entries(value).slice(0, 20);
    const props = entries.map(([k, v]) => `${k}: ${formatValue(v)}`);
    return `{${props.join(', ')}}`;
  }

  return 'null';
}

export function formatValueForJS(value: unknown, depth = 0): string {
  if (depth > 5) return 'null';

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'string') {
    if (value === '[Function]' || value.startsWith('[Function:')) {
      return 'function() {}';
    }
    if (value === '[Circular Reference]') {
      return '{}';
    }
    if (value === '[Max Depth]' || value === '[Error]' || value.startsWith('[Error:')) {
      return 'null';
    }
    if (value === '[Getter Error]') {
      return 'undefined';
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return isNaN(value) ? 'NaN' : isFinite(value) ? String(value) : 'null';
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (isFunctionMarker(value)) {
    return 'function() {}';
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 50)
      .map((item) => formatValueForJS(item, depth + 1))
      .filter((item) => item !== 'undefined');
    return `[${items.join(', ')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([k]) => !k.startsWith('__'))
      .slice(0, 100);

    if (entries.length === 0) {
      return '{}';
    }

    const props = entries
      .map(([k, v]) => {
        const formattedValue = formatValueForJS(v, depth + 1);
        const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return `${key}: ${formattedValue}`;
      })
      .filter((prop) => !prop.endsWith(': undefined'));

    return `{${props.join(', ')}}`;
  }

  return 'null';
}

export function generateRecommendations(
  detected: DetectedEnvironmentVariables,
  missingAPIs: MissingAPI[]
): string[] {
  const recommendations: string[] = [];

  const totalVars = Object.values(detected).reduce((sum, arr) => sum + arr.length, 0);
  if (totalVars > 50) {
    recommendations.push('Enable environment emulation for better compatibility');
  }

  if (missingAPIs.length > 0) {
    recommendations.push(` ${missingAPIs.length} API`);
  }

  return recommendations;
}
