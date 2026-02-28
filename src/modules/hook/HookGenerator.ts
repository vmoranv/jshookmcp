import type { HookOptions, HookResult } from '../../types/index.js';

export function generateHookScript(
  target: string,
  type: HookOptions['type'],
  action: string,
  customCode?: string,
  condition?: HookOptions['condition'],
  performance = false
): string {
  switch (type) {
    case 'function':
      return generateFunctionHook(target, action, customCode, condition, performance);
    case 'xhr':
      return generateXHRHook(action, customCode, condition, performance);
    case 'fetch':
      return generateFetchHook(action, customCode, condition, performance);
    case 'websocket':
      return generateWebSocketHook(action, customCode, condition, performance);
    case 'localstorage':
      return generateLocalStorageHook(action, customCode, condition, performance);
    case 'cookie':
      return generateCookieHook(action, customCode, condition, performance);
    case 'eval':
      return generateEvalHook(action, customCode, condition, performance);
    case 'object-method':
      return generateObjectMethodHook(target, action, customCode, condition, performance);
    default:
      throw new Error(`Unsupported hook type: ${type}`);
  }
}

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

export function generateXHRHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const XHR = XMLHttpRequest.prototype;
const originalOpen = XHR.open;
const originalSend = XHR.send;
const originalSetRequestHeader = XHR.setRequestHeader;

XHR.open = function(method, url, async, user, password) {
  this._hookData = {
    method: method,
    url: url,
    async: async !== false,
    timestamp: Date.now(),
    headers: {},
    stackTrace: new Error().stack
  };

  console.log('[XHR Hook] open:', {
    method: method,
    url: url,
    async: async !== false
  });

  ${action === 'block' ? 'return;' : ''}

  return originalOpen.apply(this, arguments);
};

XHR.setRequestHeader = function(header, value) {
  if (this._hookData) {
    this._hookData.headers[header] = value;
    console.log('[XHR Hook] setRequestHeader:', { header, value });
  }

  return originalSetRequestHeader.apply(this, arguments);
};

