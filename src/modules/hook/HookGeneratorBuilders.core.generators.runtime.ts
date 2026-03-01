import type { HookOptions } from '../../types/index.js';

export function generateFunctionHook(
  target: string,
  action: string,
  customCode?: string,
  condition?: HookOptions['condition'],
  performance = false
): string {
  const conditionCode = condition
    ? `
  let callCount = 0;
  let lastCallTime = 0;
  const maxCalls = ${condition.maxCalls || 'Infinity'};
  const minInterval = ${condition.minInterval || 0};
  `
    : '';

  const performanceCode = performance
    ? `
  const startTime = performance.now();
  `
    : '';

  const performanceEndCode = performance
    ? `
  const endTime = performance.now();
  console.log('[Hook] Execution time:', (endTime - startTime).toFixed(2), 'ms');
  `
    : '';

  return `
(function() {
'use strict';
${conditionCode}

const originalFunction = ${target};

if (typeof originalFunction !== 'function') {
  console.error('[Hook] Target is not a function: ${target}');
  return;
}

${target} = function(...args) {
  ${
    condition
      ? `
  const now = Date.now();
  if (callCount >= maxCalls) {
    console.log('[Hook] Max calls reached, skipping');
    return originalFunction.apply(this, args);
  }
  if (now - lastCallTime < minInterval) {
    console.log('[Hook] Min interval not met, skipping');
    return originalFunction.apply(this, args);
  }
  callCount++;
  lastCallTime = now;
  `
      : ''
  }

  ${performanceCode}

  const hookContext = {
    target: '${target}',
    type: 'function',
    timestamp: Date.now(),
    arguments: args,
    stackTrace: new Error().stack
  };

  console.log('[Hook] Function called:', hookContext);

  ${action === 'block' ? 'return undefined;' : ''}
  ${action === 'modify' && customCode ? customCode : ''}

  const result = originalFunction.apply(this, args);

  ${performanceEndCode}

  console.log('[Hook] Function result:', result);

  return result;
};

console.log('[Hook] Successfully hooked: ${target}');
})();
`.trim();
}

export function generateEvalHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const originalEval = window.eval;
const originalFunction = window.Function;
const originalSetTimeout = window.setTimeout;
const originalSetInterval = window.setInterval;

let evalCounter = 0;

