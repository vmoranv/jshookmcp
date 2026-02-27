export const ANTI_DEBUG_SCRIPTS = {
  bypassDebuggerStatement: `(function () {
  var globalObj = typeof window !== 'undefined' ? window : globalThis;
  var installFlag = '__ANTI_DEBUGGER_STATEMENT_INSTALLED__';
  if (Object.prototype.hasOwnProperty.call(globalObj, installFlag)) {
    return;
  }

  try {
    Object.defineProperty(globalObj, installFlag, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    globalObj[installFlag] = true;
  }

  var mode = __ANTI_DEBUG_MODE__;
  var NativeFunction = Function;

  function sanitizeSource(source) {
    if (typeof source !== 'string') {
      return source;
    }
    if (!/\\bdebugger\\b/.test(source)) {
      return source;
    }
    if (mode === 'remove') {
      return source.replace(/\\bdebugger\\b\\s*;?/g, '');
    }
    return source.replace(/\\bdebugger\\b\\s*;?/g, 'void 0;');
  }

  var PatchedFunction = new Proxy(NativeFunction, {
    apply: function (target, thisArg, argArray) {
      if (Array.isArray(argArray) && argArray.length > 0) {
        var nextArgs = argArray.slice();
        var lastIndex = nextArgs.length - 1;
        nextArgs[lastIndex] = sanitizeSource(nextArgs[lastIndex]);
        return Reflect.apply(target, thisArg, nextArgs);
      }
      return Reflect.apply(target, thisArg, argArray);
    },
    construct: function (target, argArray, newTarget) {
      if (Array.isArray(argArray) && argArray.length > 0) {
        var nextArgs = argArray.slice();
        var lastIndex = nextArgs.length - 1;
        nextArgs[lastIndex] = sanitizeSource(nextArgs[lastIndex]);
        return Reflect.construct(target, nextArgs, newTarget);
      }
      return Reflect.construct(target, argArray, newTarget);
    }
  });

  try {
    Object.defineProperty(PatchedFunction, 'toString', {
      value: function () {
        return 'function Function() { [native code] }';
      },
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {}

  try {
    Object.defineProperty(Function.prototype, 'constructor', {
      value: PatchedFunction,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {}

  function patchScriptElement(scriptEl) {
    if (!scriptEl || scriptEl.tagName !== 'SCRIPT') {
      return;
    }

    if (scriptEl.src) {
      return;
    }

    var code = scriptEl.textContent || '';
    if (!/\\bdebugger\\b/.test(code)) {
      return;
    }

    if (mode === 'remove') {
      try {
        scriptEl.remove();
      } catch (_) {}
      return;
    }

    try {
      scriptEl.textContent = sanitizeSource(code);
    } catch (_) {}
  }

  function visitNode(node) {
    if (!node || node.nodeType !== 1) {
      return;
    }

    var element = node;
    if (element.tagName === 'SCRIPT') {
      patchScriptElement(element);
    }

    if (typeof element.querySelectorAll === 'function') {
      var nestedScripts = element.querySelectorAll('script');
      for (var i = 0; i < nestedScripts.length; i += 1) {
        patchScriptElement(nestedScripts[i]);
      }
    }
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i += 1) {
      var mutation = mutations[i];
      if (!mutation.addedNodes) {
        continue;
      }
      for (var j = 0; j < mutation.addedNodes.length; j += 1) {
        visitNode(mutation.addedNodes[j]);
      }
    }
  });

  function startObserving() {
    try {
      if (document.documentElement) {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
    } catch (_) {}
  }

  if (document.documentElement) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }

  var existingScripts = document.querySelectorAll('script');
  for (var i = 0; i < existingScripts.length; i += 1) {
    patchScriptElement(existingScripts[i]);
  }
})();`,

  bypassTiming: `(function () {
  var globalObj = typeof window !== 'undefined' ? window : globalThis;
  var installFlag = '__ANTI_DEBUG_TIMING_INSTALLED__';
  if (Object.prototype.hasOwnProperty.call(globalObj, installFlag)) {
    return;
  }

  try {
    Object.defineProperty(globalObj, installFlag, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    globalObj[installFlag] = true;
  }

  var maxDrift = __ANTI_DEBUG_MAX_DRIFT__;
  if (typeof maxDrift !== 'number' || !isFinite(maxDrift) || maxDrift < 0) {
    maxDrift = 50;
  }

  var perfNow = typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now.bind(performance)
    : function () { return Date.now(); };

  var dateNow = Date.now.bind(Date);

  var lastPerfReal = perfNow();
  var logicalPerf = lastPerfReal;

  var lastDateReal = dateNow();
  var logicalDate = lastDateReal;

  function stepLogicalTime(currentReal, lastRealRef, logicalRef) {
    var delta = currentReal - lastRealRef.value;
    if (!isFinite(delta) || delta < 0) {
      delta = 0;
    }
    if (delta > maxDrift) {
      delta = maxDrift;
    }
    logicalRef.value += delta;
    lastRealRef.value = currentReal;
    return logicalRef.value;
  }

  var perfLastRef = { value: lastPerfReal };
  var perfLogicalRef = { value: logicalPerf };
  var dateLastRef = { value: lastDateReal };
  var dateLogicalRef = { value: logicalDate };

  var wrappedPerformanceNow = function () {
    return stepLogicalTime(perfNow(), perfLastRef, perfLogicalRef);
  };

  var wrappedDateNow = function () {
    return Math.floor(stepLogicalTime(dateNow(), dateLastRef, dateLogicalRef));
  };

  try {
    Object.defineProperty(performance, 'now', {
      value: wrappedPerformanceNow,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    try {
      performance.now = wrappedPerformanceNow;
    } catch (_) {}
  }

  try {
    Object.defineProperty(Date, 'now', {
      value: wrappedDateNow,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    try {
      Date.now = wrappedDateNow;
    } catch (_) {}
  }

  var labels = Object.create(null);
  var nativeConsoleLog = typeof console !== 'undefined' && console && typeof console.log === 'function'
    ? console.log.bind(console)
    : function () {};

  var wrappedTime = function (label) {
    var key = String(label == null ? 'default' : label);
    labels[key] = wrappedPerformanceNow();
  };

  var wrappedTimeEnd = function (label) {
    var key = String(label == null ? 'default' : label);
    var nowValue = wrappedPerformanceNow();
    var startValue = labels[key];
    if (typeof startValue !== 'number') {
      nativeConsoleLog(key + ': 0.000ms');
      return 0;
    }
    var duration = Math.max(0, nowValue - startValue);
    delete labels[key];
    nativeConsoleLog(key + ': ' + duration.toFixed(3) + 'ms');
    return duration;
  };

  try {
    Object.defineProperty(console, 'time', {
      value: wrappedTime,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    try {
      console.time = wrappedTime;
    } catch (_) {}
  }

  try {
    Object.defineProperty(console, 'timeEnd', {
      value: wrappedTimeEnd,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    try {
      console.timeEnd = wrappedTimeEnd;
    } catch (_) {}
  }
})();`,

  bypassStackTrace: `(function () {
  var globalObj = typeof window !== 'undefined' ? window : globalThis;
  var installFlag = '__ANTI_DEBUG_STACK_TRACE_INSTALLED__';
  if (Object.prototype.hasOwnProperty.call(globalObj, installFlag)) {
    return;
  }

  try {
    Object.defineProperty(globalObj, installFlag, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    globalObj[installFlag] = true;
  }

  var configuredPatterns = __ANTI_DEBUG_FILTER_PATTERNS__;
  if (!Array.isArray(configuredPatterns)) {
    configuredPatterns = ['puppeteer', 'devtools', '__puppeteer', 'cdp'];
  }

  var normalizedPatterns = configuredPatterns
    .map(function (item) {
      return String(item).toLowerCase().trim();
    })
    .filter(function (item) {
      return item.length > 0;
    });

  function sanitizeStack(stackText) {
    if (typeof stackText !== 'string' || stackText.length === 0) {
      return stackText;
    }

    var lines = stackText.split('\\n');
    var filtered = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var lowerLine = line.toLowerCase();
      var blocked = false;
      for (var j = 0; j < normalizedPatterns.length; j += 1) {
        if (lowerLine.indexOf(normalizedPatterns[j]) !== -1) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        filtered.push(line);
      }
    }

    return filtered.join('\\n');
  }

  var sourceMapKey = '__ANTI_NATIVE_SOURCE_MAP__';
  var toStringFlag = '__ANTI_TOSTRING_PATCHED__';
  var nativeSourceMap = globalObj[sourceMapKey];

  if (!(nativeSourceMap instanceof WeakMap)) {
    nativeSourceMap = new WeakMap();
    try {
      Object.defineProperty(globalObj, sourceMapKey, {
        value: nativeSourceMap,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      globalObj[sourceMapKey] = nativeSourceMap;
    }
  }

  if (!globalObj[toStringFlag]) {
    var nativeToString = Function.prototype.toString;
    var patchedToString = function () {
      if (nativeSourceMap && nativeSourceMap.has(this)) {
        return nativeSourceMap.get(this);
      }
      return nativeToString.call(this);
    };

    try {
      Object.defineProperty(Function.prototype, 'toString', {
        value: patchedToString,
        enumerable: false,
        configurable: false,
        writable: false
      });
      Object.defineProperty(globalObj, toStringFlag, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      globalObj[toStringFlag] = true;
    }
  }

  function markAsNative(fn, name) {
    if (!(nativeSourceMap instanceof WeakMap) || typeof fn !== 'function') {
      return;
    }
    var fnName = String(name || fn.name || 'anonymous').replace(/[^a-zA-Z0-9_$]/g, '');
    nativeSourceMap.set(fn, 'function ' + fnName + '() { [native code] }');
  }

  function sanitizeError(error) {
    if (!error || typeof error !== 'object') {
      return error;
    }

    try {
      if (typeof error.stack === 'string') {
        Object.defineProperty(error, 'stack', {
          value: sanitizeStack(error.stack),
          enumerable: false,
          configurable: true,
          writable: true
        });
      }
    } catch (_) {}

    return error;
  }

  var NativeError = Error;
  var PatchedError = function () {
    var args = Array.prototype.slice.call(arguments);
    var err = Reflect.construct(NativeError, args, PatchedError);
    return sanitizeError(err);
  };

  PatchedError.prototype = NativeError.prototype;
  try {
    Object.setPrototypeOf(PatchedError, NativeError);
  } catch (_) {}

  if (typeof NativeError.captureStackTrace === 'function') {
    var nativeCapture = NativeError.captureStackTrace.bind(NativeError);
    var patchedCapture = function (target, constructorOpt) {
      nativeCapture(target, constructorOpt);
      sanitizeError(target);
    };

    try {
      Object.defineProperty(PatchedError, 'captureStackTrace', {
        value: patchedCapture,
        enumerable: false,
        configurable: false,
        writable: false
      });
      markAsNative(patchedCapture, 'captureStackTrace');
    } catch (_) {}
  }

  var stackDescriptor = Object.getOwnPropertyDescriptor(NativeError.prototype, 'stack');
  if (stackDescriptor && typeof stackDescriptor.get === 'function') {
    var nativeStackGetter = stackDescriptor.get;
    var nativeStackSetter = stackDescriptor.set;

    try {
      Object.defineProperty(NativeError.prototype, 'stack', {
        get: function () {
          return sanitizeStack(nativeStackGetter.call(this));
        },
        set: function (value) {
          if (typeof nativeStackSetter === 'function') {
            nativeStackSetter.call(this, value);
            return;
          }
          Object.defineProperty(this, 'stack', {
            value: value,
            enumerable: false,
            configurable: true,
            writable: true
          });
        },
        enumerable: false,
        configurable: stackDescriptor.configurable === true
      });
    } catch (_) {}
  }

  markAsNative(PatchedError, 'Error');

  try {
    Object.defineProperty(globalObj, 'Error', {
      value: PatchedError,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    try {
      globalObj.Error = PatchedError;
    } catch (_) {}
  }
})();`,

  bypassConsoleDetect: `(function () {
  var globalObj = typeof window !== 'undefined' ? window : globalThis;
  var installFlag = '__ANTI_DEBUG_CONSOLE_INSTALLED__';
  if (Object.prototype.hasOwnProperty.call(globalObj, installFlag)) {
    return;
  }

  try {
    Object.defineProperty(globalObj, installFlag, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_) {
    globalObj[installFlag] = true;
  }

  var sourceMapKey = '__ANTI_NATIVE_SOURCE_MAP__';
  var toStringFlag = '__ANTI_TOSTRING_PATCHED__';
  var nativeSourceMap = globalObj[sourceMapKey];

  if (!(nativeSourceMap instanceof WeakMap)) {
    nativeSourceMap = new WeakMap();
    try {
      Object.defineProperty(globalObj, sourceMapKey, {
        value: nativeSourceMap,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      globalObj[sourceMapKey] = nativeSourceMap;
    }
  }

  if (!globalObj[toStringFlag]) {
    var nativeToString = Function.prototype.toString;
    var patchedToString = function () {
      if (nativeSourceMap && nativeSourceMap.has(this)) {
        return nativeSourceMap.get(this);
      }
      return nativeToString.call(this);
    };

    try {
      Object.defineProperty(Function.prototype, 'toString', {
        value: patchedToString,
        enumerable: false,
        configurable: false,
        writable: false
      });
      Object.defineProperty(globalObj, toStringFlag, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      globalObj[toStringFlag] = true;
    }
  }

  function markAsNative(fn, name) {
    if (!(nativeSourceMap instanceof WeakMap) || typeof fn !== 'function') {
      return;
    }
    var fnName = String(name || fn.name || 'anonymous').replace(/[^a-zA-Z0-9_$]/g, '');
    nativeSourceMap.set(fn, 'function ' + fnName + '() { [native code] }');
  }

  function sanitizeArg(value, depth, seen) {
    if (depth > 3) {
      return '[MaxDepth]';
    }

    var valueType = typeof value;
    if (value == null || valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
      return value;
    }

    if (valueType === 'symbol') {
      return value.toString();
    }

    if (valueType === 'function') {
      return '[Function ' + (value.name || 'anonymous') + ']';
    }

    if (valueType !== 'object') {
      return String(value);
    }

    if (!(seen instanceof WeakSet)) {
      seen = new WeakSet();
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      var outArray = [];
      for (var i = 0; i < value.length; i += 1) {
        outArray.push(sanitizeArg(value[i], depth + 1, seen));
      }
      return outArray;
    }

    var outObject = {};
    var descriptors = {};
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (_) {
      return '[Uninspectable Object]';
    }

    var keys = Object.keys(descriptors);
    for (var j = 0; j < keys.length; j += 1) {
      var key = keys[j];
      var descriptor = descriptors[key];
      if (!descriptor) {
        continue;
      }

      if (typeof descriptor.get === 'function' && !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        outObject[key] = '[Getter]';
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        outObject[key] = sanitizeArg(descriptor.value, depth + 1, seen);
      }
    }

    return outObject;
  }

  function wrapConsoleMethod(methodName, nativeMethod) {
    var wrapped = function () {
      if (methodName === 'clear') {
        return undefined;
      }

      var rawArgs = Array.prototype.slice.call(arguments);
      var safeArgs = [];
      for (var i = 0; i < rawArgs.length; i += 1) {
        safeArgs.push(sanitizeArg(rawArgs[i], 0, new WeakSet()));
      }

      try {
        nativeMethod.apply(console, safeArgs);
      } catch (_) {}

      return undefined;
    };

    markAsNative(wrapped, methodName);
    return wrapped;
  }

  var methods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'dir', 'trace', 'clear'];
  for (var idx = 0; idx < methods.length; idx += 1) {
    var methodName = methods[idx];
    var nativeMethod = console && console[methodName];
    if (typeof nativeMethod !== 'function') {
      continue;
    }

    var wrappedMethod = wrapConsoleMethod(methodName, nativeMethod);

    try {
      Object.defineProperty(console, methodName, {
        value: wrappedMethod,
        enumerable: false,
        configurable: false,
        writable: false
      });
    } catch (_) {
      try {
        console[methodName] = wrappedMethod;
      } catch (_) {}
    }
  }
})();`,

  detectProtections: `(async function () {
  function pushUnique(list, value) {
    if (list.indexOf(value) === -1) {
      list.push(value);
    }
  }

  var findings = [];
  var recommendations = [];

  function addFinding(type, severity, evidence, strategy) {
    findings.push({
      type: type,
      severity: severity,
      evidence: evidence,
      recommendedBypass: strategy
    });
    pushUnique(recommendations, strategy);
  }

  var inlineScripts = [];
  try {
    var scriptNodes = document.querySelectorAll('script');
    for (var i = 0; i < scriptNodes.length; i += 1) {
      var node = scriptNodes[i];
      if (!node.src && typeof node.textContent === 'string' && node.textContent.trim().length > 0) {
        inlineScripts.push(node.textContent.slice(0, 200000));
      }
    }
  } catch (_) {}

  var externalScripts = [];
  try {
    var externalCount = 0;
    var allScriptNodes = document.querySelectorAll('script[src]');
    for (var j = 0; j < allScriptNodes.length; j += 1) {
      if (externalCount >= 8) {
        break;
      }

      var scriptSrc = allScriptNodes[j].src;
      if (!scriptSrc) {
        continue;
      }

      try {
        var absoluteUrl = new URL(scriptSrc, location.href);
        if (absoluteUrl.origin !== location.origin) {
          continue;
        }

        var response = await fetch(absoluteUrl.href, { credentials: 'same-origin' });
        if (!response.ok) {
          continue;
        }

        var text = await response.text();
        externalScripts.push(text.slice(0, 200000));
        externalCount += 1;
      } catch (_) {}
    }
  } catch (_) {}

  var sourceBlob = (inlineScripts.join('\\n') + '\\n' + externalScripts.join('\\n')).toLowerCase();

  var debuggerTimerPattern = /(setinterval|settimeout)[\\s\\S]{0,180}debugger|debugger\\s*;/i;
  if (debuggerTimerPattern.test(sourceBlob)) {
    addFinding(
      'debugger_statement',
      'high',
      'Found debugger statements or timer-driven debugger triggers in script sources.',
      'antidebug_bypass_debugger_statement'
    );
  }

  var timingPattern = /(performance\\.now\\s*\\(|date\\.now\\s*\\()[\\s\\S]{0,120}(>|>=|<|<=|===|!==)[\\s\\S]{0,60}(50|100|200|500|1000)/i;
  if (timingPattern.test(sourceBlob)) {
    addFinding(
      'timing_check',
      'high',
      'Found timing delta logic around performance.now()/Date.now().',
      'antidebug_bypass_timing'
    );
  }

  var stackPattern = /(new\\s+error\\s*\\(|error\\s*\\(|\\.stack\\b|preparestacktrace)/i;
  if (stackPattern.test(sourceBlob)) {
    addFinding(
      'stack_trace_check',
      'medium',
      'Found Error.stack or stack trace analysis patterns.',
      'antidebug_bypass_stack_trace'
    );
  }

  var consolePattern = /(console\\.(log|clear|table|debug|dir|trace)\\s*\\(|console\\s*=|Object\\.defineProperty\\s*\\(\\s*console)/i;
  if (consolePattern.test(sourceBlob)) {
    addFinding(
      'console_detect',
      'medium',
      'Found console instrumentation or console-based detection patterns.',
      'antidebug_bypass_console_detect'
    );
  }

  var devtoolsSizePattern = /(outerheight\\s*-\\s*innerheight|outerwidth\\s*-\\s*innerwidth|innerheight\\s*<\\s*outerheight|innerwidth\\s*<\\s*outerwidth)/i;
  if (devtoolsSizePattern.test(sourceBlob)) {
    addFinding(
      'devtools_window_check',
      'low',
      'Found outer/inner window dimension comparison likely used for devtools panel detection.',
      'antidebug_bypass_all'
    );
  }

  var overwrittenConsoleMethods = [];
  var nativeCodePattern = /\\{\\s*\\[native code\\]\\s*\\}/i;
  var runtimeMethods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'clear'];
  for (var k = 0; k < runtimeMethods.length; k += 1) {
    var methodName = runtimeMethods[k];
    try {
      var candidate = console[methodName];
      if (typeof candidate !== 'function') {
        overwrittenConsoleMethods.push(methodName + ':non-function');
        continue;
      }

      var fnSource = Function.prototype.toString.call(candidate);
      if (!nativeCodePattern.test(fnSource)) {
        overwrittenConsoleMethods.push(methodName);
      }
    } catch (_) {}
  }

  if (overwrittenConsoleMethods.length > 0) {
    addFinding(
      'console_runtime_overwrite',
      'medium',
      'Runtime console methods appear wrapped/overwritten: ' + overwrittenConsoleMethods.join(', '),
      'antidebug_bypass_console_detect'
    );
  }

  return {
    success: true,
    detected: findings.length > 0,
    count: findings.length,
    protections: findings,
    recommendations: recommendations,
    evidence: {
      scannedInlineScripts: inlineScripts.length,
      scannedExternalScripts: externalScripts.length,
      sourceBytesApprox: sourceBlob.length
    }
  };
})();`,
} as const;
