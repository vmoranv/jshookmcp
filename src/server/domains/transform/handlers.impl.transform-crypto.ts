import {
  CRYPTO_KEYWORDS,
  type CryptoExtractCandidate,
  type CryptoExtractPayload,
} from './handlers.impl.transform-base.js';
import { TransformToolHandlersOps } from './handlers.impl.transform-ops.js';

export class TransformToolHandlersCrypto extends TransformToolHandlersOps {
  async handleCryptoExtractStandalone(args: Record<string, unknown>) {
    try {
      const targetFunction = this.requireString(args.targetFunction, 'targetFunction').trim();
      const includePolyfills = this.parseBoolean(args.includePolyfills, true);
      const page = await this.collector.getActivePage();

      const extracted = (await page.evaluate(
        (target, keywords): CryptoExtractPayload => {
          const keywordList = Array.isArray(keywords) ? keywords : [];
          const lowerKeywords = keywordList.map((item) => String(item).toLowerCase());
          const globalObj: Record<string, unknown> = window as unknown as Record<string, unknown>;

          const resolvePath = (path: string): unknown => {
            const normalized = path.startsWith('window.') ? path.slice(7) : path;
            const parts = normalized.split('.').filter(Boolean);
            let cursor: unknown = window;
            for (const part of parts) {
              if (
                cursor === null ||
                cursor === undefined ||
                (typeof cursor !== 'object' && typeof cursor !== 'function')
              ) {
                return undefined;
              }
              const carrier = cursor as Record<string, unknown>;
              if (!(part in carrier)) {
                return undefined;
              }
              cursor = carrier[part];
            }
            return cursor;
          };

          const scoreFunction = (path: string, source: string): number => {
            const text = (path + '\\n' + source).toLowerCase();
            let score = 0;
            for (const keyword of lowerKeywords) {
              if (text.includes(keyword)) {
                score += 1;
              }
            }
            return score;
          };

          const candidates: CryptoExtractCandidate[] = [];
          const pushCandidate = (path: string, value: unknown, boost = 0) => {
            if (typeof value !== 'function') return;
            const source = Function.prototype.toString.call(value);
            if (source.includes('[native code]')) return;

            const score = scoreFunction(path, source) + boost;
            if (score <= 0 && boost <= 0) return;

            candidates.push({
              path,
              source,
              score,
            });
          };

          if (target.length > 0) {
            const resolved = resolvePath(target);
            pushCandidate(target, resolved, 100);
          }

          const globalKeys = Object.getOwnPropertyNames(globalObj).slice(0, 800);
          for (const key of globalKeys) {
            const topValue = globalObj[key];
            pushCandidate('window.' + key, topValue);

            if (topValue && typeof topValue === 'object') {
              const nestedObj = topValue as Record<string, unknown>;
              const nestedKeys = Object.keys(nestedObj).slice(0, 40);
              for (const nestedKey of nestedKeys) {
                pushCandidate('window.' + key + '.' + nestedKey, nestedObj[nestedKey]);
              }
            }
          }

          candidates.sort((a, b) => b.score - a.score);

          const selected = candidates[0];
          if (!selected) {
            return {
              targetPath: null,
              targetSource: '',
              candidates: [],
              dependencies: [],
              dependencySnippets: [],
            };
          }

          const identifierRegex = /\\b[A-Za-z_$][A-Za-z0-9_$]{1,}\\b/g;
          const reserved = new Set([
            'function',
            'return',
            'const',
            'let',
            'var',
            'if',
            'else',
            'for',
            'while',
            'switch',
            'case',
            'break',
            'continue',
            'new',
            'this',
            'window',
            'globalThis',
            'Math',
            'JSON',
            'Date',
            'Array',
            'Object',
            'String',
            'Number',
            'Boolean',
            'Promise',
            'RegExp',
            'Error',
            'null',
            'undefined',
            'true',
            'false',
            'async',
            'await',
          ]);

          const dependencyNames = Array.from(
            new Set((selected.source.match(identifierRegex) ?? []).filter((name) => !reserved.has(name)))
          ).slice(0, 30);

          const dependencySnippets: string[] = [];
          for (const depName of dependencyNames) {
            if (!(depName in globalObj)) continue;
            const depValue = globalObj[depName];

            if (typeof depValue === 'function') {
              const depSource = Function.prototype.toString.call(depValue);
              if (!depSource.includes('[native code]') && depSource.length < 50000) {
                dependencySnippets.push('const ' + depName + ' = ' + depSource + ';');
              }
              continue;
            }

            if (
              depValue === null ||
              typeof depValue === 'string' ||
              typeof depValue === 'number' ||
              typeof depValue === 'boolean'
            ) {
              dependencySnippets.push('const ' + depName + ' = ' + JSON.stringify(depValue) + ';');
              continue;
            }

            if (typeof depValue === 'object') {
              try {
                const serialized = JSON.stringify(depValue);
                if (serialized && serialized.length < 4000) {
                  dependencySnippets.push('const ' + depName + ' = ' + serialized + ';');
                }
              } catch {
                // ignore non-serializable object
              }
            }
          }

          return {
            targetPath: selected.path,
            targetSource: selected.source,
            candidates: candidates.slice(0, 20),
            dependencies: dependencyNames,
            dependencySnippets,
          };
        },
        targetFunction,
        CRYPTO_KEYWORDS
      )) as CryptoExtractPayload;

      if (!extracted || extracted.targetSource.trim().length === 0) {
        throw new Error('No crypto/signature-like function found on current page');
      }

      const functionName = this.resolveFunctionName(
        targetFunction,
        extracted.targetPath ?? '',
        extracted.targetSource
      );
      const sections: string[] = [`'use strict';`];

      if (includePolyfills) {
        sections.push(this.buildCryptoPolyfills());
      }

      if (extracted.dependencySnippets.length > 0) {
        sections.push(extracted.dependencySnippets.join('\n'));
      }

      sections.push(`const ${functionName} = ${extracted.targetSource.trim()};`);
      sections.push(
        `if (typeof globalThis !== 'undefined') { globalThis.${functionName} = ${functionName}; }`
      );

      const extractedCode = sections.filter((part) => part.trim().length > 0).join('\n\n');

      return this.toTextResponse({
        extractedCode,
        dependencies: extracted.dependencies,
        size: extractedCode.length,
      });
    } catch (error) {
      return this.fail('crypto_extract_standalone', error);
    }
  }

