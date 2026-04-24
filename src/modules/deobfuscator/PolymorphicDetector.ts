export interface PolymorphicDetection {
  type: string;
  confidence: number;
  locations: PolymorphicLocation[];
  description: string;
}

export interface PolymorphicLocation {
  line: number;
  column: number;
  snippet: string;
}

export interface PolymorphicResult {
  detected: boolean;
  detections: PolymorphicDetection[];
  warnings: string[];
}

function detectGateFunctions(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/var\s+\w+\s*=\s*\w+\s*,\s*\w+\s*=\s*function/.test(line)) {
      locations.push({ line: i + 1, column: line.indexOf('var'), snippet: line.slice(0, 80) });
    }

    const gatePattern = /if\s*\([^)]*!\==[^)]*\)\s*\{[^}]*(?:return|throw)/;
    if (gatePattern.test(line)) {
      locations.push({ line: i + 1, column: line.indexOf('if'), snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

function detectVariableReassignmentChains(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const chainPattern = /var\s+\w+\s*=\s*\w+(?:\s*,\s*\w+\s*=\s*\w+)+/;
    if (chainPattern.test(line)) {
      locations.push({ line: i + 1, column: 0, snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

function detectRotatingPredicates(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  const predicatePatterns = [
    /\$\w+\s*=\s*\[\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\]/,
    /\$\w+\s*=\s*\{[^}]*(?:a|b|c)[^}]*\}/,
    /rotate\s*\(\s*\w+\s*\)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of predicatePatterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectPolymorphicFunctionCopies(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  const fnPatterns: RegExp[] = [
    /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+\w+\s*\(/g,
    /var\s+\w+\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?return\s+\w+\s*\(/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of fnPatterns) {
      const matches = line.match(pattern);
      if (matches && matches.length > 1) {
        locations.push({ line: i + 1, column: line.indexOf(matches[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectDeadCodeInjection(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/^\s*(?:if\s*\(\s*false\s*\)|if\s*\(\s*!1\s*\)|if\s*\(\s*0\s*\))/.test(line)) {
      locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
    }

    if (/throw\s+new\s+Error\s*\(\s*['"]?(?:stub|dummy|dead)['"]?\s*\)/i.test(line)) {
      locations.push({ line: i + 1, column: line.indexOf('throw'), snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

function detectSelfModifyingPredicates(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const selfModPatterns = [
      /\w+\s*=\s*!\w+\s*,\s*\w+\s*=\s*!\w+/,
      /var\s+\w+\s*=\s*0\s*,\s*\w+\s*=\s*function\s*\(\)\s*\{/,
    ];

    for (const pattern of selfModPatterns) {
      if (pattern.test(line)) {
        locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectCodeInjectionPoints(code: string): PolymorphicLocation[] {
  const locations: PolymorphicLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/new\s+Function\s*\(\s*(?:[^)]+)\s*\)/.test(line)) {
      locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
    }

    if (/["'](?:[^"']|\\.)*%s(?:[^"']|\\.)*["']\s*%(?:s|d)/.test(line)) {
      locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

export function detectPolymorphic(code: string): PolymorphicResult {
  const detections: PolymorphicDetection[] = [];
  const warnings: string[] = [];

  const gates = detectGateFunctions(code);
  if (gates.length > 0) {
    detections.push({
      type: 'gate-functions',
      confidence: 0.75,
      locations: gates,
      description: 'Gate functions that control code execution flow based on predicates',
    });
  }

  const chains = detectVariableReassignmentChains(code);
  if (chains.length > 0) {
    detections.push({
      type: 'variable-reassignment-chains',
      confidence: 0.6,
      locations: chains,
      description: 'Variable reassignment chains used to obscure data flow',
    });
  }

  const rotating = detectRotatingPredicates(code);
  if (rotating.length > 0) {
    detections.push({
      type: 'rotating-predicates',
      confidence: 0.7,
      locations: rotating,
      description: 'Predicates that cycle through values to evade detection',
    });
  }

  const copies = detectPolymorphicFunctionCopies(code);
  if (copies.length > 0) {
    detections.push({
      type: 'polymorphic-function-copies',
      confidence: 0.65,
      locations: copies,
      description: 'Multiple copies of the same function with minor variations',
    });
  }

  const deadCode = detectDeadCodeInjection(code);
  if (deadCode.length > 0) {
    detections.push({
      type: 'dead-code-injection',
      confidence: 0.8,
      locations: deadCode,
      description: 'Dead code injected to confuse static analysis',
    });
  }

  const selfMod = detectSelfModifyingPredicates(code);
  if (selfMod.length > 0) {
    detections.push({
      type: 'self-modifying-predicates',
      confidence: 0.85,
      locations: selfMod,
      description: 'Predicates that modify themselves during execution',
    });
  }

  const injectPoints = detectCodeInjectionPoints(code);
  if (injectPoints.length > 0) {
    detections.push({
      type: 'code-injection-points',
      confidence: 0.9,
      locations: injectPoints,
      description: 'Locations where external code could be injected',
    });
  }

  if (detections.length > 0) {
    warnings.push(`Polymorphic obfuscation detected: ${detections.map((d) => d.type).join(', ')}`);
  }

  return {
    detected: detections.length > 0,
    detections,
    warnings,
  };
}

export function getPolymorphicSummary(code: string): { complexity: 'low' | 'medium' | 'high'; details: string } {
  const result = detectPolymorphic(code);
  if (!result.detected) {
    return { complexity: 'low', details: 'No polymorphic patterns detected' };
  }

  const highConfidence = result.detections.filter((d) => d.confidence >= 0.75).length;
  const totalLocations = result.detections.reduce((sum, d) => sum + d.locations.length, 0);

  if (highConfidence >= 2 || totalLocations >= 5) {
    return {
      complexity: 'high',
      details: `High complexity: ${highConfidence} high-confidence detections, ${totalLocations} total locations`,
    };
  }

  return {
    complexity: 'medium',
    details: `Medium complexity: ${result.detections.length} detection types, ${totalLocations} locations`,
  };
}
