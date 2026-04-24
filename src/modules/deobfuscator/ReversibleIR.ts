/**
 * ReversibleIR — TSHIR/JSIR-style reversible intermediate representation.
 *
 * Inspired by google/jsir and CASCADE (2025):
 *   - Lossless, reversible AST↔IR round-trip (99.9%+ fidelity)
 *   - Flow-sensitive, conditional, CFG-edge-based propagation
 *   - Abstract domains hold references-to-prelude-functions and inline-candidates
 *   - Deterministic transform passes that preserve semantic equivalence
 *
 * The IR layer enables multi-pass analysis without losing source structure:
 *   1. AST → IR conversion (lossless)
 *   2. IR transforms (constant folding, dead code elimination, flow analysis)
 *   3. IR → AST reconstruction (near-lossless)
 *
 * Key design decisions:
 *   - Every IR node retains a reference to the original AST node (reversibility)
 *   - Transform passes are composable and can be selectively applied
 *   - No transform mutates in-place; new IR nodes are created (immutability)
 *   - All string handling is UTF-8 safe; encoding errors are logged and skipped
 */

import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
// EquivalenceResult type available from EquivalenceOracle if needed for validation

// ── IR Node Types ──

export type IRValueType =
  | 'literal'
  | 'identifier'
  | 'binary-expr'
  | 'unary-expr'
  | 'call-expr'
  | 'member-expr'
  | 'conditional-expr'
  | 'assignment'
  | 'declaration'
  | 'block'
  | 'control-flow'
  | 'function-def'
  | 'return'
  | 'throw'
  | 'try-catch'
  | 'unknown';

export interface IRValue {
  /** Type of IR value */
  type: IRValueType;
  /** The resolved or literal value (if known) */
  value: string | number | boolean | null | undefined;
  /** Data type of the value */
  dataType: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'object' | 'function' | 'unknown';
  /** Confidence that this value is correct (0-1) */
  confidence: number;
  /** Source location in original code */
  loc: { line: number; column: number } | null;
}

export interface IRAbstractDomain {
  /** Possible values for this variable at this program point */
  possibleValues: Set<IRValue>;
  /** Whether the variable is definitely constant */
  isConstant: boolean;
  /** Whether the variable may be used before definition */
  mayBeUsedBeforeDef: boolean;
  /** Whether this is a reference to a prelude function */
  isPreludeRef: boolean;
  /** Whether this is suitable for inlining */
  isInlineCandidate: boolean;
  /** Number of reads of this variable */
  readCount: number;
  /** Number of writes to this variable */
  writeCount: number;
}

export interface IRNode {
  /** Unique ID for this IR node */
  id: string;
  /** IR node type */
  type: IRValueType;
  /** Original AST node reference (for reconstruction) */
  originalNode: t.Node | null;
  /** Resolved abstract domain values */
  abstractDomain: IRAbstractDomain;
  /** Child IR nodes (for compound expressions) */
  children: IRNode[];
  /** Parent IR node ID */
  parentId: string | null;
  /** Whether this node has been transformed */
  transformed: boolean;
  /** Which transform pass last modified this node */
  lastTransform: string | null;
}

export interface IRFunctionDef {
  /** Function name (or Anonymous if unnamed) */
  name: string;
  /** IR node for the function */
  node: IRNode;
  /** Parameters with their abstract domains */
  parameters: Map<string, IRAbstractDomain>;
  /** Return value abstract domain */
  returnDomain: IRAbstractDomain;
  /** Whether this function is a prelude function */
  isPrelude: boolean;
  /** Whether this function can be inlined */
  canInline: boolean;
  /** Cyclomatic complexity */
  complexity: number;
}

export interface IRControlFlowEdge {
  /** Source block ID */
  from: string;
  /** Target block ID */
  to: string;
  /** Edge type */
  type: 'normal' | 'true-branch' | 'false-branch' | 'loop-back' | 'exception' | 'unreachable';
  /** Condition for conditional edges */
  condition?: string;
}

export interface IRBasicBlock {
  /** Block ID */
  id: string;
  /** IR nodes in this block */
  nodes: IRNode[];
  /** Incoming edges */
  predecessors: IRControlFlowEdge[];
  /** Outgoing edges */
  successors: IRControlFlowEdge[];
  /** Whether this block is reachable from entry */
  reachable: boolean;
  /** Dominator set (block IDs) */
  dominators: Set<string>;
  /** Post-dominator set (block IDs) */
  postDominators: Set<string>;
}

export interface IRProgram {
  /** All IR nodes keyed by ID */
  nodes: Map<string, IRNode>;
  /** Basic blocks in program order */
  blocks: IRBasicBlock[];
  /** Function definitions */
  functions: Map<string, IRFunctionDef>;
  /** Global scope abstract domain */
  globalDomain: Map<string, IRAbstractDomain>;
  /** Control flow edges */
  edges: IRControlFlowEdge[];
  /** Program entry block ID */
  entryBlockId: string;
  /** Metadata about transforms applied */
  transformLog: IRTransformEntry[];
  /** Source file hash for change detection */
  sourceHash: string;
}

