import type { ObfuscationType } from '@internal-types/index';

const HEX_HEAVY_RE = /(?:\\x[0-9a-fA-F]{2}){6,}/;
const HEX_LITERALS_RE = /\b0x[0-9a-fA-F]{3,}\b/g;
const UNICODE_ESCAPE_RE = /(?:\\u[0-9a-fA-F]{4}){4,}/;
const JSFUCK_RE = /^\s*[\[\]()+!]{20,}\s*$/m;
const AAENCODE_RE = /ﾟωﾟ|ﾟΘﾟ|ﾟｰﾟ|ﾟ-ﾟ/;
const JJENCODE_RE = /\$=~\[\]|_\$\[/;
const PACKER_RE = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;
const EVAL_FN_RE = /eval\s*\(\s*(unescape|atob|decodeURIComponent)\s*\(/;
const SELF_MOD_RE = /document\.write\s*\(\s*unescape|eval\s*\(.*?eval/s;
const INVISIBLE_UNICODE_RE = /[\u200b-\u200f\u202a-\u202e\ufeff\u2060-\u2064]/;
const CFF_RE = /while\s*\(\s*true\s*\)\s*\{[\s\S]{0,200}switch\s*\(/i;
const STRING_ARRAY_ROTATION_RE =
  /\(\s*function\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[\s\S]{0,400}\.push\s*\(\s*\w+\.shift\s*\(\s*\)\s*\)/;
const DEAD_CODE_RE = /if\s*\(\s*(true|false|0x[0-9]+\s*[><=!]+\s*0x[0-9]+)\s*\)/g;
const OPAQUE_PREDICATE_RE = /if\s*\(\s*[\w$]+\s*\(\s*\)\s*\)\s*\{[\s\S]{0,100}\}/;
const WEBPACK_RE = /__webpack_require__|webpackJsonp|__webpack_exports__|webpack_module/;
const BROWSERIFY_RE = /require\s*=\s*function\s*\w*\s*\(\s*t\s*\)|\/\*\s*browserify\s*\*\//i;
const ROLLUP_VITE_RE = /__vitePreload|__rollup_|\/\*\s*@vite\b/;
const OBFUSCATOR_IO_RE = /_0x[0-9a-f]{4,}\s*\[|var\s+_0x[0-9a-f]+\s*=/i;
const JSDECODE_RE = /\x01|\x02|_(0x[a-f0-9]+)\s*=\s*\[/;
const SCRAMBLER_RE = /\$⁠|‌|‍|‎|‏/;
const HIDDEN_PROP_RE =
  /Object\.defineProperty\s*\(\s*\w+\s*,\s*["'][\w$]+["']\s*,\s*\{[\s\S]*?hidden[\s\S]*?\}/i;
const ENCODED_CALL_RE = /\[\s*(?:["'](?:[^"'\\]|\\.)*["']|\d+)\s*\]\s*\([^)]*\)/;
const PROXY_OBF_RE = /Proxy\s*\(\s*(?:new\s+Function|\(function)/;
const WITH_OBF_RE = /with\s*\(\s*\{[\s\S]*?\}/;

export function detectObfuscationType(code: string): ObfuscationType[] {
  const types = new Set<ObfuscationType>();

  if (OBFUSCATOR_IO_RE.test(code)) {
    types.add('javascript-obfuscator');
  }

  if (WEBPACK_RE.test(code)) {
    types.add('webpack');
  }

  if (BROWSERIFY_RE.test(code)) {
    types.add('unknown');
  }

  if (ROLLUP_VITE_RE.test(code)) {
    types.add('unknown');
  }

  if (code.length > 1000 && !code.includes('\n')) {
    types.add('uglify');
  }

  if (PACKER_RE.test(code)) {
    types.add('packer');
  }

  if (EVAL_FN_RE.test(code) || SELF_MOD_RE.test(code)) {
    types.add('eval-obfuscation');
  }

  if (code.includes('eval') && code.includes('Function')) {
    types.add('vm-protection');
  }

  if (CFF_RE.test(code)) {
    types.add('control-flow-flattening');
  }

  if (STRING_ARRAY_ROTATION_RE.test(code)) {
    types.add('string-array-rotation');
  }

  const deadMatches = code.match(DEAD_CODE_RE);
  if (deadMatches && deadMatches.length >= 3) {
    types.add('dead-code-injection');
  }

  if (OPAQUE_PREDICATE_RE.test(code)) {
    types.add('opaque-predicates');
  }

  if (JSFUCK_RE.test(code)) {
    types.add('jsfuck');
  }

  if (AAENCODE_RE.test(code)) {
    types.add('aaencode');
  }

  if (JJENCODE_RE.test(code)) {
    types.add('jjencode');
  }

  if (INVISIBLE_UNICODE_RE.test(code)) {
    types.add('invisible-unicode');
  }

  if (HEX_HEAVY_RE.test(code)) {
    types.add('hex-encoding');
  }

  if (UNICODE_ESCAPE_RE.test(code)) {
    types.add('hex-encoding');
  }

  const base64Candidates = code.match(/["'`]([A-Za-z0-9+/]{40,}={0,2})["'`]/g);
  if (base64Candidates && base64Candidates.length >= 2) {
    types.add('base64-encoding');
  }

  const hexLiterals = code.match(HEX_LITERALS_RE);
  if (hexLiterals && hexLiterals.length >= 10) {
    types.add('hex-encoding');
  }

  if (JSDECODE_RE.test(code)) {
    types.add('jsdecode');
  }

  if (SCRAMBLER_RE.test(code)) {
    types.add('jscrambler');
  }

  if (HIDDEN_PROP_RE.test(code)) {
    types.add('hidden-properties');
  }

  if (ENCODED_CALL_RE.test(code)) {
    types.add('encoded-calls');
  }

  if (PROXY_OBF_RE.test(code)) {
    types.add('proxy-obfuscation');
  }

  if (WITH_OBF_RE.test(code)) {
    types.add('with-obfuscation');
  }

  if (types.size === 0) {
    types.add('unknown');
  }

  return Array.from(types);
}

export function calculateReadabilityScore(code: string): number {
  let score = 0;

  if (code.includes('\n')) {
    score += 15;
    const lines = code.split('\n');
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0).length;
    if (nonEmptyLines > 5) score += 5;
  }

  const identifiers = code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? [];
  const meaningfulCount = identifiers.filter((n) => n.length >= 4).length;
  const ratio = identifiers.length > 0 ? meaningfulCount / identifiers.length : 0;
  score += Math.round(ratio * 25);

  const whitespaceRatio = (code.length - code.replace(/\s/g, '').length) / code.length;
  if (whitespaceRatio >= 0.1) score += 10;
  if (whitespaceRatio >= 0.2) score += 5;

  if (!/_0x[0-9a-f]+/i.test(code)) score += 10;
  if (!HEX_HEAVY_RE.test(code)) score += 5;
  if (!UNICODE_ESCAPE_RE.test(code)) score += 5;
  if (!JSFUCK_RE.test(code)) score += 5;

  const commentMatches = code.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g);
  if (commentMatches && commentMatches.length > 0) score += 5;

  const keywordCount = (
    code.match(/\b(function|const|let|var|return|if|else|for|while|class|import|export)\b/g) ?? []
  ).length;
  const density = code.length > 0 ? keywordCount / (code.length / 100) : 0;
  if (density >= 1) score += 5;

  return Math.min(score, 100);
}
