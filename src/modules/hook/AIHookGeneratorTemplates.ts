import type { AIHookRequest } from './AIHookGenerator.js';

export function generatePropertyHookTemplate(
  request: AIHookRequest,
  hookId: string
): { code: string; explanation: string } {
  const { target, behavior, condition } = request;
  const objectPath = target.object || 'window';
  const propertyName = target.property || target.name || 'unknownProperty';

  const code = `
(function() {
  const targetObject = ${objectPath};
  const propName = '${propertyName}';

  if (!targetObject) {
    console.warn('[${hookId}] Object not found: ${objectPath}');
    return;
  }

  const descriptor = Object.getOwnPropertyDescriptor(targetObject, propName)
    || (Object.getPrototypeOf(targetObject)
        ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetObject), propName)
        : undefined);

  let currentValue = descriptor ? descriptor.value : targetObject[propName];
  const originalGet = descriptor && descriptor.get ? descriptor.get : null;
  const originalSet = descriptor && descriptor.set ? descriptor.set : null;
  let callCount = 0;

  Object.defineProperty(targetObject, propName, {
    configurable: true,
    enumerable: true,
    get() {
      callCount++;
      const value = originalGet ? originalGet.call(this) : currentValue;

      const hookData = {
        hookId: '${hookId}',
        type: 'property-get',
        object: '${objectPath}',
        property: propName,
        callCount,
        timestamp: Date.now(),
        ${behavior.captureReturn ? 'value: value,' : ''}
        ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
      };

      ${behavior.logToConsole ? `console.log('[${hookId}] Property get:', hookData);` : ''}

      if (!window.__aiHooks) window.__aiHooks = {};
      if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
      window.__aiHooks['${hookId}'].push(hookData);

      return value;
    },
    set(newValue) {
      callCount++;

      ${
        condition?.argFilter
          ? `
      const args = [newValue];
      const argFilterPassed = (function() {
        try { return ${condition.argFilter}; } catch(e) { return true; }
      })();
      if (!argFilterPassed) {
        if (originalSet) originalSet.call(this, newValue); else currentValue = newValue;
        return;
      }
      `
          : ''
      }

      const hookData = {
        hookId: '${hookId}',
        type: 'property-set',
        object: '${objectPath}',
        property: propName,
        callCount,
        timestamp: Date.now(),
        ${behavior.captureArgs ? 'newValue: newValue,' : ''}
        ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
      };

      ${behavior.logToConsole ? `console.log('[${hookId}] Property set:', hookData);` : ''}

      if (!window.__aiHooks) window.__aiHooks = {};
      if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
      window.__aiHooks['${hookId}'].push(hookData);

      if (!${behavior.blockExecution ? 'true' : 'false'}) {
        if (originalSet) originalSet.call(this, newValue); else currentValue = newValue;
      }
    },
  });

  console.log('[${hookId}] Property hook installed for: ${objectPath}.${propertyName}');
})();
`;

  const explanation = `Property hook: ${objectPath}.${propertyName} (get + set intercepted via Object.defineProperty)`;
  return { code, explanation };
}

export function generateEventHookTemplate(
  request: AIHookRequest,
  hookId: string
): { code: string; explanation: string } {
  const { target, behavior, condition } = request;
  const eventType = target.name || target.property || '';
  const maxCalls = condition?.maxCalls || 'Infinity';

  const code = `
(function() {
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  let callCount = 0;

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    ${
      eventType
        ? `if (type !== '${eventType}') {
      return originalAddEventListener.call(this, type, listener, options);
    }`
        : ''
    }

    const wrappedListener = function(event) {
      callCount++;
      const maxCalls = ${maxCalls};

      if (callCount <= maxCalls) {
        const hookData = {
          hookId: '${hookId}',
          type: 'event',
          eventType: type,
          callCount,
          timestamp: Date.now(),
          ${
            behavior.captureArgs
              ? `event: {
            type: event.type,
            target: event.target ? (event.target.tagName || String(event.target)) : null,
            detail: event.detail != null ? event.detail : null,
          },`
              : ''
          }
          ${behavior.captureStack ? 'stack: new Error().stack,' : ''}
        };

        ${behavior.logToConsole ? `console.log('[${hookId}] Event fired:', hookData);` : ''}

        if (!window.__aiHooks) window.__aiHooks = {};
        if (!window.__aiHooks['${hookId}']) window.__aiHooks['${hookId}'] = [];
        window.__aiHooks['${hookId}'].push(hookData);
      }

      ${
        behavior.blockExecution
          ? `// Execution blocked`
          : `if (typeof listener === 'function') {
        listener.call(this, event);
      } else if (listener && typeof listener.handleEvent === 'function') {
        listener.handleEvent(event);
      }`
      }
    };

    return originalAddEventListener.call(this, type, wrappedListener, options);
  };

  console.log('[${hookId}] Event hook installed for: ${eventType || 'all events'}');
})();
`;

  const explanation = `Event hook: ${eventType ? `"${eventType}" events` : 'all events'} via EventTarget.prototype.addEventListener override`;
  return { code, explanation };
}
