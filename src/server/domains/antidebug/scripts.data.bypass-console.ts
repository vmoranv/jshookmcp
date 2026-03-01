export const ANTI_DEBUG_BYPASS_CONSOLE_SCRIPT = {
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
} as const;