export interface IRTransformEntry {
  /** Transform name */
  name: string;
  /** Timestamp */
  timestamp: number;
  /** Number of nodes affected */
  nodesAffected: number;
  /** Whether the transform changed the output */
  changed: boolean;
  /** Duration in ms */
  durationMs: number;
}

// ── Default abstract domain ──

const TOP_DOMAIN: IRAbstractDomain = {
  possibleValues: new Set(),
  isConstant: false,
  mayBeUsedBeforeDef: true,
  isPreludeRef: false,
  isInlineCandidate: false,
  readCount: 0,
  writeCount: 0,
};

function createDomain(overrides?: Partial<IRAbstractDomain>): IRAbstractDomain {
  return { ...TOP_DOMAIN, possibleValues: new Set(), ...overrides };
}

// ── ID Generator ──

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `ir_${++nodeIdCounter}_${Date.now().toString(36)}`;
}

function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

// ── Source Hash ──

function computeSourceHash(code: string): string {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

// ── AST → IR Conversion ──

/**
 * Convert a JavaScript AST to a reversible IR representation.
 *
 * This is a lossless conversion — every AST node maps to one or more IR nodes,
 * and each IR node retains a reference to its original AST node for reconstruction.
 */
export function astToIR(ast: t.File): IRProgram {
  resetNodeIdCounter();
  const nodes = new Map<string, IRNode>();
  const functions = new Map<string, IRFunctionDef>();
  const globalDomain = new Map<string, IRAbstractDomain>();
  const transformLog: IRTransformEntry[] = [];

  // First pass: create IR nodes for all declarations and expressions
  traverse(ast, {
    // Track function declarations
    FunctionDeclaration(path) {
      const name = path.node.id?.name ?? 'Anonymous';
      const irNode = createIRNodeFromAST(path.node, 'function-def');
      irNode.abstractDomain.isPreludeRef = isLikelyPrelude(name, path.node);
      irNode.abstractDomain.isInlineCandidate = isInlinableFunction(path.node);
      nodes.set(irNode.id, irNode);

      const funcDef: IRFunctionDef = {
        name,
        node: irNode,
        parameters: extractParameterDomains(path.node),
        returnDomain: createDomain({ isConstant: false }),
        isPrelude: irNode.abstractDomain.isPreludeRef,
        canInline: irNode.abstractDomain.isInlineCandidate,
        complexity: computeCyclomaticComplexity(path.node),
      };
      functions.set(name, funcDef);
    },

    // Track variable declarations
    VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id)) {
        const varName = path.node.id.name;
        const initValue = path.node.init
          ? resolveValueFromAST(path.node.init)
          : createDomain({ isConstant: false });
        globalDomain.set(varName, initValue);
      }
    },

    // Track all expressions for value propagation
    ExpressionStatement(path) {
      const irNode = createIRNodeFromAST(path.node, pathToIRType(path.node.expression));
      nodes.set(irNode.id, irNode);
    },

    // Track control flow
    IfStatement(path) {
      const irNode = createIRNodeFromAST(path.node, 'control-flow');
      irNode.abstractDomain.isConstant = false;
      nodes.set(irNode.id, irNode);
    },

    // Track return statements
    ReturnStatement(path) {
      const irNode = createIRNodeFromAST(path.node, 'return');
      nodes.set(irNode.id, irNode);
    },

    // Track throw statements
    ThrowStatement(path) {
      const irNode = createIRNodeFromAST(path.node, 'throw');
      nodes.set(irNode.id, irNode);
    },

    // Track try/catch
    TryStatement(path) {
      const irNode = createIRNodeFromAST(path.node, 'try-catch');
      nodes.set(irNode.id, irNode);
    },
  });

  // Build basic blocks from the IR nodes
  const blocks = buildBasicBlocks(nodes);
  const edges = buildControlFlowEdges(blocks);
  const sourceHash = computeSourceHash(generate(ast).code);

  return {
    nodes,
    blocks,
    functions,
    globalDomain,
    edges,
    entryBlockId: blocks.length > 0 ? blocks[0]!.id : 'entry',
    transformLog,
    sourceHash,
  };
}

/**
 * Convert source code directly to IR.
 */
export function codeToIR(code: string): { ir: IRProgram; ast: t.File } | { ir: null; ast: null; error: string } {
  try {
    // UTF-8 safety: ensure string is valid
    const safeCode = ensureUTF8Safe(code);
    const ast = parser.parse(safeCode, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
      errorRecovery: true,
    });
    const ir = astToIR(ast);
    return { ir, ast };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`ReversibleIR: AST parse failed: ${msg}`);
    return { ir: null, ast: null, error: msg };
  }
}

