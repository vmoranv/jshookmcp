export interface HookGeneratorOptions {
  includeArgs?: boolean;
  includeRetAddr?: boolean;
}

export interface HookSymbolDescriptor {
  name: string;
  address?: string;
  demangled?: string;
}

export class HookGenerator {
  generateFridaHookScript(
    symbols: ReadonlyArray<string | HookSymbolDescriptor>,
    options?: HookGeneratorOptions,
  ): string {
    const includeArgs = options?.includeArgs ?? true;
    const includeRetAddr = options?.includeRetAddr ?? false;
    const lines: string[] = [
      "'use strict';",
      '',
      'function resolveTarget(name) {',
      '  try {',
      '    const exported = Module.findExportByName(null, name);',
      '    if (exported) {',
      '      return exported;',
      '    }',
      '  } catch (error) {}',
      '  try {',
      '    const symbol = DebugSymbol.fromName(name);',
      '    if (symbol && symbol.address) {',
      '      return symbol.address;',
      '    }',
      '  } catch (error) {}',
      '  return null;',
      '}',
      '',
      'const installedHooks = [];',
    ];

    for (let index = 0; index < symbols.length; index += 1) {
      const descriptor = this.toDescriptor(symbols[index]!);
      const varName = `target_${index}`;
      const label = descriptor.demangled ?? descriptor.name;
      const addressLine = descriptor.address
        ? `const ${varName} = ptr("${this.escapeForDoubleQuotes(descriptor.address)}");`
        : `const ${varName} = resolveTarget("${this.escapeForDoubleQuotes(descriptor.name)}");`;

      lines.push(addressLine);
      lines.push(`if (${varName}) {`);
      lines.push(`  Interceptor.attach(${varName}, {`);
      lines.push('    onEnter(args) {');

      if (includeRetAddr) {
        lines.push(
          `      console.log("[binary-instrument] enter ${this.escapeForDoubleQuotes(label)} ret=" + this.returnAddress);`,
        );
      } else {
        lines.push(
          `      console.log("[binary-instrument] enter ${this.escapeForDoubleQuotes(label)}");`,
        );
      }

      if (includeArgs) {
        lines.push('      const renderedArgs = [];');
        lines.push('      for (let i = 0; i < 6; i += 1) {');
        lines.push('        try {');
        lines.push('          renderedArgs.push(String(args[i]));');
        lines.push('        } catch (error) {');
        lines.push('          renderedArgs.push("<unreadable>");');
        lines.push('        }');
        lines.push('      }');
        lines.push(
          '      console.log("[binary-instrument] args " + JSON.stringify(renderedArgs));',
        );
      }

      lines.push('    },');
      lines.push('    onLeave(retval) {');
      lines.push(
        `      console.log("[binary-instrument] leave ${this.escapeForDoubleQuotes(label)} retval=" + retval);`,
      );
      lines.push('    },');
      lines.push('  });');
      lines.push(
        `  installedHooks.push({ name: "${this.escapeForDoubleQuotes(label)}", address: String(${varName}) });`,
      );
      lines.push('} else {');
      lines.push(
        `  console.log("[binary-instrument] unresolved ${this.escapeForDoubleQuotes(label)}");`,
      );
      lines.push('}');
      lines.push('');
    }

    lines.push('console.log("[binary-instrument] hooks=" + JSON.stringify(installedHooks));');
    return lines.join('\n');
  }

  generateInterceptorScript(targetFuncs: string[]): string {
    return this.generateFridaHookScript(targetFuncs, {
      includeArgs: true,
      includeRetAddr: false,
    });
  }

  private toDescriptor(symbol: string | HookSymbolDescriptor): HookSymbolDescriptor {
    if (typeof symbol === 'string') {
      return { name: symbol };
    }

    return symbol;
  }

  private escapeForDoubleQuotes(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  }
}
