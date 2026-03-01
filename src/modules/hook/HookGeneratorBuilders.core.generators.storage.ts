import type { HookOptions } from '../../types/index.js';

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