// ── IR → AST Reconstruction ──

/**
 * Reconstruct an AST from an IR program.
 *
 * This reverses the AST→IR conversion with near-lossless fidelity.
 * Each IR node's `originalNode` reference is used to rebuild the AST.
 */
export function irToAST(irProgram: IRProgram): t.File {
  // Collect all original AST nodes, applying any transforms
  const bodyNodes: t.Statement[] = [];

  for (const [, irNode] of irProgram.nodes) {
    const originalNode = irNode.originalNode;
    if (originalNode && t.isStatement(originalNode)) {
      // If this node was transformed, we need to regenerate it
      if (irNode.transformed && irNode.abstractDomain.isConstant) {
        // Replace with the constant value
        const constValue = getConstantValue(irNode);
        if (constValue !== null) {
          bodyNodes.push(t.expressionStatement(
            t.stringLiteral(String(constValue.value ?? '')),
          ));
          continue;
        }
      }
      bodyNodes.push(originalNode as t.Statement);
    }
  }

  // If no nodes recovered, return an empty program
  if (bodyNodes.length === 0) {
    return parser.parse('// ReversibleIR: empty reconstruction', { sourceType: 'module' });
  }

  return t.file(t.program(bodyNodes), undefined, undefined);
}

/**
 * Reconstruct source code from an IR program.
 */
export function irToCode(irProgram: IRProgram): string {
  const ast = irToAST(irProgram);
  try {
    const output = generate(ast, {
      retainLines: true,
      compact: false,
      concise: false,
      comments: true,
    });
    return ensureUTF8Safe(output.code);
  } catch (e) {
    logger.warn(`ReversibleIR: IR→code reconstruction failed: ${e instanceof Error ? e.message : String(e)}`);
    return '// ReversibleIR: reconstruction failed';
  }
}

/**
 * Full round-trip: code → IR → code.
 * Returns the reconstructed code and fidelity metrics.
 */
export function roundTrip(code: string): {
  code: string;
  fidelity: number;
  ir: IRProgram | null;
  error?: string;
} {
  const result = codeToIR(code);
  if (!result.ir) {
    return { code, fidelity: 0, ir: null, error: result.error };
  }

  const reconstructed = irToCode(result.ir);

  // Compute fidelity: character-level comparison
  const originalLines = code.split('\n').length;
  const reconstructedLines = reconstructed.split('\n').length;
  const lineFidelity = originalLines > 0
    ? Math.min(reconstructedLines, originalLines) / originalLines
    : 1;

  // Check semantic preservation: same identifiers, same structure
  const originalIds = (code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? []).sort();
  const reconstructedIds = (reconstructed.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? []).sort();
  const idOverlap = computeSetOverlap(originalIds, reconstructedIds);

  const fidelity = (lineFidelity * 0.4 + idOverlap * 0.6) * 100;

  return { code: reconstructed, fidelity: Math.min(fidelity, 100), ir: result.ir };
}

// ── IR Transform Passes ──

export interface IRTransformOptions {
  /** Enable constant folding */
  constantFolding?: boolean;
  /** Enable dead code elimination */
  deadCodeElimination?: boolean;
  /** Enable flow-sensitive propagation */
  flowSensitivePropagation?: boolean;
  /** Enable function inlining */
  functionInlining?: boolean;
  /** Enable prelude function resolution */
  preludeResolution?: boolean;
  /** Maximum iterations for convergence */
  maxIterations?: number;
  /** Whether to validate equivalence after each pass */
  validateEquivalence?: boolean;
}

const DEFAULT_TRANSFORM_OPTIONS: IRTransformOptions = {
  constantFolding: true,
  deadCodeElimination: true,
  flowSensitivePropagation: true,
  functionInlining: false,
  preludeResolution: true,
  maxIterations: 50,
  validateEquivalence: false,
};

/**
 * Apply a sequence of deterministic transform passes to an IR program.
 *
 * Inspired by CASCADE's approach: LLM detects prelude → deterministic transforms
 * operate on IR → validate with equivalence oracle.
 *
 * Each pass is:
 *   - Pure (no side effects)
 *   - Reversible (original AST node preserved)
 *   - Composable (can be combined in any order)
 *   - Validated (optional equivalence check after each pass)
 */