XHR.send = function(data) {
  const xhr = this;

  if (xhr._hookData) {
    xhr._hookData.requestData = data;
    xhr._hookData.sendTime = Date.now();

    console.log('[XHR Hook] send:', {
      url: xhr._hookData.url,
      method: xhr._hookData.method,
      headers: xhr._hookData.headers,
      data: data
    });
  }

  const originalOnReadyStateChange = xhr.onreadystatechange;

  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      const responseTime = Date.now() - (xhr._hookData?.sendTime || 0);

      console.log('[XHR Hook] response:', {
        url: xhr._hookData?.url,
        status: xhr.status,
        statusText: xhr.statusText,
        responseTime: responseTime + 'ms',
        responseHeaders: xhr.getAllResponseHeaders(),
        responseType: xhr.responseType,
        responseURL: xhr.responseURL
      });

      try {
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          console.log('[XHR Hook] responseText:', xhr.responseText?.substring(0, 500));
        } else if (xhr.responseType === 'json') {
          console.log('[XHR Hook] responseJSON:', xhr.response);
        } else {
          console.log('[XHR Hook] response:', typeof xhr.response);
        }
      } catch (e) {
        console.warn('[XHR Hook] Failed to log response:', e);
      }
    }

    if (originalOnReadyStateChange) {
      return originalOnReadyStateChange.apply(this, arguments);
    }
  };

  const originalAddEventListener = xhr.addEventListener;
  xhr.addEventListener = function(event, listener, ...args) {
    if (event === 'load' || event === 'error' || event === 'abort') {
      const wrappedListener = function(e) {
        console.log(\`[XHR Hook] event '\${event}':\`, {
          url: xhr._hookData?.url,
          status: xhr.status
        });
        return listener.apply(this, arguments);
      };
      return originalAddEventListener.call(this, event, wrappedListener, ...args);
    }
    return originalAddEventListener.apply(this, arguments);
  };

  ${customCode || ''}

  return originalSend.apply(this, arguments);
};

console.log('[Hook] XHR hooked successfully');
})();
`.trim();
}

export function generateFetchHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const originalFetch = window.fetch;

window.fetch = new Proxy(originalFetch, {
  apply: function(target, thisArg, args) {
    const [resource, config] = args;

    let url, method, headers, body;

    if (resource instanceof Request) {
      url = resource.url;
      method = resource.method;
      headers = Object.fromEntries(resource.headers.entries());
      body = resource.body;
    } else {
      url = resource;
      method = config?.method || 'GET';
      headers = config?.headers || {};
      body = config?.body;
    }

    const hookContext = {
      url: url,
      method: method,
      headers: headers,
      body: body,
      timestamp: Date.now(),
      stackTrace: new Error().stack.split('\\n').slice(2, 5).join('\\n')
    };

    console.log('[Fetch Hook] request:', hookContext);

    ${action === 'block' ? 'return Promise.reject(new Error("Fetch blocked by hook"));' : ''}
    ${customCode || ''}

    const startTime = performance.now();

    return Reflect.apply(target, thisArg, args)
      .then(async response => {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        const clonedResponse = response.clone();

        const responseInfo = {
          url: url,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          redirected: response.redirected,
          type: response.type,
          headers: Object.fromEntries(response.headers.entries()),
          duration: duration + 'ms'
        };

        console.log('[Fetch Hook] response:', responseInfo);

        try {
          const contentType = response.headers.get('content-type') || '';

          if (contentType.includes('application/json')) {
            const json = await clonedResponse.json();
            console.log('[Fetch Hook] responseJSON:', json);
          } else if (contentType.includes('text/')) {
            const text = await clonedResponse.text();
            console.log('[Fetch Hook] responseText:', text.substring(0, 500));
          } else {
            console.log('[Fetch Hook] response type:', contentType);
          }
        } catch (e) {
          console.warn('[Fetch Hook] Failed to parse response:', e.message);
        }

        return response;
      })
      .catch(error => {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        console.error('[Fetch Hook] error:', {
          url: url,
          error: error.message,
          duration: duration + 'ms'
        });

        throw error;
      });
  }
});

console.log('[Fetch Hook] Successfully hooked window.fetch');
})();
`.trim();
}

export function generateWebSocketHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const OriginalWebSocket = window.WebSocket;
let wsCounter = 0;

window.WebSocket = function(url, protocols) {
  const wsId = ++wsCounter;
  const connectTime = Date.now();

  console.log(\`[WebSocket Hook #\${wsId}] connecting:\`, {
    url: url,
    protocols: protocols,
    timestamp: new Date().toISOString()
  });

  ${action === 'block' ? 'throw new Error("WebSocket blocked by hook");' : ''}

  const ws = new OriginalWebSocket(url, protocols);

  const originalSend = ws.send;
  ws.send = function(data) {
    const dataInfo = {
      wsId: wsId,
      url: url,
      timestamp: new Date().toISOString(),
      dataType: typeof data,
      size: data?.length || data?.byteLength || data?.size || 0
    };

    if (typeof data === 'string') {
      dataInfo.content = data.length > 500 ? data.substring(0, 500) + '...' : data;
    } else if (data instanceof ArrayBuffer) {
      dataInfo.content = \`ArrayBuffer(\${data.byteLength} bytes)\`;
    } else if (data instanceof Blob) {
      dataInfo.content = \`Blob(\${data.size} bytes, \${data.type})\`;
    }

    console.log(\`[WebSocket Hook #\${wsId}] send:\`, dataInfo);

    ${customCode || ''}

    return originalSend.apply(this, arguments);
  };

  ws.addEventListener('open', function(event) {
    const duration = Date.now() - connectTime;
    console.log(\`[WebSocket Hook #\${wsId}] open:\`, {
      url: url,
      readyState: ws.readyState,
      protocol: ws.protocol,
      extensions: ws.extensions,
      duration: duration + 'ms'
    });
  });

  ws.addEventListener('message', function(event) {
    const messageInfo = {
      wsId: wsId,
      url: url,
      timestamp: new Date().toISOString(),
      dataType: typeof event.data
    };

    if (typeof event.data === 'string') {
      messageInfo.content = event.data.length > 500 ? event.data.substring(0, 500) + '...' : event.data;
    } else if (event.data instanceof ArrayBuffer) {
      messageInfo.content = \`ArrayBuffer(\${event.data.byteLength} bytes)\`;
    } else if (event.data instanceof Blob) {
      messageInfo.content = \`Blob(\${event.data.size} bytes, \${event.data.type})\`;
    }

    console.log(\`[WebSocket Hook #\${wsId}] message:\`, messageInfo);
  });

  ws.addEventListener('error', function(event) {
    console.error(\`[WebSocket Hook #\${wsId}] error:\`, {
      url: url,
      readyState: ws.readyState,
      timestamp: new Date().toISOString()
    });
  });

  ws.addEventListener('close', function(event) {
    const duration = Date.now() - connectTime;
    console.log(\`[WebSocket Hook #\${wsId}] close:\`, {
      url: url,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      duration: duration + 'ms',
      timestamp: new Date().toISOString()
    });
  });

  return ws;
};

window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
window.WebSocket.OPEN = OriginalWebSocket.OPEN;
window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

console.log('[WebSocket Hook] Successfully hooked window.WebSocket');
})();
`.trim();
}

