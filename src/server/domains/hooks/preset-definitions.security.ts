import type { PresetEntry } from './preset-builder.js';
import { buildHookCode } from './preset-builder.js';

export const SECURITY_PRESETS: Record<string, PresetEntry> = {
  'anti-debug-bypass': {
    description:
      ' Block anti-debugging: setInterval/setTimeout debugger traps, console.clear spam, timing attacks (performance.now freeze), outerWidth/outerHeight devtools detection',
    buildCode: (cs, lc) =>
      buildHookCode(
        'anti-debug-bypass',
        `
  window.__aiHooks['preset-anti-debug-bypass'] = window.__aiHooks['preset-anti-debug-bypass'] || [];
  // 1. Block setInterval/setTimeout containing debugger/devtools
  const _si = window.setInterval;
  window.setInterval = function(fn, delay) {
    const rest = Array.prototype.slice.call(arguments, 2);
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    if (fnStr.includes('debugger') || fnStr.includes('devtools') || fnStr.includes('disable-devtool')) {
      window.__aiHooks['preset-anti-debug-bypass'].push({ blocked: 'setInterval', fn: fnStr.substring(0, 200), ts: Date.now() });
      return -1;
    }
    return _si.apply(this, [fn, delay].concat(rest));
  };
  const _st = window.setTimeout;
  window.setTimeout = function(fn, delay) {
    const rest = Array.prototype.slice.call(arguments, 2);
    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
    if (fnStr.includes('debugger') || fnStr.includes('devtools')) {
      window.__aiHooks['preset-anti-debug-bypass'].push({ blocked: 'setTimeout', fn: fnStr.substring(0, 200), ts: Date.now() });
      return -1;
    }
    return _st.apply(this, [fn, delay].concat(rest));
  };
  // 2. Suppress console.clear spam
  console.clear = function() {
    window.__aiHooks['preset-anti-debug-bypass'].push({ blocked: 'console.clear', ts: Date.now() });
  };
  // 3. Freeze performance.now to defeat timing attacks
  const _pn = performance.now.bind(performance);
  let _t = _pn();
  performance.now = function() { return (_t += 0.001); };
  // 4. Fix outerWidth/outerHeight DevTools size detection
  Object.defineProperty(window, 'outerWidth', { get: function() { return window.innerWidth; }, configurable: true });
  Object.defineProperty(window, 'outerHeight', { get: function() { return window.innerHeight; }, configurable: true });`,
        cs,
        lc
      ),
  },

  'crypto-key-capture': {
    description:
      ' Force extractable:true on all WebCrypto importKey calls and capture plaintext/ciphertext + key material for encrypt/decrypt/sign/verify',
    buildCode: (cs, lc) =>
      buildHookCode(
        'crypto-key-capture',
        `
  if (window.crypto && window.crypto.subtle) {
    const _subtle = window.crypto.subtle;
    const _importKey = _subtle.importKey.bind(_subtle);
    const _encrypt  = _subtle.encrypt.bind(_subtle);
    const _decrypt  = _subtle.decrypt.bind(_subtle);
    const _sign     = _subtle.sign.bind(_subtle);
    const _verify   = _subtle.verify.bind(_subtle);
    const _exportKey = _subtle.exportKey.bind(_subtle);
    const toHex = function(buf) {
      return Array.from(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf))
        .map(function(b) { return b.toString(16).padStart(2,'0'); }).join('');
    };
    const tryExport = async function(key) {
      try { return await _exportKey('jwk', key); } catch(e) { return null; }
    };
    _subtle.importKey = async function(format, keyData, algorithm, extractable, usages) {
      {{STACK_CODE}}
      const keyHex = (keyData instanceof ArrayBuffer || ArrayBuffer.isView(keyData)) ? toHex(keyData) : JSON.stringify(keyData);
      const __msg = '[Hook:importKey] format=' + format + ' algo=' + JSON.stringify(algorithm) + ' key=' + keyHex.substring(0,64);
      {{LOG_FN}}
      const key = await _importKey(format, keyData, algorithm, true, usages);
      window.__aiHooks['preset-crypto-key-capture'].push({ fn:'importKey', format, algorithm: JSON.stringify(algorithm), keyHex, stack: __stack, ts: Date.now() });
      return key;
    };
    _subtle.encrypt = async function(algo, key, data) {
      {{STACK_CODE}}
      const plainHex = toHex(data);
      const result = await _encrypt(algo, key, data);
      const cipherHex = toHex(result);
      const keyJwk = await tryExport(key);
      const __msg = '[Hook:encrypt] algo=' + JSON.stringify(algo) + ' plain=' + plainHex.substring(0,64);
      {{LOG_FN}}
      window.__aiHooks['preset-crypto-key-capture'].push({ fn:'encrypt', algo: JSON.stringify(algo), plainHex, cipherHex, key: keyJwk, stack: __stack, ts: Date.now() });
      return result;
    };
    _subtle.decrypt = async function(algo, key, data) {
      {{STACK_CODE}}
      const result = await _decrypt(algo, key, data);
      const plainHex = toHex(result);
      const keyJwk = await tryExport(key);
      const __msg = '[Hook:decrypt] algo=' + JSON.stringify(algo) + ' plain=' + new TextDecoder().decode(new Uint8Array(result instanceof ArrayBuffer ? result : result.buffer, 0, Math.min(100, (result.byteLength || result.length || 0))));
      {{LOG_FN}}
      window.__aiHooks['preset-crypto-key-capture'].push({ fn:'decrypt', algo: JSON.stringify(algo), plainHex, key: keyJwk, stack: __stack, ts: Date.now() });
      return result;
    };
    _subtle.sign = async function(algo, key, data) {
      {{STACK_CODE}}
      const result = await _sign(algo, key, data);
      const keyJwk = await tryExport(key);
      const __msg = '[Hook:sign] algo=' + JSON.stringify(algo);
      {{LOG_FN}}
      window.__aiHooks['preset-crypto-key-capture'].push({ fn:'sign', algo: JSON.stringify(algo), sigHex: toHex(result), key: keyJwk, stack: __stack, ts: Date.now() });
      return result;
    };
  }`,
        cs,
        lc
      ),
  },

  'webassembly-full': {
    description:
      ' Hook WebAssembly.instantiate to log all import calls, export names, and memory creation',
    buildCode: (cs, lc) =>
      buildHookCode(
        'webassembly-full',
        `
  if (typeof WebAssembly !== 'undefined') {
    const _inst = WebAssembly.instantiate;
    WebAssembly.instantiate = async function(bufferSource, importObject) {
      {{STACK_CODE}}
      const size = bufferSource && (bufferSource.byteLength || bufferSource.length) || 0;
      const __msg = '[Hook:WASM.instantiate] size=' + size;
      {{LOG_FN}}
      // Wrap all imported functions to trace calls
      if (importObject && typeof importObject === 'object') {
        Object.keys(importObject).forEach(function(modName) {
          const mod = importObject[modName];
          if (mod && typeof mod === 'object') {
            Object.keys(mod).forEach(function(fnName) {
              if (typeof mod[fnName] === 'function') {
                const _fn = mod[fnName];
                mod[fnName] = function() {
                  const args = Array.prototype.slice.call(arguments);
                  window.__aiHooks['preset-webassembly-full'].push({ type:'import_call', mod: modName, fn: fnName, args: args.map(function(a){ return typeof a === 'number' ? a : '?'; }), ts: Date.now() });
                  return _fn.apply(this, args);
                };
              }
            });
          }
        });
      }
      const result = await _inst(bufferSource, importObject);
      const exports = result && result.instance ? Object.keys(result.instance.exports) : [];
      window.__aiHooks['preset-webassembly-full'].push({ type:'instantiated', size, exports, importMods: importObject ? Object.keys(importObject) : [], stack: __stack, ts: Date.now() });
      return result;
    };
    // Also hook WebAssembly.Memory creation
    const _Memory = WebAssembly.Memory;
    WebAssembly.Memory = function(descriptor) {
      window.__aiHooks['preset-webassembly-full'].push({ type:'memory_created', initial: descriptor && descriptor.initial, maximum: descriptor && descriptor.maximum, shared: descriptor && descriptor.shared, ts: Date.now() });
      return new _Memory(descriptor);
    };
    WebAssembly.Memory.prototype = _Memory.prototype;
  }`,
        cs,
        lc
      ),
  },
};
