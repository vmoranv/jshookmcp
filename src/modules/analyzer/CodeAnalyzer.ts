import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type {
  UnderstandCodeOptions,
  UnderstandCodeResult,
  CodeStructure,
  TechStack,
  BusinessLogic,
  DataFlow,
  FunctionInfo,
  ClassInfo,
  CallGraph,
} from '../../types/index.js';
import { LLMService } from '../../services/LLMService.js';
import { generateCodeAnalysisPrompt } from '../../services/prompts/analysis.js';
import { logger } from '../../utils/logger.js';
import { identifySecurityRisks } from './SecurityCodeAnalyzer.js';
import {
  calculateQualityScore,
  detectCodePatterns,
  analyzeComplexityMetrics,
} from './QualityAnalyzer.js';
import { analyzeDataFlowWithTaint } from './CodeAnalyzerDataFlow.js';

type ComplexityVisitor = {
  IfStatement?: () => void;
  SwitchCase?: () => void;
  ForStatement?: () => void;
  WhileStatement?: () => void;
  DoWhileStatement?: () => void;
  ConditionalExpression?: () => void;
  LogicalExpression?: (logicalPath: { node: { operator?: string } }) => void;
  CatchClause?: () => void;
};

interface TraversablePath {
  traverse: (visitor: ComplexityVisitor) => void;
}

const isTraversablePath = (value: unknown): value is TraversablePath =>
  typeof value === 'object' &&
  value !== null &&
  'traverse' in value &&
  typeof (value as { traverse?: unknown }).traverse === 'function';

export class CodeAnalyzer {
  private llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  async understand(options: UnderstandCodeOptions): Promise<UnderstandCodeResult> {
    logger.info('Starting code understanding...');
    const startTime = Date.now();

    try {
      const { code, context, focus = 'all' } = options;

      const structure = await this.analyzeStructure(code);
      logger.debug('Code structure analyzed');

      const aiAnalysis = await this.aiAnalyze(code, focus);
      logger.debug('AI analysis completed');

      const techStack = this.detectTechStack(code, aiAnalysis);
      logger.debug('Tech stack detected');

      const businessLogic = this.extractBusinessLogic(aiAnalysis, context);
      logger.debug('Business logic extracted');

      const dataFlow = await this.analyzeDataFlow(code);
      logger.debug('Data flow analyzed');

      const securityRisks = identifySecurityRisks(code, aiAnalysis);
      logger.debug('Security risks identified');

      const { patterns, antiPatterns } = detectCodePatterns(code);
      logger.debug(`Detected ${patterns.length} patterns and ${antiPatterns.length} anti-patterns`);

      const complexityMetrics = analyzeComplexityMetrics(code);
      logger.debug('Complexity metrics calculated');

      const qualityScore = calculateQualityScore(
        structure,
        securityRisks,
        aiAnalysis,
        complexityMetrics,
        antiPatterns
      );

      const duration = Date.now() - startTime;
      logger.success(`Code understanding completed in ${duration}ms`);

      return {
        structure,
        techStack,
        businessLogic,
        dataFlow,
        securityRisks,
        qualityScore,
        codePatterns: patterns,
        antiPatterns,
        complexityMetrics,
      };
    } catch (error) {
      logger.error('Code understanding failed', error);
      throw error;
    }
  }

  private async analyzeStructure(code: string): Promise<CodeStructure> {
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const self = this;

      traverse(ast, {
        FunctionDeclaration(path) {
          const node = path.node;
          functions.push({
            name: node.id?.name || 'anonymous',
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        FunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'anonymous';

          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            name = parent.id.name;
          } else if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
            name = parent.left.name;
          }

          functions.push({
            name,
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ArrowFunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'arrow';

          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            name = parent.id.name;
          }

          functions.push({
            name,
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ClassDeclaration(path) {
          const node = path.node;
          const methods: FunctionInfo[] = [];
          const properties: ClassInfo['properties'] = [];

          path.traverse({
            ClassMethod(methodPath) {
              const method = methodPath.node;
              methods.push({
                name: method.key.type === 'Identifier' ? method.key.name : 'unknown',
                params: method.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                location: {
                  file: 'current',
                  line: method.loc?.start.line || 0,
                  column: method.loc?.start.column,
                },
                complexity: 1,
              });
            },
            ClassProperty(propertyPath) {
              const property = propertyPath.node;
              if (property.key.type === 'Identifier') {
                properties.push({
                  name: property.key.name,
                  type: undefined,
                  value: undefined,
                });
              }
            },
          });

          classes.push({
            name: node.id?.name || 'anonymous',
            methods,
            properties,
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
          });
        },
      });
    } catch (error) {
      logger.warn('Failed to parse code structure', error);
    }

    const modules = this.analyzeModules(code);

    const callGraph = this.buildCallGraph(functions, code);

    return {
      functions,
      classes,
      modules,
      callGraph,
    };
  }

  private async aiAnalyze(code: string, focus: string): Promise<Record<string, unknown>> {
    try {
      const messages = generateCodeAnalysisPrompt(code, focus);
      const response = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 2000 });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      }

      return { rawAnalysis: response.content };
    } catch (error) {
      logger.warn('AI analysis failed, using fallback', error);
      return {};
    }
  }

