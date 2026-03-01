import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { existsSync } from 'fs';
import type {
  EnvironmentEmulatorOptions,
  EnvironmentEmulatorResult,
  DetectedEnvironmentVariables,
  MissingAPI,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { chromeEnvironmentTemplate } from './templates/chrome-env.js';
import type { LLMService } from '../../services/LLMService.js';
import type { Browser } from 'rebrowser-puppeteer-core';
import {
  generateMissingAPIImplementationsMessages,
  generateMissingVariablesMessages,
} from '../../services/prompts/environment.js';
import { generateEmulationCode, generateRecommendations } from './EmulatorCodeGen.js';
import { findBrowserExecutable } from '../../utils/browserExecutable.js';
import { fetchRealEnvironmentData } from './EnvironmentEmulatorFetch.js';

type UnknownRecord = Record<string, unknown>;

interface IdentifierNodeLike {
  type: 'Identifier';
  name: string;
}

interface StringLiteralNodeLike {
  type: 'StringLiteral';
  value: string;
}

interface MemberExpressionNodeLike {
  type: 'MemberExpression';
  object: unknown;
  property: unknown;
}

export class EnvironmentEmulator {
  private browser?: Browser;
  private llm?: LLMService;

  constructor(llm?: LLMService) {
    this.llm = llm;
    if (llm) {
      logger.info('LLM service unavailable, skipping AI environment analysis');
    }
  }

  async analyze(options: EnvironmentEmulatorOptions): Promise<EnvironmentEmulatorResult> {
    const startTime = Date.now();
    logger.info(' ...');

    const {
      code,
      targetRuntime = 'both',
      autoFetch = false,
      browserUrl,
      browserType = 'chrome',
      includeComments = true,
      extractDepth = 3,
    } = options;

    try {
      logger.info(' ...');
      const detectedVariables = this.detectEnvironmentVariables(code);

      let variableManifest: UnknownRecord = {};
      if (autoFetch && browserUrl) {
        logger.info(' ...');
        variableManifest = await this.fetchRealEnvironment(
          browserUrl,
          detectedVariables,
          extractDepth
        );
      } else {
        variableManifest = this.buildManifestFromTemplate(detectedVariables, browserType);
      }

      if (this.llm) {
        logger.info(' AI...');
        const aiInferredVars = await this.inferMissingVariablesWithAI(
          code,
          detectedVariables,
          variableManifest,
          browserType
        );
        Object.assign(variableManifest, { ...aiInferredVars, ...variableManifest });
      }

      const missingAPIs = this.identifyMissingAPIs(detectedVariables, variableManifest);

      if (this.llm && missingAPIs.length > 0) {
        logger.info(` AI ${missingAPIs.length} API...`);
        await this.generateMissingAPIImplementationsWithAI(missingAPIs, code, variableManifest);
      }

      logger.info(' ...');
      const emulationCode = generateEmulationCode(variableManifest, targetRuntime, includeComments);

      const recommendations = generateRecommendations(detectedVariables, missingAPIs);

      const totalVariables = Object.values(detectedVariables).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      const autoFilledVariables = Object.keys(variableManifest).length;
      const manualRequiredVariables = missingAPIs.length;

      const result: EnvironmentEmulatorResult = {
        detectedVariables,
        emulationCode,
        missingAPIs,
        variableManifest,
        recommendations,
        stats: {
          totalVariables,
          autoFilledVariables,
          manualRequiredVariables,
        },
      };

      const processingTime = Date.now() - startTime;
      logger.info(`Environment emulation complete in ${processingTime}ms`);
      logger.info(`  Detected ${totalVariables} variables, auto-filled ${autoFilledVariables}`);

      return result;
    } catch (error) {
      logger.error('', error);
      throw error;
    }
  }

  private detectEnvironmentVariables(code: string): DetectedEnvironmentVariables {
    const detected: DetectedEnvironmentVariables = {
      window: [],
      document: [],
      navigator: [],
      location: [],
      screen: [],
      other: [],
    };

    const accessedPaths = new Set<string>();

    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
      });

      const self = this;
      traverse(ast, {
        MemberExpression(path) {
          const fullPath = self.getMemberExpressionPath(path.node);
          if (fullPath) {
            accessedPaths.add(fullPath);
          }
        },

        Identifier(path) {
          const name = path.node.name;
          if (
            [
              'window',
              'document',
              'navigator',
              'location',
              'screen',
              'console',
              'localStorage',
              'sessionStorage',
            ].includes(name)
          ) {
            if (path.scope.hasBinding(name)) {
              return;
            }
            accessedPaths.add(name);
          }
        },
      });

      for (const path of accessedPaths) {
        if (path.startsWith('window.')) {
          detected.window.push(path);
        } else if (path.startsWith('document.')) {
          detected.document.push(path);
        } else if (path.startsWith('navigator.')) {
          detected.navigator.push(path);
        } else if (path.startsWith('location.')) {
          detected.location.push(path);
        } else if (path.startsWith('screen.')) {
          detected.screen.push(path);
        } else {
          detected.other.push(path);
        }
      }

      for (const key of Object.keys(detected) as Array<keyof DetectedEnvironmentVariables>) {
        detected[key] = Array.from(new Set(detected[key])).sort();
      }
    } catch (error) {
      logger.warn('AST analysis failed', error);
      this.detectWithRegex(code, detected);
    }

    return detected;
  }

  private getMemberExpressionPath(node: unknown): string | null {
    const parts: string[] = [];

    let current: unknown = node;
    while (current) {
      if (this.isMemberExpressionNode(current)) {
        if (this.isIdentifierNode(current.property)) {
          parts.unshift(current.property.name);
        } else if (this.isStringLiteralNode(current.property)) {
          parts.unshift(current.property.value);
        }
        current = current.object;
      } else if (this.isIdentifierNode(current)) {
        parts.unshift(current.name);
        break;
      } else {
        break;
      }
    }

    if (
      parts.length > 0 &&
      parts[0] &&
      ['window', 'document', 'navigator', 'location', 'screen'].includes(parts[0])
    ) {
      return parts.join('.');
    }

    return null;
  }

  private detectWithRegex(code: string, detected: DetectedEnvironmentVariables): void {
    const patterns = [
      { regex: /window\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'window' as const },
      { regex: /document\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'document' as const },
      { regex: /navigator\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'navigator' as const },
      { regex: /location\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'location' as const },
      { regex: /screen\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'screen' as const },
    ];

    for (const { regex, category } of patterns) {
      const matches = code.match(regex) || [];
      detected[category].push(...matches);
    }

    for (const key of Object.keys(detected) as Array<keyof DetectedEnvironmentVariables>) {
      detected[key] = Array.from(new Set(detected[key])).sort();
    }
  }

  private buildManifestFromTemplate(
    detected: DetectedEnvironmentVariables,
    _browserType: string
  ): UnknownRecord {
    const manifest: UnknownRecord = {};
    const template = chromeEnvironmentTemplate;

    const allPaths = [
      ...detected.window,
      ...detected.document,
      ...detected.navigator,
      ...detected.location,
      ...detected.screen,
      ...detected.other,
    ];

    for (const path of allPaths) {
      const value = this.getValueFromTemplate(path, template);
      if (value !== undefined) {
        manifest[path] = value;
      }
    }

    return manifest;
  }

  private getValueFromTemplate(path: string, template: unknown): unknown {
    if (!this.isRecord(template)) {
      return undefined;
    }

    const parts = path.split('.');
    let current: unknown = template;

    for (const part of parts) {
      if (part === 'window') {
        current = template.window;
      } else if (part === 'document') {
        current = template.document;
      } else if (part === 'navigator') {
        current = template.navigator;
      } else if (part === 'location') {
        current = template.location;
      } else if (part === 'screen') {
        current = template.screen;
      } else if (this.isRecord(current) && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private async fetchRealEnvironment(
    url: string,
    detected: DetectedEnvironmentVariables,
    depth: number
  ): Promise<UnknownRecord> {
    const { manifest, browser } = await fetchRealEnvironmentData({
      browser: this.browser ?? undefined,
      url,
      detected,
      depth,
      resolveExecutablePath: () => this.resolveExecutablePath(),
      buildManifestFromTemplate: (vars, browserType) =>
        this.buildManifestFromTemplate(vars, browserType),
    });

    if (browser) {
      this.browser = browser;
    }

    return manifest;
  }

  private resolveExecutablePath(): string | undefined {
    const configuredPath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
      process.env.CHROME_PATH?.trim() ||
      process.env.BROWSER_EXECUTABLE_PATH?.trim();

    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return configuredPath;
      }
      throw new Error(
        `Configured browser executable was not found: ${configuredPath}. ` +
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.'
      );
    }

    const detectedPath = findBrowserExecutable();
    if (detectedPath) {
      return detectedPath;
    }

    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.'
    );
    return undefined;
  }

  private identifyMissingAPIs(
    detected: DetectedEnvironmentVariables,
    manifest: UnknownRecord
  ): MissingAPI[] {
    const missing: MissingAPI[] = [];

    const allPaths = [
      ...detected.window,
      ...detected.document,
      ...detected.navigator,
      ...detected.location,
      ...detected.screen,
      ...detected.other,
    ];

    for (const path of allPaths) {
      if (!(path in manifest) || manifest[path] === undefined) {
        let type: 'function' | 'object' | 'property' = 'property';
        if (path.includes('()')) {
          type = 'function';
        } else if (path.endsWith('Element') || path.endsWith('List')) {
          type = 'object';
        }

        missing.push({
          name: path.split('.').pop() || path,
          type,
          path,
          suggestion: this.getSuggestionForMissingAPI(path, type),
        });
      }
    }

    return missing;
  }

  private getSuggestionForMissingAPI(path: string, type: string): string {
    if (type === 'function') {
      return `: ${path} = function() {}`;
    } else if (type === 'object') {
      return `: ${path} = {}`;
    } else {
      return `null: ${path} = null`;
    }
  }

  private async generateMissingAPIImplementationsWithAI(
    missingAPIs: MissingAPI[],
    code: string,
    manifest: UnknownRecord
  ): Promise<void> {
    if (!this.llm || missingAPIs.length === 0) {
      return;
    }

    try {
      const apisToGenerate = missingAPIs.slice(0, 10);

      const response = await this.llm.chat(
        generateMissingAPIImplementationsMessages(apisToGenerate, code)
      );

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const implementations = JSON.parse(jsonStr) as unknown;
        if (!this.isRecord(implementations)) {
          return;
        }

        let addedCount = 0;
        for (const [path, impl] of Object.entries(implementations)) {
          if (typeof impl === 'string' && impl.trim()) {
            manifest[path] = impl;
            addedCount++;
          }
        }

        logger.info(` AI ${addedCount} API`);
      }
    } catch (error) {
      logger.error('AIAPI', error);
    }
  }

  private async inferMissingVariablesWithAI(
    code: string,
    detected: DetectedEnvironmentVariables,
    existingManifest: UnknownRecord,
    browserType: string
  ): Promise<UnknownRecord> {
    if (!this.llm) {
      return {};
    }

    try {
      const allDetectedPaths = [
        ...detected.window,
        ...detected.document,
        ...detected.navigator,
        ...detected.location,
        ...detected.screen,
        ...detected.other,
      ];

      const missingPaths = allDetectedPaths.filter((path) => !(path in existingManifest));

      if (missingPaths.length === 0) {
        logger.info('Environment analysis complete, AI suggestions applied');
        return {};
      }

      logger.info(` AI ${missingPaths.length} ...`);

      const response = await this.llm.chat(
        generateMissingVariablesMessages(browserType, missingPaths, code, existingManifest)
      );

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const inferredVars = JSON.parse(jsonStr) as unknown;
        if (!this.isRecord(inferredVars)) {
          logger.warn('AIJSON');
          return {};
        }
        logger.info(` AI ${Object.keys(inferredVars).length} `);
        return inferredVars;
      }

      logger.warn('AIJSON');
      return {};
    } catch (error) {
      logger.error('AI', error);
      return {};
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }

  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null;
  }

  private isIdentifierNode(node: unknown): node is IdentifierNodeLike {
    return (
      this.isRecord(node) && node.type === 'Identifier' && typeof node.name === 'string'
    );
  }

  private isStringLiteralNode(node: unknown): node is StringLiteralNodeLike {
    return (
      this.isRecord(node) && node.type === 'StringLiteral' && typeof node.value === 'string'
    );
  }

  private isMemberExpressionNode(node: unknown): node is MemberExpressionNodeLike {
    return (
      this.isRecord(node) &&
      node.type === 'MemberExpression' &&
      'object' in node &&
      'property' in node
    );
  }
}