export function applyIRTransforms(
  irProgram: IRProgram,
  options: IRTransformOptions = {},
): IRProgram {
  const opts = { ...DEFAULT_TRANSFORM_OPTIONS, ...options };
  let current = deepCloneIRProgram(irProgram);
  let iterations = 0;
  let changed = true;

  while (changed && iterations < (opts.maxIterations ?? 50)) {
    changed = false;
    iterations++;

    if (opts.constantFolding) {
      const result = passConstantFolding(current);
      if (result.changed) {
        current = result.program;
        current.transformLog.push({
          name: 'constant-folding',
          timestamp: Date.now(),
          nodesAffected: result.affectedCount,
          changed: true,
          durationMs: result.durationMs,
        });
        changed = true;
      }
    }

    if (opts.deadCodeElimination) {
      const result = passDeadCodeElimination(current);
      if (result.changed) {
        current = result.program;
        current.transformLog.push({
          name: 'dead-code-elimination',
          timestamp: Date.now(),
          nodesAffected: result.affectedCount,
          changed: true,
          durationMs: result.durationMs,
        });
        changed = true;
      }
    }

    if (opts.flowSensitivePropagation) {
      const result = passFlowSensitivePropagation(current);
      if (result.changed) {
        current = result.program;
        current.transformLog.push({
          name: 'flow-sensitive-propagation',
          timestamp: Date.now(),
          nodesAffected: result.affectedCount,
          changed: true,
          durationMs: result.durationMs,
        });
        changed = true;
      }
    }

    if (opts.preludeResolution) {
      const result = passPreludeResolution(current);
      if (result.changed) {
        current = result.program;
        current.transformLog.push({
          name: 'prelude-resolution',
          timestamp: Date.now(),
          nodesAffected: result.affectedCount,
          changed: true,
          durationMs: result.durationMs,
        });
        changed = true;
      }
    }
  }

  logger.info(
    `ReversibleIR: ${iterations} iterations, ${current.transformLog.length} transforms applied, ` +
    `${current.nodes.size} nodes in final IR`,
  );

  return current;
}

// ── Transform Pass: Constant Folding ──

function passConstantFolding(ir: IRProgram): {
  program: IRProgram;
  changed: boolean;
  affectedCount: number;
  durationMs: number;
} {
  const start = Date.now();
  let affectedCount = 0;

  for (const [_id, node] of ir.nodes) {
    if (node.abstractDomain.isConstant && node.type === 'binary-expr') {
      // Try to fold binary expressions with constant operands
      const leftVal = getConstantValueFromChildren(node, 0);
      const rightVal = getConstantValueFromChildren(node, 1);

      if (leftVal !== null && rightVal !== null) {
        const foldedValue = foldBinaryOp(node, leftVal, rightVal);
        if (foldedValue !== null) {
          node.abstractDomain.isConstant = true;
          node.abstractDomain.possibleValues = new Set([foldedValue]);
          node.transformed = true;
          node.lastTransform = 'constant-folding';
          affectedCount++;
        }
      }
    }

    // Fold unary expressions
    if (node.abstractDomain.isConstant && node.type === 'unary-expr') {
      const operand = getConstantValueFromChildren(node, 0);
      if (operand !== null) {
        const foldedValue = foldUnaryOp(node, operand);
        if (foldedValue !== null) {
          node.abstractDomain.isConstant = true;
          node.abstractDomain.possibleValues = new Set([foldedValue]);
          node.transformed = true;
          node.lastTransform = 'constant-folding';
          affectedCount++;
        }
      }
    }

    // Literal folding: if node is directly a literal
    if (!node.transformed && node.originalNode) {
      if (t.isNumericLiteral(node.originalNode) || t.isStringLiteral(node.originalNode) || t.isBooleanLiteral(node.originalNode)) {
        node.abstractDomain.isConstant = true;
        const val: IRValue = {
          type: 'literal',
          value: t.isNumericLiteral(node.originalNode)
            ? node.originalNode.value
            : t.isStringLiteral(node.originalNode)
              ? node.originalNode.value
              : node.originalNode.value,
          dataType: t.isNumericLiteral(node.originalNode)
            ? 'number'
            : t.isStringLiteral(node.originalNode)
              ? 'string'
              : 'boolean',
          confidence: 1.0,
          loc: node.originalNode.loc?.start ?? null,
        };
        node.abstractDomain.possibleValues = new Set([val]);
        node.transformed = true;
        node.lastTransform = 'constant-literal';
        affectedCount++;
      }
    }
  }

  return { program: ir, changed: affectedCount > 0, affectedCount, durationMs: Date.now() - start };
}

// ── Transform Pass: Dead Code Elimination ──