export function generateLocalStorageHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const originalSetItem = Storage.prototype.setItem;
const originalGetItem = Storage.prototype.getItem;
const originalRemoveItem = Storage.prototype.removeItem;
const originalClear = Storage.prototype.clear;

Storage.prototype.setItem = function(key, value) {
  const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
  const stackTrace = new Error().stack.split('\\n').slice(2, 4).join('\\n');

  console.log(\`[Storage Hook] \${storageType}.setItem:\`, {
    key: key,
    value: value,
    valueType: typeof value,
    valueLength: value?.length || 0,
    stackTrace: stackTrace
  });

  ${action === 'block' ? 'return;' : ''}
  ${customCode || ''}

  return originalSetItem.apply(this, arguments);
};

Storage.prototype.getItem = function(key) {
  const value = originalGetItem.apply(this, arguments);
  const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';

  console.log(\`[Storage Hook] \${storageType}.getItem:\`, {
    key: key,
    value: value,
    found: value !== null
  });

  return value;
};

Storage.prototype.removeItem = function(key) {
  const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
  const oldValue = this.getItem(key);

  console.log(\`[Storage Hook] \${storageType}.removeItem:\`, {
    key: key,
    oldValue: oldValue
  });

  return originalRemoveItem.apply(this, arguments);
};

Storage.prototype.clear = function() {
  const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
  const itemCount = this.length;

  console.log(\`[Storage Hook] \${storageType}.clear:\`, {
    itemCount: itemCount,
    items: Object.keys(this)
  });

  return originalClear.apply(this, arguments);
};

console.log('[Storage Hook] Successfully hooked localStorage and sessionStorage');
})();
`.trim();
}

export function generateCookieHook(
  action: string,
  customCode?: string,
  _condition?: HookOptions['condition'],
  _performance = false
): string {
  return `
(function() {
'use strict';

const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                         Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

if (!cookieDescriptor) {
  console.error('[Cookie Hook] Failed to get cookie descriptor');
  return;
}

const originalGet = cookieDescriptor.get;
const originalSet = cookieDescriptor.set;

function parseCookie(cookieString) {
  const parts = cookieString.split(';')[0].split('=');
  return {
    name: parts[0]?.trim(),
    value: parts[1]?.trim(),
    raw: cookieString
  };
}

Object.defineProperty(document, 'cookie', {
  get: function() {
    const value = originalGet.call(this);

    console.log('[Cookie Hook] get:', {
      value: value,
      cookieCount: value ? value.split(';').length : 0
    });

    return value;
  },
  set: function(value) {
    const cookieInfo = parseCookie(value);
    const stackTrace = new Error().stack.split('\\n').slice(2, 4).join('\\n');

    console.log('[Cookie Hook] set:', {
      name: cookieInfo.name,
      value: cookieInfo.value,
      raw: cookieInfo.raw,
      stackTrace: stackTrace
    });

    ${action === 'block' ? 'return;' : ''}
    ${customCode || ''}

    return originalSet.call(this, value);
  },
  configurable: true
});

console.log('[Cookie Hook] Successfully hooked document.cookie');
})();
`.trim();
}

export function getInjectionInstructions(type: HookOptions['type']): string {
  return `This hook script monitors ${type} operations. Inject it into the target page via page_evaluate or console_execute to activate.`;
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

export function generateHookChain(hooks: HookResult[]): string {
  const scripts = hooks.map((h) => h.script).join('\n\n');
  return `

${scripts}

console.log('[Hook Chain] All ${hooks.length} hooks initialized');
`.trim();
}