  async handleCryptoTestHarness(args: Record<string, unknown>) {
    try {
      const code = this.requireString(args.code, 'code');
      const functionName = this.requireString(args.functionName, 'functionName');
      const testInputs = this.parseTestInputs(args.testInputs);

      const harness = await this.runCryptoHarness(code, functionName, testInputs);

      return this.toTextResponse({
        results: harness.results.map((row) => ({
          input: row.input,
          output: row.output,
          duration: row.duration,
          ...(row.error ? { error: row.error } : {}),
        })),
        allPassed: harness.allPassed,
      });
    } catch (error) {
      return this.fail('crypto_test_harness', error);
    }
  }

  async handleCryptoCompare(args: Record<string, unknown>) {
    try {
      const code1 = this.requireString(args.code1, 'code1');
      const code2 = this.requireString(args.code2, 'code2');
      const functionName = this.requireString(args.functionName, 'functionName');
      const testInputs = this.parseTestInputs(args.testInputs);

      const [run1, run2] = await Promise.all([
        this.runCryptoHarness(code1, functionName, testInputs),
        this.runCryptoHarness(code2, functionName, testInputs),
      ]);

      const rows = testInputs.map((input, index) => {
        const left = run1.results[index] ?? {
          input,
          output: '',
          duration: 0,
          error: 'missing result from implementation #1',
        };
        const right = run2.results[index] ?? {
          input,
          output: '',
          duration: 0,
          error: 'missing result from implementation #2',
        };

        const sameOutput = left.output === right.output;
        const noError = !left.error && !right.error;

        return {
          input,
          output1: left.output,
          output2: right.output,
          duration1: left.duration,
          duration2: right.duration,
          match: sameOutput && noError,
          ...(left.error ? { error1: left.error } : {}),
          ...(right.error ? { error2: right.error } : {}),
        };
      });

      const matches = rows.filter((row) => row.match).length;
      const mismatches = rows.length - matches;

      return this.toTextResponse({
        matches,
        mismatches,
        results: rows,
      });
    } catch (error) {
      return this.fail('crypto_compare', error);
    }
  }


}
