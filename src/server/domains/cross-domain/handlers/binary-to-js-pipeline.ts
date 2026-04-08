import type { CrossDomainEvidenceBridge } from './evidence-graph-bridge';

export interface GhidraFunction {
  name: string;
  moduleName: string;
  address?: string;
  calledFrom?: string[];
}

export interface GhidraOutput {
  functions: GhidraFunction[];
  moduleName: string;
}

export interface EvidenceGraphLink {
  binarySymbolNodeId: string;
  hookScriptNodeId: string;
  functionName: string;
}

export interface BinaryToJSPipelineResult {
  hookCount: number;
  generatedHookScript: string;
  injectedFunctions: string[];
  evidenceGraphLinks: EvidenceGraphLink[];
}

/** Patterns that identify functions callable from JS or exported for JS use. */
const JS_CALLABLE_PATTERNS = [/^native_/i, /^JS_/i, /^Java_/i];

function isJSCallable(func: GhidraFunction): boolean {
  // Functions with explicit calledFrom references are always included
  if (func.calledFrom && func.calledFrom.length > 0) {
    return true;
  }
  // Match naming patterns
  return JS_CALLABLE_PATTERNS.some((pattern) => pattern.test(func.name));
}

function generateFridaHookCode(functions: GhidraFunction[], moduleName: string): string {
  const lines: string[] = [];
  lines.push('// Binary-to-JS Hook Script');
  lines.push(`// Module: ${moduleName}`);
  lines.push(`// Generated at: ${new Date().toISOString()}`);
  lines.push('');

  for (const func of functions) {
    const resolvedModule = func.moduleName || moduleName;
    if (func.address) {
      lines.push(`// Hook: ${func.name} at ${func.address} in ${resolvedModule}`);
      lines.push(
        `Interceptor.attach(Module.findBaseAddress('${resolvedModule}').add(${func.address}), {`,
      );
    } else {
      lines.push(`// Hook: ${func.name} in ${resolvedModule}`);
      lines.push(
        `Interceptor.attach(Module.findExportByName('${resolvedModule}', '${func.name}'), {`,
      );
    }
    lines.push(`  onEnter(args) {`);
    lines.push(`    console.log('[${func.name}] called with args:', args[0], args[1]);`);
    lines.push(`  },`);
    lines.push(`  onLeave(retval) {`);
    lines.push(`    console.log('[${func.name}] returned:', retval);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`console.log('Binary-to-JS hook script loaded for ${moduleName}');`);
  return lines.join('\n');
}

export function buildBinaryToJSPipeline(
  bridge: CrossDomainEvidenceBridge,
  ghidraOutput: GhidraOutput,
  forcedFunctions?: string[],
): BinaryToJSPipelineResult {
  const evidenceGraphLinks: EvidenceGraphLink[] = [];
  const injectedFunctions: string[] = [];

  // Determine which functions to hook
  let selectedFunctions: GhidraFunction[];
  if (forcedFunctions && forcedFunctions.length > 0) {
    const forcedSet = new Set(forcedFunctions);
    selectedFunctions = ghidraOutput.functions.filter((f) => forcedSet.has(f.name));
  } else {
    selectedFunctions = ghidraOutput.functions.filter(isJSCallable);
  }

  // Generate hook script
  const generatedHookScript = generateFridaHookCode(selectedFunctions, ghidraOutput.moduleName);

  // Register in evidence graph
  for (const func of selectedFunctions) {
    const symbolNode = bridge.addBinarySymbol({
      moduleName: func.moduleName || ghidraOutput.moduleName,
      symbolName: func.name,
      address: func.address ?? '0x0',
    });

    const hookNode = bridge.addNode('breakpoint-hook', `frida:${func.name}`, {
      domain: 'binary-instrument',
      hookType: 'frida-interceptor',
      functionName: func.name,
      moduleName: func.moduleName || ghidraOutput.moduleName,
    });

    bridge.getGraph().addEdge(symbolNode.id, hookNode.id, 'binary-exports', {
      domain: 'cross-domain',
      relation: 'binary-to-frida-hook',
    });

    evidenceGraphLinks.push({
      binarySymbolNodeId: symbolNode.id,
      hookScriptNodeId: hookNode.id,
      functionName: func.name,
    });

    injectedFunctions.push(func.name);
  }

  return {
    hookCount: selectedFunctions.length,
    generatedHookScript,
    injectedFunctions,
    evidenceGraphLinks,
  };
}
