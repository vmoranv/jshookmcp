import type { PresetEntry } from './preset-builder.js';
import { buildHookCode } from './preset-builder.js';

export const CORE_PRESETS: Record<string, PresetEntry> = {
  eval: {
    description: ' Hook eval() to capture dynamic code execution',
    buildCode: (cs, lc) =>
      buildHookCode(
        'eval',
        `
  const _orig = window.eval;
  window.eval = function(code) {
    {{STACK_CODE}}
    const __msg = '[Hook:eval] code=' + String(code).substring(0, 200);
    {{LOG_FN}}
    window.__aiHooks['preset-eval'].push({ code: String(code).substring(0, 500), stack: __stack, ts: Date.now() });
    return _orig.call(this, code);
  };`,
        cs,
        lc
      ),
  },

  'function-constructor': {
    description: ' Hook new Function() to capture dynamic function creation',
    buildCode: (cs, lc) =>
      buildHookCode(
        'function-constructor',
        `
  const _orig = Function;
  window.Function = function(...args) {
    {{STACK_CODE}}
    const __msg = '[Hook:Function] args=' + JSON.stringify(args).substring(0, 200);
    {{LOG_FN}}
    window.__aiHooks['preset-function-constructor'].push({ args: args.map(a => String(a).substring(0,200)), stack: __stack, ts: Date.now() });
    return _orig(...args);
  };
  window.Function.prototype = _orig.prototype;`,
        cs,
        lc
      ),
  },

  'atob-btoa': {
    description: ' Hook atob/btoa to capture Base64 encode/decode operations',
    buildCode: (cs, lc) =>
      buildHookCode(
        'atob-btoa',
        `
  const _atob = window.atob.bind(window);
  const _btoa = window.btoa.bind(window);
  window.atob = function(s) {
    {{STACK_CODE}}
    const result = _atob(s);
    const __msg = '[Hook:atob] in=' + String(s).substring(0,100) + ' out=' + result.substring(0,100);
    {{LOG_FN}}
    window.__aiHooks['preset-atob-btoa'].push({ fn:'atob', input: String(s).substring(0,200), output: result.substring(0,200), stack: __stack, ts: Date.now() });
    return result;
  };
  window.btoa = function(s) {
    {{STACK_CODE}}
    const result = _btoa(s);
    const __msg = '[Hook:btoa] in=' + String(s).substring(0,100) + ' out=' + result;
    {{LOG_FN}}
    window.__aiHooks['preset-atob-btoa'].push({ fn:'btoa', input: String(s).substring(0,200), output: result, stack: __stack, ts: Date.now() });
    return result;
  };`,
        cs,
        lc
      ),
  },

  'crypto-subtle': {
    description: ' Hook crypto.subtle.encrypt/decrypt to intercept WebCrypto operations',
    buildCode: (cs, lc) =>
      buildHookCode(
        'crypto-subtle',
        `
  if (window.crypto && window.crypto.subtle) {
    const _enc = window.crypto.subtle.encrypt.bind(window.crypto.subtle);
    const _dec = window.crypto.subtle.decrypt.bind(window.crypto.subtle);
    window.crypto.subtle.encrypt = function(algo, key, data) {
      {{STACK_CODE}}
      const __msg = '[Hook:crypto.encrypt] algo=' + JSON.stringify(algo);
      {{LOG_FN}}
      window.__aiHooks['preset-crypto-subtle'].push({ fn:'encrypt', algo: JSON.stringify(algo), stack: __stack, ts: Date.now() });
      return _enc(algo, key, data);
    };
    window.crypto.subtle.decrypt = function(algo, key, data) {
      {{STACK_CODE}}
      const __msg = '[Hook:crypto.decrypt] algo=' + JSON.stringify(algo);
      {{LOG_FN}}
      window.__aiHooks['preset-crypto-subtle'].push({ fn:'decrypt', algo: JSON.stringify(algo), stack: __stack, ts: Date.now() });
      return _dec(algo, key, data);
    };
  }`,
        cs,
        lc
      ),
  },

  'json-stringify': {
    description: ' Hook JSON.stringify/parse to capture serialization activity',
    buildCode: (cs, lc) =>
      buildHookCode(
        'json-stringify',
        `
  const _stringify = JSON.stringify;
  const _parse = JSON.parse;
  JSON.stringify = function(v, r, s) {
    {{STACK_CODE}}
    const result = _stringify(v, r, s);
    const __msg = '[Hook:JSON.stringify] out=' + (result||'').substring(0,100);
    {{LOG_FN}}
    window.__aiHooks['preset-json-stringify'].push({ fn:'stringify', output: (result||'').substring(0,300), stack: __stack, ts: Date.now() });
    return result;
  };
  JSON.parse = function(text, r) {
    {{STACK_CODE}}
    const result = _parse(text, r);
    const __msg = '[Hook:JSON.parse] in=' + String(text).substring(0,100);
    {{LOG_FN}}
    window.__aiHooks['preset-json-stringify'].push({ fn:'parse', input: String(text).substring(0,300), stack: __stack, ts: Date.now() });
    return result;
  };`,
        cs,
        lc
      ),
  },

  'object-defineproperty': {
    description: ' Hook Object.defineProperty to monitor property definitions',
    buildCode: (cs, lc) =>
      buildHookCode(
        'object-defineproperty',
        `
  const _define = Object.defineProperty;
  Object.defineProperty = function(obj, prop, descriptor) {
    {{STACK_CODE}}
    const __msg = '[Hook:Object.defineProperty] prop=' + String(prop);
    {{LOG_FN}}
    window.__aiHooks['preset-object-defineproperty'].push({ prop: String(prop), descriptor: JSON.stringify(descriptor||{}).substring(0,200), stack: __stack, ts: Date.now() });
    return _define(obj, prop, descriptor);
  };`,
        cs,
        lc
      ),
  },

  settimeout: {
    description: ' Hook setTimeout to capture timer callbacks and delays',
    buildCode: (cs, lc) =>
      buildHookCode(
        'settimeout',
        `
  const _orig = window.setTimeout;
  window.setTimeout = function(fn, delay, ...args) {
    {{STACK_CODE}}
    const fnStr = typeof fn === 'string' ? fn : fn?.toString().substring(0,100);
    const __msg = '[Hook:setTimeout] delay=' + delay + ' fn=' + fnStr;
    {{LOG_FN}}
    window.__aiHooks['preset-settimeout'].push({ delay, fn: fnStr, stack: __stack, ts: Date.now() });
    return _orig(fn, delay, ...args);
  };`,
        cs,
        lc
      ),
  },

  setinterval: {
    description: ' Hook setInterval to capture repeating timer callbacks',
    buildCode: (cs, lc) =>
      buildHookCode(
        'setinterval',
        `
  const _orig = window.setInterval;
  window.setInterval = function(fn, delay, ...args) {
    {{STACK_CODE}}
    const fnStr = typeof fn === 'string' ? fn : fn?.toString().substring(0,100);
    const __msg = '[Hook:setInterval] delay=' + delay + ' fn=' + fnStr;
    {{LOG_FN}}
    window.__aiHooks['preset-setinterval'].push({ delay, fn: fnStr, stack: __stack, ts: Date.now() });
    return _orig(fn, delay, ...args);
  };`,
        cs,
        lc
      ),
  },

  addeventlistener: {
    description: ' Hook addEventListener to trace event listener registrations',
    buildCode: (cs, lc) =>
      buildHookCode(
        'addeventlistener',
        `
  const _orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    {{STACK_CODE}}
    const __msg = '[Hook:addEventListener] type=' + type;
    {{LOG_FN}}
    window.__aiHooks['preset-addeventlistener'].push({ type, target: this?.tagName || String(this).substring(0,50), stack: __stack, ts: Date.now() });
    return _orig.call(this, type, listener, options);
  };`,
        cs,
        lc
      ),
  },

  postmessage: {
    description: ' Hook postMessage to capture cross-origin and iframe messages',
    buildCode: (cs, lc) =>
      buildHookCode(
        'postmessage',
        `
  const _orig = window.postMessage.bind(window);
  window.postMessage = function(data, origin, transfer) {
    {{STACK_CODE}}
    const __msg = '[Hook:postMessage] origin=' + origin + ' data=' + JSON.stringify(data).substring(0,100);
    {{LOG_FN}}
    window.__aiHooks['preset-postmessage'].push({ origin, data: JSON.stringify(data||{}).substring(0,300), stack: __stack, ts: Date.now() });
    return _orig(data, origin, transfer);
  };
  window.addEventListener('message', function(e) {
    window.__aiHooks['preset-postmessage'].push({ direction:'received', origin: e.origin, data: JSON.stringify(e.data||{}).substring(0,300), ts: Date.now() });
  });`,
        cs,
        lc
      ),
  },

  webassembly: {
    description: ' Hook WebAssembly.instantiate/compile to detect WASM module loading',
    buildCode: (cs, lc) =>
      buildHookCode(
        'webassembly',
        `
  if (typeof WebAssembly !== 'undefined') {
    const _inst = WebAssembly.instantiate;
    WebAssembly.instantiate = function(bufferSource, importObject) {
      {{STACK_CODE}}
      const size = bufferSource?.byteLength || bufferSource?.length || 0;
      const __msg = '[Hook:WebAssembly.instantiate] size=' + size;
      {{LOG_FN}}
      window.__aiHooks['preset-webassembly'].push({ fn:'instantiate', size, stack: __stack, ts: Date.now() });
      return _inst(bufferSource, importObject);
    };
  }`,
        cs,
        lc
      ),
  },

  proxy: {
    description: ' Hook Proxy constructor to detect proxy-based anti-debugging',
    buildCode: (cs, lc) =>
      buildHookCode(
        'proxy',
        `
  const _Proxy = window.Proxy;
  window.Proxy = function(target, handler) {
    {{STACK_CODE}}
    const __msg = '[Hook:Proxy] target=' + String(target).substring(0,50);
    {{LOG_FN}}
    window.__aiHooks['preset-proxy'].push({ target: String(target).substring(0,100), handlerKeys: Object.keys(handler||{}), stack: __stack, ts: Date.now() });
    return new _Proxy(target, handler);
  };
  window.Proxy.prototype = _Proxy.prototype;
  window.Proxy.revocable = _Proxy.revocable;`,
        cs,
        lc
      ),
  },

  reflect: {
    description: ' Hook Reflect.apply to capture indirect function calls',
    buildCode: (cs, lc) =>
      buildHookCode(
        'reflect',
        `
  const _apply = Reflect.apply;
  Reflect.apply = function(target, thisArg, args) {
    {{STACK_CODE}}
    const __msg = '[Hook:Reflect.apply] fn=' + (target?.name || 'anonymous');
    {{LOG_FN}}
    window.__aiHooks['preset-reflect'].push({ fn: target?.name || 'anonymous', argsCount: (args||[]).length, stack: __stack, ts: Date.now() });
    return _apply(target, thisArg, args);
  };`,
        cs,
        lc
      ),
  },

  'history-pushstate': {
    description: ' Hook history.pushState/replaceState to trace SPA navigation',
    buildCode: (cs, lc) =>
      buildHookCode(
        'history-pushstate',
        `
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function(state, title, url) {
    {{STACK_CODE}}
    const __msg = '[Hook:history.pushState] url=' + url;
    {{LOG_FN}}
    window.__aiHooks['preset-history-pushstate'].push({ fn:'pushState', url: String(url), state: JSON.stringify(state||{}).substring(0,100), stack: __stack, ts: Date.now() });
    return _push(state, title, url);
  };
  history.replaceState = function(state, title, url) {
    {{STACK_CODE}}
    const __msg = '[Hook:history.replaceState] url=' + url;
    {{LOG_FN}}
    window.__aiHooks['preset-history-pushstate'].push({ fn:'replaceState', url: String(url), state: JSON.stringify(state||{}).substring(0,100), stack: __stack, ts: Date.now() });
    return _replace(state, title, url);
  };`,
        cs,
        lc
      ),
  },

  'location-href': {
    description: ' Hook location.href setter to intercept URL redirects',
    buildCode: (cs, lc) =>
      buildHookCode(
        'location-href',
        `
  const _desc = Object.getOwnPropertyDescriptor(window.location, 'href') ||
    Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  if (_desc && _desc.set) {
    const _origSet = _desc.set;
    Object.defineProperty(window.location, 'href', {
      get: _desc.get,
      set: function(url) {
        {{STACK_CODE}}
        const __msg = '[Hook:location.href] url=' + url;
        {{LOG_FN}}
        window.__aiHooks['preset-location-href'].push({ url: String(url), stack: __stack, ts: Date.now() });
        return _origSet.call(this, url);
      },
      configurable: true,
    });
  }`,
        cs,
        lc
      ),
  },

  'navigator-useragent': {
    description: ' Hook navigator.userAgent getter to detect UA fingerprinting',
    buildCode: (cs, lc) =>
      buildHookCode(
        'navigator-useragent',
        `
  const _desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
  if (_desc && _desc.get) {
    const _origGet = _desc.get;
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: function() {
        {{STACK_CODE}}
        const result = _origGet.call(this);
        const __msg = '[Hook:navigator.userAgent] ua=' + result.substring(0,80);
        {{LOG_FN}}
        window.__aiHooks['preset-navigator-useragent'].push({ ua: result.substring(0,200), stack: __stack, ts: Date.now() });
        return result;
      },
      configurable: true,
    });
  }`,
        cs,
        lc
      ),
  },

  eventsource: {
    description: ' Hook EventSource to capture SSE connections',
    buildCode: (cs, lc) =>
      buildHookCode(
        'eventsource',
        `
  if (typeof EventSource !== 'undefined') {
    const _ES = EventSource;
    window.EventSource = function(url, opts) {
      {{STACK_CODE}}
      const __msg = '[Hook:EventSource] url=' + url;
      {{LOG_FN}}
      window.__aiHooks['preset-eventsource'].push({ url: String(url), stack: __stack, ts: Date.now() });
      return new _ES(url, opts);
    };
    window.EventSource.prototype = _ES.prototype;
  }`,
        cs,
        lc
      ),
  },

  'window-open': {
    description: ' Hook window.open to capture popup and new tab creation',
    buildCode: (cs, lc) =>
      buildHookCode(
        'window-open',
        `
  const _orig = window.open.bind(window);
  window.open = function(url, target, features) {
    {{STACK_CODE}}
    const __msg = '[Hook:window.open] url=' + url + ' target=' + target;
    {{LOG_FN}}
    window.__aiHooks['preset-window-open'].push({ url: String(url), target: String(target||''), stack: __stack, ts: Date.now() });
    return _orig(url, target, features);
  };`,
        cs,
        lc
      ),
  },

  mutationobserver: {
    description: ' Hook MutationObserver to track dynamic DOM mutation watchers',
    buildCode: (cs, lc) =>
      buildHookCode(
        'mutationobserver',
        `
  const _MO = MutationObserver;
  window.MutationObserver = function(callback) {
    {{STACK_CODE}}
    const __msg = '[Hook:MutationObserver] created';
    {{LOG_FN}}
    window.__aiHooks['preset-mutationobserver'].push({ stack: __stack, ts: Date.now() });
    return new _MO(callback);
  };
  window.MutationObserver.prototype = _MO.prototype;`,
        cs,
        lc
      ),
  },

  formdata: {
    description: ' Hook FormData.append to capture form data before submission',
    buildCode: (cs, lc) =>
      buildHookCode(
        'formdata',
        `
  const _orig = FormData.prototype.append;
  FormData.prototype.append = function(name, value, filename) {
    {{STACK_CODE}}
    const __msg = '[Hook:FormData.append] name=' + name + ' value=' + String(value).substring(0,100);
    {{LOG_FN}}
    window.__aiHooks['preset-formdata'].push({ name: String(name), value: String(value).substring(0,200), stack: __stack, ts: Date.now() });
    return _orig.call(this, name, value, filename);
  };`,
        cs,
        lc
      ),
  },
};