window.eval = function(code) {
  const evalId = ++evalCounter;
  const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

  console.log(\`[Eval Hook #\${evalId}] eval:\`, {
    code: typeof code === 'string' ? (code.length > 200 ? code.substring(0, 200) + '...' : code) : code,
    codeType: typeof code,
    codeLength: code?.length || 0,
    stackTrace: stackTrace,
    timestamp: new Date().toISOString()
  });

  ${action === 'block' ? 'return undefined;' : ''}
  ${customCode || ''}

  try {
    const result = originalEval.call(this, code);
    console.log(\`[Eval Hook #\${evalId}] result:\`, typeof result);
    return result;
  } catch (error) {
    console.error(\`[Eval Hook #\${evalId}] error:\`, error.message);
    throw error;
  }
};

window.Function = function(...args) {
  const evalId = ++evalCounter;
  const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

  const functionBody = args[args.length - 1];
  const functionParams = args.slice(0, -1);

  console.log(\`[Eval Hook #\${evalId}] Function constructor:\`, {
    params: functionParams,
    body: typeof functionBody === 'string' ?
      (functionBody.length > 200 ? functionBody.substring(0, 200) + '...' : functionBody) :
      functionBody,
    bodyLength: functionBody?.length || 0,
    stackTrace: stackTrace,
    timestamp: new Date().toISOString()
  });

  ${action === 'block' ? 'return function() {};' : ''}
  ${customCode || ''}

  try {
    const result = originalFunction.apply(this, args);
    console.log(\`[Eval Hook #\${evalId}] Function created\`);
    return result;
  } catch (error) {
    console.error(\`[Eval Hook #\${evalId}] error:\`, error.message);
    throw error;
  }
};

window.setTimeout = function(handler, timeout, ...args) {
  if (typeof handler === 'string') {
    const evalId = ++evalCounter;
    console.log(\`[Eval Hook #\${evalId}] setTimeout with code:\`, {
      code: handler.length > 200 ? handler.substring(0, 200) + '...' : handler,
      timeout: timeout,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'return 0;' : ''}
  }

  return originalSetTimeout.apply(this, [handler, timeout, ...args]);
};

window.setInterval = function(handler, timeout, ...args) {
  if (typeof handler === 'string') {
    const evalId = ++evalCounter;
    console.log(\`[Eval Hook #\${evalId}] setInterval with code:\`, {
      code: handler.length > 200 ? handler.substring(0, 200) + '...' : handler,
      timeout: timeout,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'return 0;' : ''}
  }

  return originalSetInterval.apply(this, [handler, timeout, ...args]);
};

console.log('[Eval Hook] Successfully hooked eval, Function, setTimeout, setInterval');
})();
`.trim();
}

export function generateObjectMethodHook(
  target: string,
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  const parts = target.split('.');
  const methodName = parts.pop();
  const objectPath = parts.join('.');

  return `
(function() {
'use strict';

function getObjectByPath(path) {
  const parts = path.split('.');
  let obj = window;

  for (const part of parts) {
    if (part === 'window') continue;
    if (!obj || !(part in obj)) {
      return null;
    }
    obj = obj[part];
  }

  return obj;
}

const targetObject = getObjectByPath('${objectPath}');
const methodName = '${methodName}';

if (!targetObject) {
  console.error('[Object Hook] Target object not found: ${objectPath}');
  return;
}

const descriptor = Object.getOwnPropertyDescriptor(targetObject, methodName) ||
                   Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetObject), methodName);

if (!descriptor) {
  console.error('[Object Hook] Property not found: ${target}');
  return;
}

let callCounter = 0;

if (typeof targetObject[methodName] === 'function') {
  const originalMethod = targetObject[methodName];

  targetObject[methodName] = function(...args) {
    const callId = ++callCounter;
    const startTime = performance.now();
    const stackTrace = new Error().stack.split('\\n').slice(2, 5).join('\\n');

    console.log(\`[Object Hook #\${callId}] ${target}:\`, {
      arguments: args,
      this: this,
      thisType: this?.constructor?.name,
      stackTrace: stackTrace,
      timestamp: new Date().toISOString()
    });

    ${action === 'block' ? 'return undefined;' : ''}
    ${customCode || ''}

    try {
      const result = originalMethod.apply(this, args);
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      console.log(\`[Object Hook #\${callId}] ${target} result:\`, {
        result: result,
        resultType: typeof result,
        duration: duration + 'ms'
      });

      return result;
    } catch (error) {
      console.error(\`[Object Hook #\${callId}] ${target} error:\`, error);
      throw error;
    }
  };

  Object.setPrototypeOf(targetObject[methodName], originalMethod);

  console.log('[Object Hook] Successfully hooked method: ${target}');
}
else if (descriptor.get || descriptor.set) {
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;

  Object.defineProperty(targetObject, methodName, {
    get: function() {
      console.log('[Object Hook] getter called: ${target}');
      return originalGet ? originalGet.call(this) : undefined;
    },
    set: function(value) {
      console.log('[Object Hook] setter called: ${target}', { value });
      ${action === 'block' ? 'return;' : ''}
      if (originalSet) {
        originalSet.call(this, value);
      }
    },
    configurable: true,
    enumerable: descriptor.enumerable
  });

  console.log('[Object Hook] Successfully hooked property: ${target}');
}
})();
`.trim();
}

export function generateAntiDebugBypass(): string {
  return `
(function() {
'use strict';

console.log('[Anti-Debug Bypass] Initializing...');

const originalEval = window.eval;
window.eval = function(code) {
  if (typeof code === 'string') {
    code = code.replace(/debugger\\s*;?/g, '');
  }
  return originalEval.call(this, code);
};

const originalFunction = window.Function;
window.Function = function(...args) {
  if (args.length > 0) {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'string') {
      args[args.length - 1] = lastArg.replace(/debugger\\s*;?/g, '');
    }
  }
  return originalFunction.apply(this, args);
};

Object.defineProperty(window, 'outerHeight', {
  get: function() {
    return window.innerHeight;
  }
});

Object.defineProperty(window, 'outerWidth', {
  get: function() {
    return window.innerWidth;
  }
});

let lastTime = Date.now();
const originalDateNow = Date.now;
Date.now = function() {
  const currentTime = originalDateNow();
  if (currentTime - lastTime > 100) {
    lastTime += 16;
    return lastTime;
  }
  lastTime = currentTime;
  return currentTime;
};

const originalToString = Function.prototype.toString;
Function.prototype.toString = function() {
  if (this === window.eval || this === window.Function) {
    return 'function () { [native code] }';
  }
  return originalToString.call(this);
};

const devtools = { open: false };
const threshold = 160;

setInterval(function() {
  if (window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold) {
    devtools.open = true;
  } else {
    devtools.open = false;
  }
}, 500);

Object.defineProperty(window, 'devtools', {
  get: function() {
    return { open: false };
  }
});

console.log('[Anti-Debug Bypass] Successfully bypassed anti-debugging protections');
})();
`.trim();
}

export function generateHookTemplate(
  targetName: string,
  targetType: 'function' | 'property' | 'prototype'
): string {
  if (targetType === 'function') {
    return `
(function() {
'use strict';

const original = ${targetName};

${targetName} = function(...args) {
  console.log('[Hook] ${targetName} called:', args);


  const result = original.apply(this, args);
  console.log('[Hook] ${targetName} result:', result);

  return result;
};

console.log('[Hook] Successfully hooked: ${targetName}');
})();
`.trim();
  } else if (targetType === 'property') {
    return `
(function() {
'use strict';

const descriptor = Object.getOwnPropertyDescriptor(${targetName.split('.').slice(0, -1).join('.')}, '${targetName.split('.').pop()}');
const originalGet = descriptor?.get;
const originalSet = descriptor?.set;

Object.defineProperty(${targetName.split('.').slice(0, -1).join('.')}, '${targetName.split('.').pop()}', {
  get: function() {
    console.log('[Hook] ${targetName} get');
    return originalGet ? originalGet.call(this) : undefined;
  },
  set: function(value) {
    console.log('[Hook] ${targetName} set:', value);
    if (originalSet) {
      originalSet.call(this, value);
    }
  },
  configurable: true
});

console.log('[Hook] Successfully hooked property: ${targetName}');
})();
`.trim();
  } else {
    return `
(function() {
'use strict';

const original = ${targetName};

${targetName} = function(...args) {
  console.log('[Hook] ${targetName} constructor called:', args);

  const instance = new original(...args);

  const methodNames = Object.getOwnPropertyNames(original.prototype);
  methodNames.forEach(name => {
    if (name !== 'constructor' && typeof instance[name] === 'function') {
      const originalMethod = instance[name];
      instance[name] = function(...methodArgs) {
        console.log(\`[Hook] \${name} called:\`, methodArgs);
        return originalMethod.apply(this, methodArgs);
      };
    }
  });

  return instance;
};

${targetName}.prototype = original.prototype;

console.log('[Hook] Successfully hooked prototype: ${targetName}');
})();
`.trim();
  }
}