  private detectTechStack(code: string, aiAnalysis: Record<string, unknown>): TechStack {
    const techStack: TechStack = {
      other: [],
    };

    if (aiAnalysis.techStack && typeof aiAnalysis.techStack === 'object') {
      const ts = aiAnalysis.techStack as Record<string, unknown>;
      techStack.framework = ts.framework as string | undefined;
      techStack.bundler = ts.bundler as string | undefined;
      if (Array.isArray(ts.libraries)) {
        techStack.other = ts.libraries as string[];
      }
    }

    if (code.includes('React.') || code.includes('useState') || code.includes('useEffect')) {
      techStack.framework = 'React';
    } else if (code.includes('Vue.') || code.includes('createApp')) {
      techStack.framework = 'Vue';
    } else if (code.includes('@angular/')) {
      techStack.framework = 'Angular';
    }

    if (code.includes('__webpack_require__')) {
      techStack.bundler = 'Webpack';
    }

    const cryptoLibs: string[] = [];
    if (code.includes('CryptoJS')) cryptoLibs.push('CryptoJS');
    if (code.includes('JSEncrypt')) cryptoLibs.push('JSEncrypt');
    if (code.includes('crypto-js')) cryptoLibs.push('crypto-js');
    if (cryptoLibs.length > 0) {
      techStack.cryptoLibrary = cryptoLibs;
    }

    return techStack;
  }

  private extractBusinessLogic(
    aiAnalysis: Record<string, unknown>,
    context?: Record<string, unknown>
  ): BusinessLogic {
    const businessLogic: BusinessLogic = {
      mainFeatures: [],
      entities: [],
      rules: [],
      dataModel: {},
    };

    if (aiAnalysis.businessLogic && typeof aiAnalysis.businessLogic === 'object') {
      const bl = aiAnalysis.businessLogic as Record<string, unknown>;
      if (Array.isArray(bl.mainFeatures)) {
        businessLogic.mainFeatures = bl.mainFeatures as string[];
      }
      if (typeof bl.dataFlow === 'string') {
        businessLogic.rules.push(bl.dataFlow);
      }
    }

    if (context) {
      businessLogic.dataModel = { ...businessLogic.dataModel, ...context };
    }

    return businessLogic;
  }

  private analyzeModules(code: string): CodeStructure['modules'] {
    const modules: CodeStructure['modules'] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const imports: string[] = [];
      const exports: string[] = [];

      traverse(ast, {
        ImportDeclaration(path) {
          imports.push(path.node.source.value);
        },
        ExportNamedDeclaration(path) {
          if (path.node.source) {
            exports.push(path.node.source.value);
          }
        },
        ExportDefaultDeclaration() {
          exports.push('default');
        },
      });

      if (imports.length > 0 || exports.length > 0) {
        modules.push({
          name: 'current',
          imports,
          exports,
        });
      }
    } catch (error) {
      logger.warn('Module analysis failed', error);
    }

    return modules;
  }

  private buildCallGraph(functions: FunctionInfo[], code: string): CallGraph {
    const nodes: CallGraph['nodes'] = functions.map((fn) => ({
      id: fn.name,
      name: fn.name,
      type: 'function' as const,
    }));

    const edges: CallGraph['edges'] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let currentFunction = '';

      traverse(ast, {
        FunctionDeclaration(path) {
          currentFunction = path.node.id?.name || '';
        },
        FunctionExpression(path) {
          const parent = path.parent;
          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            currentFunction = parent.id.name;
          }
        },
        CallExpression(path) {
          if (currentFunction) {
            const callee = path.node.callee;
            let calledFunction = '';

            if (callee.type === 'Identifier') {
              calledFunction = callee.name;
            } else if (
              callee.type === 'MemberExpression' &&
              callee.property.type === 'Identifier'
            ) {
              calledFunction = callee.property.name;
            }

            if (calledFunction && functions.some((f) => f.name === calledFunction)) {
              edges.push({
                from: currentFunction,
                to: calledFunction,
              });
            }
          }
        },
      });
    } catch (error) {
      logger.warn('Call graph construction failed', error);
    }

    return { nodes, edges };
  }

  private calculateComplexity(path: unknown): number {
    let complexity = 1;

    if (isTraversablePath(path)) {
      path.traverse({
        IfStatement() {
          complexity++;
        },
        SwitchCase() {
          complexity++;
        },
        ForStatement() {
          complexity++;
        },
        WhileStatement() {
          complexity++;
        },
        DoWhileStatement() {
          complexity++;
        },
        ConditionalExpression() {
          complexity++;
        },
        LogicalExpression(logicalPath) {
          if (logicalPath.node.operator === '&&' || logicalPath.node.operator === '||') {
            complexity++;
          }
        },
        CatchClause() {
          complexity++;
        },
      });
    }

    return complexity;
  }

  private async analyzeDataFlow(code: string): Promise<DataFlow> {
    return analyzeDataFlowWithTaint(code, this.llm);
  }
}