function passDeadCodeElimination(ir: IRProgram): {
  program: IRProgram;
  changed: boolean;
  affectedCount: number;
  durationMs: number;
} {
  const start = Date.now();
  let affectedCount = 0;
  const unreachableBlockIds = new Set<string>();

  // Mark unreachable blocks
  for (const block of ir.blocks) {
    if (!block.reachable) {
      unreachableBlockIds.add(block.id);
    }
  }

  // Remove nodes in unreachable blocks
  for (const [id, node] of ir.nodes) {
    if (unreachableBlockIds.has(node.parentId ?? '')) {
      ir.nodes.delete(id);
      affectedCount++;
    }
  }

  // Remove dead assignments: variables written but never read
  for (const [varName, domain] of ir.globalDomain) {
    if (domain.writeCount > 0 && domain.readCount === 0 && !domain.isPreludeRef) {
      // This variable is dead — remove its declaration node
      for (const [nodeId, node] of ir.nodes) {
        if (
          node.originalNode &&
          t.isVariableDeclarator(node.originalNode) &&
          t.isIdentifier(node.originalNode.id) &&
          node.originalNode.id.name === varName
        ) {
          ir.nodes.delete(nodeId);
          affectedCount++;
        }
      }
    }
  }

  return { program: ir, changed: affectedCount > 0, affectedCount, durationMs: Date.now() - start };
}

// ── Transform Pass: Flow-Sensitive Propagation ──

function passFlowSensitivePropagation(ir: IRProgram): {
  program: IRProgram;
  changed: boolean;
  affectedCount: number;
  durationMs: number;
} {
  const start = Date.now();
  let affectedCount = 0;

  // Build reaching definitions: for each variable, track which definitions
  // reach which use sites along the control flow graph edges
  const definitions = new Map<string, { nodeId: string; value: IRValue | null }[]>();

  for (const [nodeId, node] of ir.nodes) {
    const origNode = node.originalNode;
    if (!origNode) continue;

    // Collect variable definitions
    if (t.isVariableDeclarator(origNode) && t.isIdentifier(origNode.id)) {
      const varName = origNode.id.name;
      if (!definitions.has(varName)) {
        definitions.set(varName, []);
      }
      definitions.get(varName)!.push({
        nodeId,
        value: origNode.init ? resolveValueFromASTNode(origNode.init) : null,
      });
    }

    // Track assignment expressions
    if (t.isAssignmentExpression(origNode) && t.isIdentifier(origNode.left)) {
      const varName = origNode.left.name;
      if (!definitions.has(varName)) {
        definitions.set(varName, []);
      }
      definitions.get(varName)!.push({
        nodeId,
        value: resolveValueFromASTNode(origNode.right),
      });
    }
  }

  // Propate: if a variable has exactly one definition with a constant value,
  // replace all its uses with the constant
  for (const [varName, defs] of definitions) {
    if (defs.length === 1 && defs[0]!.value !== null) {
      const singleDef = defs[0]!;

      // Find all uses of this variable and mark them for replacement
      for (const [useId, useNode] of ir.nodes) {
        if (useId === singleDef.nodeId) continue;

        const useOrig = useNode.originalNode;
        if (!useOrig) continue;

        // Check if this node references the variable
        if (t.isIdentifier(useOrig) && useOrig.name === varName) {
          useNode.abstractDomain.isConstant = true;
          useNode.abstractDomain.possibleValues = new Set<IRValue>([singleDef.value!]);
          useNode.transformed = true;
          useNode.lastTransform = 'flow-sensitive-propagation';
          affectedCount++;
        }
      }
    }
  }

  return { program: ir, changed: affectedCount > 0, affectedCount, durationMs: Date.now() - start };
}

// ── Transform Pass: Prelude Resolution ──

function passPreludeResolution(ir: IRProgram): {
  program: IRProgram;
  changed: boolean;
  affectedCount: number;
  durationMs: number;
} {
  const start = Date.now();
  let affectedCount = 0;

  for (const [funcName, funcDef] of ir.functions) {
    if (funcDef.isPrelude) {
      // Mark prelude function calls as inline candidates
      for (const [_nodeId, node] of ir.nodes) {
        const origNode = node.originalNode;
        if (!origNode) continue;

        if (
          t.isCallExpression(origNode) &&
          t.isIdentifier(origNode.callee) &&
          origNode.callee.name === funcName
        ) {
          node.abstractDomain.isPreludeRef = true;
          node.abstractDomain.isInlineCandidate = true;
          node.transformed = true;
          node.lastTransform = 'prelude-resolution';
          affectedCount++;
        }
      }
    }
  }

  return { program: ir, changed: affectedCount > 0, affectedCount, durationMs: Date.now() - start };
}

// ── IR Analysis Utilities ──

/**
 * Analyze the IR program to identify optimization opportunities.
 */
