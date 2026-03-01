interface EvaluatablePage {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
}

interface FrameworkStateHandlersDeps {
  getActivePage: () => Promise<unknown>;
}

export class FrameworkStateHandlers {
  constructor(private deps: FrameworkStateHandlersDeps) {}

  async handleFrameworkStateExtract(args: Record<string, unknown>) {
    const framework = (args.framework as string | undefined) ?? 'auto';
    const selector = (args.selector as string | undefined) ?? '';
    const maxDepth = (args.maxDepth as number | undefined) ?? 5;

    try {
      const page = (await this.deps.getActivePage()) as EvaluatablePage;
      const result = await page.evaluate(
        (opts: { framework: string; selector: string; maxDepth: number }) => {
          type AnyObj = Record<string, unknown>;

          function safeSerialize(val: unknown, depth = 0): unknown {
            if (depth > 4) return '[deep]';
            if (val === null || val === undefined) return val;
            if (typeof val === 'function') return '[Function]';
            if (typeof val !== 'object') return val;
            if (Array.isArray(val)) {
              return (val as unknown[]).slice(0, 20).map((v) => safeSerialize(v, depth + 1));
            }
            try {
              const out: Record<string, unknown> = {};
              let count = 0;
              for (const k of Object.keys(val as object)) {
                if (count++ > 30) {
                  out['__truncated__'] = true;
                  break;
                }
                out[k] = safeSerialize((val as AnyObj)[k], depth + 1);
              }
              return out;
            } catch {
              return '[unserializable]';
            }
          }

          const getRootEl = (): Element => {
            if (opts.selector) {
              return document.querySelector(opts.selector) ?? document.body;
            }
            return (
              document.getElementById('root') ??
              document.getElementById('app') ??
              document.querySelector('[data-reactroot]') ??
              document.body
            );
          };

          const extractReact = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const fiberKey = Object.keys(rootObj).find(
              (k) =>
                k.startsWith('__reactFiber') ||
                k.startsWith('__reactInternalInstance') ||
                k.startsWith('__reactFiberContainer')
            );
            if (!fiberKey) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitFiber = (fiber: AnyObj | null, depth: number): void => {
              if (!fiber || depth > opts.maxDepth || visited.has(fiber)) return;
              visited.add(fiber);

              if (fiber['memoizedState']) {
                const stateList: unknown[] = [];
                let s = fiber['memoizedState'] as AnyObj | null;
                let guard = 0;
                while (s && guard++ < 20) {
                  const queue = s['queue'] as AnyObj | undefined;
                  const val =
                    s['memoizedState'] !== undefined
                      ? s['memoizedState']
                      : queue?.['lastRenderedState'];
                  if (val !== undefined) stateList.push(safeSerialize(val));
                  s = (s['next'] as AnyObj | null | undefined) ?? null;
                }
                if (stateList.length > 0) {
                  const fiberType = fiber['type'] as AnyObj | string | undefined;
                  const componentName =
                    typeof fiberType === 'object' && fiberType !== null
                      ? String(fiberType['name'] ?? 'anonymous')
                      : typeof fiberType === 'string'
                        ? fiberType
                        : 'anonymous';
                  states.push({ component: componentName, state: stateList });
                }
              }

              visitFiber((fiber['child'] as AnyObj | null | undefined) ?? null, depth + 1);
              visitFiber((fiber['sibling'] as AnyObj | null | undefined) ?? null, depth + 1);
            };

            visitFiber((rootObj[fiberKey] as AnyObj | null | undefined) ?? null, 0);
            return states;
          };

          const extractVue3 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find(
              (k) => k === '__vueParentComponent' || k === '__vue_app__' || k.startsWith('__vue')
            );
            if (!vueKey) return null;

            const comp = rootObj[vueKey] as AnyObj | null;
            if (!comp) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitComp = (c: AnyObj, depth: number): void => {
              if (!c || depth > opts.maxDepth || visited.has(c)) return;
              visited.add(c);

              const setupState = safeSerialize(c['setupState'] ?? c['ctx']);
              const data = safeSerialize(c['$data'] ?? c['data']);
              if (setupState || data) {
                const compType = c['type'] as AnyObj | undefined;
                states.push({
                  component: compType?.['__name'] ?? 'unknown',
                  setupState,
                  data,
                });
              }

              const subTree = c['subTree'] as AnyObj | undefined;
              const children = subTree?.['children'];
              if (Array.isArray(children)) {
                for (const child of children as AnyObj[]) {
                  if (child?.['component']) {
                    visitComp(child['component'] as AnyObj, depth + 1);
                  }
                }
              }
            };

            visitComp(comp, 0);
            return states;
          };

          const extractVue2 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find((k) => k === '__vue__');
            if (!vueKey) return null;

            const vm = rootObj[vueKey] as AnyObj | null;
            if (!vm) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitVm = (v: AnyObj, depth: number): void => {
              if (!v || depth > opts.maxDepth || visited.has(v)) return;
              visited.add(v);

              const options = v['$options'] as AnyObj | undefined;
              states.push({
                component: options?.['name'] ?? 'unknown',
                data: safeSerialize(v['$data']),
              });

              const children = v['$children'] as AnyObj[] | undefined;
              if (Array.isArray(children)) {
                for (const child of children) visitVm(child, depth + 1);
              }
            };

            visitVm(vm, 0);
            return states;
          };

          const rootEl = getRootEl();
          const rootObj = rootEl as unknown as AnyObj;
          const keys = Object.keys(rootObj);

          let detectedFramework = opts.framework;
          if (detectedFramework === 'auto') {
            if (
              keys.some(
                (k) =>
                  k.startsWith('__reactFiber') ||
                  k.startsWith('__reactInternalInstance')
              )
            ) {
              detectedFramework = 'react';
            } else if (
              keys.some(
                (k) => k === '__vueParentComponent' || k === '__vue_app__'
              )
            ) {
              detectedFramework = 'vue3';
            } else if (keys.some((k) => k === '__vue__')) {
              detectedFramework = 'vue2';
            }
          }

          let states: unknown[] | null = null;
          if (detectedFramework === 'react' || detectedFramework === 'auto') {
            states = extractReact();
          }
          if (
            !states &&
            (detectedFramework === 'vue3' || detectedFramework === 'auto')
          ) {
            states = extractVue3();
          }
          if (
            !states &&
            (detectedFramework === 'vue2' || detectedFramework === 'auto')
          ) {
            states = extractVue2();
          }

          return {
            detected: detectedFramework,
            states: states ?? [],
            found: states !== null && states.length > 0,
          };
        },
        { framework, selector, maxDepth }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
