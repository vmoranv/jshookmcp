import {
  createProtectedRangeResolver,
  replaceOutsideProtectedRanges,
  type ProtectedRangeResolver,
} from './ast-safe-replace';

export type SolvedConstraint = {
  pattern: string;
  original: string;
  result: string;
};

type SolveConstraintsState = {
  output: string;
  solved: SolvedConstraint[];
  replaceInPlace: boolean;
  maxIterations: number;
  iterations: number;
  resolver: ProtectedRangeResolver;
};

type StaticReplacementRule = {
  pattern: string;
  regex: RegExp;
  replacement: string;
};

const NUMERIC_COMPARATORS: Record<string, (left: number, right: number) => boolean> = {
  '<': (left, right) => left < right,
  '>': (left, right) => left > right,
  '<=': (left, right) => left <= right,
  '<==': (left, right) => left <= right,
  '>=': (left, right) => left >= right,
  '>==': (left, right) => left >= right,
  '==': (left, right) => left === right,
  '===': (left, right) => left === right,
  '!=': (left, right) => left !== right,
  '!==': (left, right) => left !== right,
};

const JS_FUCK_RULES: StaticReplacementRule[] = [
  {
    pattern: 'jsfuck',
    regex: /\[!\[\]\]\[\(['"]\)constructor['"]\)\]\(!!\[\]\+\[\]\)\(\)/g,
    replacement: '"function Boolean() { [native code] }"',
  },
  { pattern: 'jsfuck', regex: /!!\[\]\+\[\]/g, replacement: '"true"' },
  { pattern: 'jsfuck', regex: /!\[\]\+\[\]/g, replacement: '"false"' },
  { pattern: 'jsfuck', regex: /\+!!\[\]/g, replacement: '1' },
  { pattern: 'jsfuck', regex: /\[\]\+\[\]/g, replacement: '""' },
  { pattern: 'jsfuck', regex: /\+\[\]/g, replacement: '0' },
];

const BOOLEAN_LITERAL_RULES: StaticReplacementRule[] = [
  { pattern: 'boolean-literal', regex: /!!\[\]/g, replacement: 'true' },
  { pattern: 'boolean-literal', regex: /!\[\]/g, replacement: 'false' },
  { pattern: 'undefined-literal', regex: /void\s+0/g, replacement: 'undefined' },
];

const OPAQUE_TRUTHY_RULE: StaticReplacementRule = {
  pattern: 'opaque-truthy',
  regex: /!0x0\b|!\b0(?![.\d])/g,
  replacement: 'true',
};

const TYPE_COERCION_RULES: StaticReplacementRule[] = [
  {
    pattern: 'type-coercion',
    regex: /typeof\s+undefined\s*===?\s*["']undefined["']/g,
    replacement: 'true',
  },
  {
    pattern: 'type-coercion',
    regex: /typeof\s+null\s*===?\s*["']object["']/g,
    replacement: 'true',
  },
  {
    pattern: 'type-coercion',
    regex: /typeof\s+NaN\s*===?\s*["']number["']/g,
    replacement: 'true',
  },
  { pattern: 'type-coercion', regex: /null\s*==\s*undefined/g, replacement: 'true' },
  { pattern: 'type-coercion', regex: /null\s*===\s*undefined/g, replacement: 'false' },
  { pattern: 'type-coercion', regex: /NaN\s*===?\s*NaN/g, replacement: 'false' },
];

const CONSTANT_COMPARISON_PATTERN =
  /if\s*\(\s*(-?\d+(?:\.\d+)?)\s*([<>!=]+)\s*(-?\d+(?:\.\d+)?)\s*\)/g;
const OPAQUE_FALSY_PATTERN = /!\s*(-?\d+(?:\.\d+)?)(?![.\d\s\w])/g;
const STRING_ARRAY_DECLARATION_PATTERN =
  /(?:var|let|const)\s+(\w+)\s*=\s*\[(['"][^'"]*['"]\s*(?:,\s*['"][^'"]*['"]\s*)*)\]/g;

function recordSolve(
  state: SolveConstraintsState,
  pattern: string,
  original: string,
  result: string,
): string {
  state.solved.push({ pattern, original, result });
  return result;
}

function applyStaticRules(state: SolveConstraintsState, rules: StaticReplacementRule[]): void {
  for (const rule of rules) {
    state.output = replaceOutsideProtectedRanges(
      state.output,
      rule.regex,
      (fullMatch) => recordSolve(state, rule.pattern, fullMatch, rule.replacement),
      state.resolver,
    );
  }
}

function applyConstantComparisons(state: SolveConstraintsState): void {
  state.output = replaceOutsideProtectedRanges(
    state.output,
    CONSTANT_COMPARISON_PATTERN,
    (fullMatch, leftRaw: string, operator: string, rightRaw: string) => {
      if (state.iterations >= state.maxIterations) {
        return fullMatch;
      }

      // Own-property guard: inherited keys ('constructor', ...) would resolve
      // to Object.prototype members and be called as comparators.
      const compare = Object.hasOwn(NUMERIC_COMPARATORS, operator)
        ? NUMERIC_COMPARATORS[operator]
        : undefined;
      if (!compare) {
        return fullMatch;
      }

      state.iterations += 1;
      const result = compare(Number(leftRaw), Number(rightRaw));
      recordSolve(state, 'constant-comparison', fullMatch, String(result));
      return state.replaceInPlace
        ? `/* ${fullMatch} => ${result} */ if (${result})`
        : `if (${result})`;
    },
    state.resolver,
  );
}

function applyOpaqueFalsyRules(state: SolveConstraintsState): void {
  state.output = replaceOutsideProtectedRanges(
    state.output,
    OPAQUE_FALSY_PATTERN,
    (fullMatch, numericRaw: string) => {
      const numericValue = Number(numericRaw);
      if (numericValue === 0 || !Number.isFinite(numericValue)) {
        return fullMatch;
      }

      return recordSolve(state, 'opaque-falsy', fullMatch, 'false');
    },
    state.resolver,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectStringArrays(
  output: string,
  resolver: ProtectedRangeResolver,
): Map<string, string[]> {
  const stringArrays = new Map<string, string[]>();

  replaceOutsideProtectedRanges(
    output,
    STRING_ARRAY_DECLARATION_PATTERN,
    (fullMatch, name: string, arrayContent: string) => {
      const items = arrayContent.split(/,\s*/).map((item) => item.replace(/^['"]|['"]$/g, ''));
      stringArrays.set(name, items);
      return fullMatch;
    },
    resolver,
  );

  return stringArrays;
}

function applyStringArrayAccesses(state: SolveConstraintsState): void {
  const stringArrays = collectStringArrays(state.output, state.resolver);
  if (stringArrays.size === 0) {
    return;
  }

  for (const [name, items] of stringArrays) {
    const accessPattern = new RegExp(
      `${escapeRegExp(name)}\\(['"]?(0x[0-9a-fA-F]+|\\d+)['"]?\\)`,
      'g',
    );

    state.output = replaceOutsideProtectedRanges(
      state.output,
      accessPattern,
      (fullMatch, rawIndex: string) => {
        if (state.iterations >= state.maxIterations) {
          return fullMatch;
        }

        const index = rawIndex.startsWith('0x') ? Number.parseInt(rawIndex, 16) : Number(rawIndex);
        if (index < 0 || index >= items.length) {
          return fullMatch;
        }

        state.iterations += 1;
        return recordSolve(state, 'string-array-access', fullMatch, JSON.stringify(items[index]!));
      },
      state.resolver,
    );
  }
}

export function solveConstraints(options: {
  code: string;
  replaceInPlace: boolean;
  maxIterations: number;
}): {
  success: true;
  solvedCount: number;
  solved: SolvedConstraint[];
  transformedCode?: string;
} {
  const state: SolveConstraintsState = {
    output: options.code,
    solved: [],
    replaceInPlace: options.replaceInPlace,
    maxIterations: options.maxIterations,
    iterations: 0,
    resolver: createProtectedRangeResolver(options.code),
  };

  applyConstantComparisons(state);
  applyStaticRules(state, JS_FUCK_RULES);
  applyStaticRules(state, BOOLEAN_LITERAL_RULES);
  applyStaticRules(state, [OPAQUE_TRUTHY_RULE]);
  applyOpaqueFalsyRules(state);
  applyStringArrayAccesses(state);
  applyStaticRules(state, TYPE_COERCION_RULES);

  return {
    success: true,
    solvedCount: state.solved.length,
    solved: state.solved,
    transformedCode: options.replaceInPlace ? state.output : undefined,
  };
}