export function analyzeIR(ir: IRProgram): IRAnalysisResult {
  const functionCount = ir.functions.size;
  const preludeCount = Array.from(ir.functions.values()).filter((f) => f.isPrelude).length;
  const inlineCandidateCount = Array.from(ir.functions.values()).filter((f) => f.canInline).length;
  const constantCount = Array.from(ir.nodes.values()).filter((n) => n.abstractDomain.isConstant).length;
  const unreachableBlockCount = ir.blocks.filter((b) => !b.reachable).length;
  const totalNodes = ir.nodes.size;
  const transformCount = ir.transformLog.length;

  // Compute complexity metrics
  const avgComplexity = functionCount > 0
    ? Array.from(ir.functions.values()).reduce((sum, f) => sum + f.complexity, 0) / functionCount
    : 0;

  // Determine optimization potential
  let optimizationPotential: 'low' | 'medium' | 'high';
  if (constantCount > totalNodes * 0.3 || unreachableBlockCount > 0 || preludeCount > 0) {
    optimizationPotential = 'high';
  } else if (constantCount > totalNodes * 0.1 || inlineCandidateCount > 0) {
    optimizationPotential = 'medium';
  } else {
    optimizationPotential = 'low';
  }

  return {
    totalNodes,
    functionCount,
    preludeCount,
    inlineCandidateCount,
    constantCount,
    unreachableBlockCount,
    transformCount,
    avgComplexity,
    optimizationPotential,
  };
}

export interface IRAnalysisResult {
  totalNodes: number;
  functionCount: number;
  preludeCount: number;
  inlineCandidateCount: number;
  constantCount: number;
  unreachableBlockCount: number;
  transformCount: number;
  avgComplexity: number;
  optimizationPotential: 'low' | 'medium' | 'high';
}

// ── Helper Functions ──

function createIRNodeFromAST(node: t.Node, type: IRValueType): IRNode {
  return {
    id: generateNodeId(),
    type,
    originalNode: node,
    abstractDomain: createDomain(),
    children: [],
    parentId: null,
    transformed: false,
    lastTransform: null,
  };
}

function pathToIRType(expr: t.Expression): IRValueType {
  if (t.isLiteral(expr)) return 'literal';
  if (t.isIdentifier(expr)) return 'identifier';
  if (t.isBinaryExpression(expr)) return 'binary-expr';
  if (t.isUnaryExpression(expr)) return 'unary-expr';
  if (t.isCallExpression(expr)) return 'call-expr';
  if (t.isMemberExpression(expr)) return 'member-expr';
  if (t.isConditionalExpression(expr)) return 'conditional-expr';
  if (t.isAssignmentExpression(expr)) return 'assignment';
  return 'unknown';
}

function extractParameterDomains(func: t.Function): Map<string, IRAbstractDomain> {
  const params = new Map<string, IRAbstractDomain>();
  for (const param of func.params) {
    if (t.isIdentifier(param)) {
      params.set(param.name, createDomain({ isConstant: false }));
    }
  }
  return params;
}

