import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as parser from '@babel/parser';
import { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('CodeAnalyzer - Branch Coverage', () => {
  let analyzer: CodeAnalyzer;
  beforeEach(() => {
    vi.restoreAllMocks();
    analyzer = new CodeAnalyzer();
  });

  describe('understand() Error Handling', () => {
    it('catches and rethrows errors during analysis', async () => {
      const mx = new CodeAnalyzer();
      vi.spyOn(mx as any, 'aiAnalyze').mockRejectedValue(new Error('Mocked analysis failure'));
      await expect(mx.understand({ code: 'const a = 1;' })).rejects.toThrow(
        'Mocked analysis failure',
      );
    });

    it('swallows parse errors gracefully inside analyzeStructure', async () => {
      const analyzerStr = new CodeAnalyzer('legacy');
      const result = await analyzerStr.understand({ code: 'invalid js code +*- =' });
      expect(result.structure.functions).toHaveLength(0);
    });
  });

  describe('analyzeStructure() AST edge cases', () => {
    it('handles anonymous declarations and non-identifier params', async () => {
      const code = `
        export default function() {} 
        export default class {} 
        
        const arr = [function() {}]; 
        const obj = { method: () => {} }; 
        
        function destructure({a, b}, ...rest) {} 
        
        class TestClass {
          ['computed']() {} 
          "literal"() {} 
          method([a]) {} 
          ['computedProp'] = 1;
          "literalProp" = 2;
        }
      `;
      const result = await analyzer.understand({ code });
      const funcs = result.structure.functions;
      expect(funcs.some((f) => f.name === 'anonymous')).toBe(true);
      expect(funcs.some((f) => f.name === 'arrow')).toBe(true);
      expect(result.structure.classes.some((c) => c.name === 'anonymous')).toBe(true);
      const testClass = result.structure.classes.find((c) => c.name === 'TestClass');
      expect(testClass).toBeDefined();
      expect(testClass?.methods.some((m) => m.name === 'unknown')).toBe(true);
    });

    it('handles ArrowFunctionExpression variables and params', async () => {
      const code = `
        const myArrow = (paramA, { paramB }) => {};
        const myExpr = function({ paramC }) {};
        
        let myAssignedFunc;
        myAssignedFunc = function([a]) {};
        
        let anotherAssignedFunc;
        anotherAssignedFunc = function(normalParam) {};
        
        let myAssignedArrow;
        myAssignedArrow = () => {};
      `;
      const res = await analyzer.understand({ code });
      const fns = res.structure.functions;
      const arrowFn = fns.find((f) => f.name === 'myArrow');
      expect(arrowFn).toBeDefined();
      expect(arrowFn?.params).toEqual(['paramA', 'unknown']);

      const exprFn = fns.find((f) => f.name === 'myExpr');
      expect(exprFn).toBeDefined();

      const assignedFn = fns.find((f) => f.name === 'myAssignedFunc');
      expect(assignedFn).toBeDefined();

      // myAssignedArrow won't have the name 'myAssignedArrow' because the Arrow visitor only checks VariableDeclarator!
      // But it hits the parser anyway.
    });
  });

  describe('AST syntax error handling inside internal traversals', () => {
    it('handles parsing failures in sub-analyzers without throwing', async () => {
      const parseSpy = vi
        .spyOn(parser, 'parse')
        .mockImplementationOnce(() => {
          return { type: 'File', program: { type: 'Program', body: [] } } as any;
        })
        .mockImplementationOnce(() => {
          throw new Error('Module parse error');
        })
        .mockImplementationOnce(() => {
          throw new Error('Callgraph parse error');
        });

      const code = 'const x = 1;';
      const result = await analyzer.understand({ code });

      expect(result.structure.modules).toEqual([]);
      expect(result.structure.callGraph.edges).toEqual([]);

      parseSpy.mockRestore();
    });
  });

  describe('detectTechStack() Branch Coverage', () => {
    it('detects frameworks and bundlers via string matching', async () => {
      const reactCode = 'import React, { useState, useEffect } from "react";';
      const vueCode = 'import { createApp } from "vue"; Vue.blah()';
      const angularCode = 'import { Component } from "@angular/core";';
      const webpackCode = '__webpack_require__("module");';

      const reactRes = await analyzer.understand({ code: reactCode });
      expect(reactRes.techStack.framework).toBe('React');

      const vueRes = await analyzer.understand({ code: vueCode });
      expect(vueRes.techStack.framework).toBe('Vue');

      const ngRes = await analyzer.understand({ code: angularCode });
      expect(ngRes.techStack.framework).toBe('Angular');

      const wpRes = await analyzer.understand({ code: webpackCode });
      expect(wpRes.techStack.bundler).toBe('Webpack');
    });

    it('detects crypto libraries via string matching', async () => {
      const cryptoCode = 'CryptoJS.AES; new JSEncrypt(); require("crypto-js");';
      const res = await analyzer.understand({ code: cryptoCode });
      expect(res.techStack.cryptoLibrary).toContain('CryptoJS');
      expect(res.techStack.cryptoLibrary).toContain('JSEncrypt');
      expect(res.techStack.cryptoLibrary).toContain('crypto-js');
    });

    it('uses AI analysis techStack output when provided', async () => {
      const mx = new CodeAnalyzer();
      vi.spyOn(mx as any, 'aiAnalyze').mockResolvedValue({
        techStack: {
          framework: 'CustomFramework',
          bundler: 'CustomBundler',
          libraries: ['LibA', 'LibB'],
        },
      });
      const res = await mx.understand({ code: 'const x = 1;' });
      expect(res.techStack.framework).toBe('CustomFramework');
      expect(res.techStack.bundler).toBe('CustomBundler');
      expect(res.techStack.other).toEqual(['LibA', 'LibB']);
    });
  });

  describe('extractBusinessLogic() Branch Coverage', () => {
    it('extracts structured business logic from ai analysis', async () => {
      const mx = new CodeAnalyzer();
      vi.spyOn(mx as any, 'aiAnalyze').mockResolvedValue({
        businessLogic: {
          mainFeatures: ['FeatureA'],
          dataFlow: 'FlowRule',
        },
      });
      const res = await mx.understand({ code: 'const x = 1;' });
      expect(res.businessLogic.mainFeatures).toEqual(['FeatureA']);
      expect(res.businessLogic.rules).toContain('FlowRule');
    });

    it('ignores invalid types in ai analysis objects', async () => {
      const mx = new CodeAnalyzer();
      vi.spyOn(mx as any, 'aiAnalyze').mockResolvedValue({
        techStack: {
          framework: 'React',
          libraries: 'not-an-array', // line 255 false
        },
        businessLogic: {
          mainFeatures: 'not-an-array', // line 296 false
          dataFlow: { not: 'a string' }, // line 299 false
        },
      });
      const res = await mx.understand({ code: 'const x = 1;' });
      expect(res.techStack.framework).toBe('React');
      expect(res.techStack.other).toEqual([]); // Fallback
      expect(res.businessLogic.mainFeatures).toEqual([]);
      expect(res.businessLogic.rules).toEqual([]);
    });
  });

  describe('analyzeModules() and buildCallGraph()', () => {
    it('extracts named and default exports', async () => {
      const code = `
        export { foo } from './foo';
        export default function() {}
      `;
      const res = await analyzer.understand({ code });
      const mods = res.structure.modules;
      expect(mods.length).toBeGreaterThan(0);
      expect(mods[0]!.exports).toContain('./foo');
      expect(mods[0]!.exports).toContain('default');
    });

    it('creates call graph edges correctly for varying call expressions', async () => {
      const code = `
        function target1() {}
        function target2() {}
        
        function caller() {
          target1(); 
          obj.target2(); 
          obj['target2'](); 
          unknownFunction(); 
        }
        
        const callerExpr = function() {
           target1(); 
        }
      `;
      const res = await analyzer.understand({ code });
      const edges = res.structure.callGraph.edges;

      expect(edges.some((e) => e.from === 'caller' && e.to === 'target1')).toBe(true);
      expect(edges.some((e) => e.from === 'caller' && e.to === 'target2')).toBe(true);
      expect(edges.some((e) => e.from === 'callerExpr' && e.to === 'target1')).toBe(true);
      expect(edges.some((e) => e.to === 'unknownFunction')).toBe(false);
    });
  });

  describe('calculateComplexity() AST visitors', () => {
    it('increments complexity for flow control statements', async () => {
      const code = `
        function complex() {
          if (a) {
             for(let i=0; i<1; i++) {}
          }
          switch(b) {
             case 1: break;
          }
          while(false) {}
          do {} while(false);
          const x = c ? 1 : 2;
          const y = d && e || f;
          const z = a ?? b;
          try {
             throw new Error();
          } catch(e) {}
        }
      `;
      const res = await analyzer.understand({ code });
      const complexFn = res.structure.functions.find((f) => f.name === 'complex');
      expect(complexFn?.complexity).toBe(10);
    });

    it('handles non-traversable paths safely in calculateComplexity', () => {
      const subject = new CodeAnalyzer() as any;
      expect(subject.calculateComplexity({})).toBe(1);
      expect(subject.calculateComplexity({ traverse: 'not-a-function' })).toBe(1);
    });
  });
});
