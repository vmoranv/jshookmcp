/**
 * Helper to build Wasabi-style runtime instrumentation hook code for WASM modules.
 */
export function buildWasmHookCode(hooks: string[]): {
  activeHooks: string[];
  activeHookCode: string;
} {
  const hookPreamble = `
  const hookedExports = {};
  for (const [k, v] of Object.entries(instance.exports)) { hookedExports[k] = v; }`;

  const hookInitCode: Record<string, string> = {
    call: `
  const callLog = [];
  for (const [name, value] of Object.entries(instance.exports)) {
    if (typeof value === 'function') {
      hookedExports[name] = new Proxy(value, {
        apply(target, thisArg, argumentsList) {
          const entry = { type: 'call', name, args: argumentsList.map(String), timestamp: Date.now() };
          callLog.push(entry);
          try {
            const result = Reflect.apply(target, thisArg, argumentsList);
            callLog.push({ type: 'return', name, result: String(result), timestamp: Date.now() });
            return result;
          } catch (err) {
            callLog.push({ type: 'throw', name, error: String(err), timestamp: Date.now() });
            throw err;
          }
        }
      });
    }
  }`,
    memory: `
  const memoryLog = [];
  const originalMemory = instance.exports.memory || Object.values(instance.exports).find(e => e instanceof WebAssembly.Memory);
  const memTracker = { reads: 0, writes: 0, growEvents: [] };
  if (originalMemory) {
    const memSnapshot = () => {
      const view = new DataView(originalMemory.buffer);
      return { byteLength: view.byteLength, pages: view.byteLength / 65536 };
    };
    memTracker.snapshot = memSnapshot;
    const origGrow = originalMemory.grow?.bind(originalMemory);
    if (origGrow) {
      originalMemory.grow = function(delta) {
        const beforePages = originalMemory.buffer.byteLength / 65536;
        memoryLog.push({ op: 'grow', delta, beforePages, timestamp: Date.now() });
        memTracker.growEvents.push({ delta, beforePages });
        return origGrow(delta);
      };
    }
    const memProxy = new Proxy(originalMemory, {
      get(target, prop) {
        if (prop === 'buffer') {
          memTracker.reads++;
        }
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
    const memExportName = Object.entries(instance.exports).find(([, v]) => v === originalMemory)?.[0] || 'memory';
    hookedExports[memExportName] = memProxy;
    memTracker.buffer = originalMemory.buffer;
  }`,
    branch: `
  // === Branch Hook: Tracks JS-visible WebAssembly.Table access only ===
  // Internal call_indirect dispatch stays inside the Wasm engine and is not observable from JS.
  const branchLog = [];
  for (const [tableName, table] of Object.entries(instance.exports)) {
    if (!(table instanceof WebAssembly.Table)) continue;
    const origGet = table.get.bind(table);
    const origGrow = table.grow?.bind(table);
    hookedExports[tableName] = new Proxy(table, {
        get(t, prop) {
          if (prop === 'get') {
            return (idx) => {
              branchLog.push({ type: 'table_get', table: tableName, index: idx, timestamp: Date.now() });
              return origGet(idx);
            };
          }
          if (prop === 'grow' && origGrow) {
            return (delta) => {
              branchLog.push({ type: 'table_grow', table: tableName, delta, timestamp: Date.now() });
              return origGrow(delta);
            };
          }
          const val = t[prop];
          return typeof val === 'function' ? val.bind(t) : val;
        }
      });
  }`,
    loop: `
  const loopLog = [];
  const loopCallCounts = {};
  const loopSource = hookedExports;
  for (const [name, value] of Object.entries(loopSource)) {
    if (typeof value === 'function') {
      hookedExports[name] = new Proxy(value, {
        apply(target, thisArg, args) {
          loopCallCounts[name] = (loopCallCounts[name] || 0) + 1;
          if (loopCallCounts[name] > 1) {
            loopLog.push({ type: 'loop-iteration', func: name, count: loopCallCounts[name], timestamp: Date.now() });
          }
          return Reflect.apply(target, thisArg, args);
        }
      });
    }
  }`,
    local: `
  const localLog = [];
  for (const [globalName, global] of Object.entries(instance.exports)) {
    if (!(global instanceof WebAssembly.Global)) continue;
    hookedExports[globalName] = new Proxy(global, {
      get(target, prop) {
        if (prop === 'valueOf' || prop === Symbol.toPrimitive) {
          return (...args) => Reflect.apply(target.valueOf, target, args);
        }
        const val = Reflect.get(target, prop, target);
        if (prop === 'value' && typeof val === 'function') {
          return target.valueOf();
        }
        return typeof val === 'function' ? val.bind(target) : val;
      },
      set(target, prop, newValue) {
        if (prop === 'value') {
          const oldValue = target.valueOf();
          localLog.push({ type: 'global-set', name: globalName, oldValue, newValue, timestamp: Date.now() });
          target.value = newValue;
          return true;
        }
        return Reflect.set(target, prop, newValue, target);
      }
    });
  }`,
  };

  const activeHooks = hooks.filter((hook) => hook in hookInitCode);
  const activeHookCode =
    hookPreamble + '\n' + activeHooks.map((hook) => hookInitCode[hook]!).join('\n');

  return { activeHooks, activeHookCode };
}