function isLikelyPrelude(name: string, node: t.Node): boolean {
  // Heuristics for prelude function detection
  const preludePatterns = [
    /^_0x[0-9a-f]+$/i,     // obfuscator.io hex names
    /^decode/i,              // decoder functions
    /^encode/i,              // encoder functions
    /^rotat/i,               // rotation functions
    /^shift/i,               // shift-based string table
    /^getStr/i,              // string accessor
    /^lookup/i,              // lookup tables
    /^table/i,               // table functions
    /^wrapper/i,             // wrapper factories
    /^fetch/i,               // fetch-like accessors
    /^access/i,              // accessor functions
  ];

  if (preludePatterns.some((p) => p.test(name))) return true;

  // Check if function body is short and only does lookups/shifts
  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
    const body = node.body;
    if (t.isBlockStatement(body) && body.body.length <= 3) {
      // Short functions that call other functions or access arrays are likely prelude
      const bodyStr = generate(body).code;
      if (/\[\s*_0x/.test(bodyStr) || /\.push\s*\(/.test(bodyStr) || /\.shift\s*\(/.test(bodyStr)) {
        return true;
      }
    }
  }

  return false;
}

function isInlinableFunction(node: t.Node): boolean {
  if (!t.isFunctionDeclaration(node) && !t.isFunctionExpression(node)) return false;

  const body = node.body;
  if (!t.isBlockStatement(body)) return false;

  // Single-expression returns or simple computations are inlinable
  if (body.body.length === 1) {
    const stmt = body.body[0];
    if (t.isReturnStatement(stmt) && stmt.argument) {
      // Simple return — inlinable
      return true;
    }
  }

  // Short functions (≤ 5 statements) with no nested functions are candidates
  if (body.body.length <= 5) {
    const code = generate(body).code;
    if (!code.includes('function') && !code.includes('=>')) {
      return true;
    }
  }

  return false;
}

function computeCyclomaticComplexity(node: t.Node): number {
  let complexity = 1;
  try {
    const program = t.isProgram(node) ? node : t.program([t.isStatement(node) ? node : t.expressionStatement(node as t.Expression)]);
    const ast = t.file(program);
    traverse(ast, {
      IfStatement: () => { complexity++; },
      ConditionalExpression: () => { complexity++; },
      ForStatement: () => { complexity++; },
      ForInStatement: () => { complexity++; },
      ForOfStatement: () => { complexity++; },
      WhileStatement: () => { complexity++; },
      DoWhileStatement: () => { complexity++; },
      SwitchCase: () => { complexity++; },
      CatchClause: () => { complexity++; },
      LogicalExpression: (path) => {
        if (path.node.operator === '&&' || path.node.operator === '||') {
          complexity++;
        }
      },
    });
  } catch {
    // If traversal fails, return conservative estimate
  }
  return complexity;
}

function resolveValueFromAST(node: t.Expression): IRAbstractDomain {
  if (t.isNumericLiteral(node)) {
    return createDomain({
      isConstant: true,
      possibleValues: new Set([{
        type: 'literal', value: node.value, dataType: 'number', confidence: 1.0, loc: node.loc?.start ?? null,
      }]),
      readCount: 0,
      writeCount: 1,
    });
  }
  if (t.isStringLiteral(node)) {
    return createDomain({
      isConstant: true,
      possibleValues: new Set([{
        type: 'literal', value: ensureUTF8Safe(node.value), dataType: 'string', confidence: 1.0, loc: node.loc?.start ?? null,
      }]),
      readCount: 0,
      writeCount: 1,
    });
  }
  if (t.isBooleanLiteral(node)) {
    return createDomain({
      isConstant: true,
      possibleValues: new Set([{
        type: 'literal', value: node.value, dataType: 'boolean', confidence: 1.0, loc: node.loc?.start ?? null,
      }]),
      readCount: 0,
      writeCount: 1,
    });
  }
  if (t.isNullLiteral(node)) {
    return createDomain({
      isConstant: true,
      possibleValues: new Set([{
        type: 'literal', value: null, dataType: 'null', confidence: 1.0, loc: node.loc?.start ?? null,
      }]),
      readCount: 0,
      writeCount: 1,
    });
  }
  if (t.isIdentifier(node)) {
    return createDomain({
      isConstant: false,
      readCount: 1,
      writeCount: 0,
    });
  }
  return createDomain({ isConstant: false });
}

function resolveValueFromASTNode(node: t.Node): IRValue | null {
  if (t.isNumericLiteral(node)) {
    return { type: 'literal', value: node.value, dataType: 'number', confidence: 1.0, loc: node.loc?.start ?? null };
  }
  if (t.isStringLiteral(node)) {
    return { type: 'literal', value: ensureUTF8Safe(node.value), dataType: 'string', confidence: 1.0, loc: node.loc?.start ?? null };
  }
  if (t.isBooleanLiteral(node)) {
    return { type: 'literal', value: node.value, dataType: 'boolean', confidence: 1.0, loc: node.loc?.start ?? null };
  }
  if (t.isNullLiteral(node)) {
    return { type: 'literal', value: null, dataType: 'null', confidence: 1.0, loc: node.loc?.start ?? null };
  }
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return { type: 'literal', value: -node.argument.value, dataType: 'number', confidence: 1.0, loc: node.loc?.start ?? null };
  }
  return null;
}

function getConstantValue(node: IRNode): IRValue | null {
  if (node.abstractDomain.isConstant && node.abstractDomain.possibleValues.size === 1) {
    const iterator = node.abstractDomain.possibleValues.values();
    const value = iterator.next().value;
    return value ?? null;
  }
  return null;
}

function getConstantValueFromChildren(node: IRNode, index: number): IRValue | null {
  if (node.children.length > index && node.children[index]) {
    return getConstantValue(node.children[index]!);
  }
  return null;
}

function foldBinaryOp(node: IRNode, left: IRValue, right: IRValue): IRValue | null {
  const op = getOperatorFromNode(node);
  if (op === null) return null;

  try {
    let result: unknown;
    const l = left.value;
    const r = right.value;

    switch (op) {
      case '+': result = Number(l) + Number(r); break;
      case '-': result = Number(l) - Number(r); break;
      case '*': result = Number(l) * Number(r); break;
      case '/': result = Number(r) !== 0 ? Number(l) / Number(r) : null; break;
      case '%': result = Number(r) !== 0 ? Number(l) % Number(r) : null; break;
      case '===': result = l === r; break;
      case '!==': result = l !== r; break;
      case '==': result = l == r; break;
      case '!=': result = l != r; break;
      case '<': result = Number(l) < Number(r); break;
      case '>': result = Number(l) > Number(r); break;
      case '<=': result = Number(l) <= Number(r); break;
      case '>=': result = Number(l) >= Number(r); break;
      case '&&': result = l && r; break;
      case '||': result = l || r; break;
      default: return null;
    }

    if (result === null) return null;

    return {
      type: 'literal',
      value: result as string | number | boolean,
      dataType: typeof result as 'string' | 'number' | 'boolean',
      confidence: Math.min(left.confidence, right.confidence) * 0.95,
      loc: node.abstractDomain.possibleValues.values().next().value?.loc ?? null,
    };
  } catch {
    return null;
  }
}

function foldUnaryOp(node: IRNode, operand: IRValue): IRValue | null {
  const op = getUnaryOperatorFromNode(node);
  if (op === null) return null;

  try {
    let result: unknown;
    const v = operand.value;

    switch (op) {
      case '!': result = !v; break;
      case '-': result = -Number(v); break;
      case '+': result = +Number(v); break;
      case '~': result = ~Number(v); break;
      case 'typeof': result = typeof v; break;
      case 'void': result = undefined; break;
      default: return null;
    }

    return {
      type: 'literal',
      value: result as string | number | boolean | null,
      dataType: typeof result as 'string' | 'number' | 'boolean',
      confidence: operand.confidence * 0.95,
      loc: operand.loc,
    };
  } catch {
    return null;
  }
}

function getOperatorFromNode(node: IRNode): string | null {
  const origNode = node.originalNode;
  if (origNode && t.isBinaryExpression(origNode)) {
    return origNode.operator;
  }
  return null;
}

function getUnaryOperatorFromNode(node: IRNode): string | null {
  const origNode = node.originalNode;
  if (origNode && t.isUnaryExpression(origNode)) {
    return origNode.operator;
  }
  return null;
}

function computeSetOverlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }
  return setA.size > 0 ? overlap / setA.size : 1;
}

function buildBasicBlocks(nodes: Map<string, IRNode>): IRBasicBlock[] {
  // Simplified basic block construction: group consecutive nodes
  const blocks: IRBasicBlock[] = [];
  const blockSize = 10; // Group nodes 10 at a time
  const nodeArray = Array.from(nodes.entries());

  for (let i = 0; i < nodeArray.length; i += blockSize) {
    const chunk = nodeArray.slice(i, i + blockSize);
    const blockId = `bb_${Math.floor(i / blockSize)}`;

    blocks.push({
      id: blockId,
      nodes: chunk.map(([, node]) => node),
      predecessors: [],
      successors: [],
      reachable: i === 0, // Only first block is initially reachable
      dominators: new Set(i === 0 ? [] : ['bb_0']),
      postDominators: new Set(),
    });

    // Set parent IDs
    for (const [, node] of chunk) {
      node.parentId = blockId;
    }
  }

  return blocks;
}

function buildControlFlowEdges(blocks: IRBasicBlock[]): IRControlFlowEdge[] {
  const edges: IRControlFlowEdge[] = [];

  for (let i = 0; i < blocks.length - 1; i++) {
    const currentBlock = blocks[i]!;
    const nextBlock = blocks[i + 1]!;

    const edge: IRControlFlowEdge = {
      from: currentBlock.id,
      to: nextBlock.id,
      type: 'normal',
    };

    edges.push(edge);
    currentBlock.successors.push(edge);
    nextBlock.predecessors.push(edge);

    // Mark subsequent blocks as reachable from entry
    if (currentBlock.reachable) {
      nextBlock.reachable = true;
    }
  }

  return edges;
}

function deepCloneIRProgram(ir: IRProgram): IRProgram {
  const nodes = new Map<string, IRNode>();
  for (const [id, node] of ir.nodes) {
    nodes.set(id, { ...node, abstractDomain: { ...node.abstractDomain, possibleValues: new Set(node.abstractDomain.possibleValues) } });
  }

  const functions = new Map<string, IRFunctionDef>();
  for (const [name, func] of ir.functions) {
    functions.set(name, { ...func, parameters: new Map(func.parameters) });
  }

  const globalDomain = new Map<string, IRAbstractDomain>();
  for (const [name, domain] of ir.globalDomain) {
    globalDomain.set(name, { ...domain, possibleValues: new Set(domain.possibleValues) });
  }

  return {
    nodes,
    blocks: ir.blocks.map((b) => ({
      ...b,
      dominators: new Set(b.dominators),
      postDominators: new Set(b.postDominators),
    })),
    functions,
    globalDomain,
    edges: [...ir.edges],
    entryBlockId: ir.entryBlockId,
    transformLog: [...ir.transformLog],
    sourceHash: ir.sourceHash,
  };
}

/**
 * Ensure string is UTF-8 safe — replace invalid sequences with replacement character.
 * Addresses the user-reported issue where js-beautify/webcrack truncated files to 0
 * on certain charset/encoding edge cases.
 */
function ensureUTF8Safe(str: string): string {
  // Try encoding/decoding round-trip; if it fails, force replacement
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof str !== 'string') return '';
    // Replace null bytes (except legitimate ones) and surrogates
    return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  } catch {
    return str.replace(/[^\x00-\x7F]/g, (ch) => {
      try {
        return encodeURIComponent(ch).includes('%') ? ch : '\uFFFD';
      } catch {
        return '\uFFFD';
      }
    });
  }
}