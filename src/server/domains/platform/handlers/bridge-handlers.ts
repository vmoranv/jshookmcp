import { basename, extname, resolve } from 'node:path';
import { ExternalToolRunner } from '../../../../modules/external/ExternalToolRunner.js';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  resolveOutputDirectory,
  checkExternalCommand,
} from './platform-utils.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function generateFridaTemplate(hookType: string, functionName: string): string {
  const templates: Record<string, string> = {
    intercept: [
      `// Frida Interceptor template for: ${functionName}`,
      `Interceptor.attach(Module.getExportByName(null, '${functionName}'), {`,
      `  onEnter(args) {`,
      `    console.log('[+] ${functionName} called');`,
      `    console.log('    arg0:', args[0]);`,
      `    console.log('    arg1:', args[1]);`,
      `  },`,
      `  onLeave(retval) {`,
      `    console.log('[+] ${functionName} returned:', retval);`,
      `  }`,
      `});`,
    ].join('\n'),

    replace: [
      `// Frida Replace template for: ${functionName}`,
      `Interceptor.replace(Module.getExportByName(null, '${functionName}'),`,
      `  new NativeCallback(function() {`,
      `    console.log('[+] ${functionName} replaced');`,
      `    // Add custom logic here`,
      `    return 0;`,
      `  }, 'int', [])`,
      `);`,
    ].join('\n'),

    stalker: [
      `// Frida Stalker template for tracing: ${functionName}`,
      `const targetAddr = Module.getExportByName(null, '${functionName}');`,
      `Interceptor.attach(targetAddr, {`,
      `  onEnter(args) {`,
      `    this.tid = Process.getCurrentThreadId();`,
      `    Stalker.follow(this.tid, {`,
      `      events: { call: true, ret: false, exec: false },`,
      `      onCallSummary(summary) {`,
      `        for (const [addr, count] of Object.entries(summary)) {`,
      `          const sym = DebugSymbol.fromAddress(ptr(addr));`,
      `          if (sym.name) console.log(\`  \${sym.name}: \${count}x\`);`,
      `        }`,
      `      }`,
      `    });`,
      `  },`,
      `  onLeave() {`,
      `    Stalker.unfollow(this.tid);`,
      `  }`,
      `});`,
    ].join('\n'),

    module_export: [
      `// Frida Module Export enumeration`,
      `const exports = Module.enumerateExports('${functionName}');`,
      `console.log(\`[+] Found \${exports.length} exports in ${functionName}\`);`,
      `exports.forEach((exp, i) => {`,
      `  console.log(\`  [\${i}] \${exp.type} \${exp.name} @ \${exp.address}\`);`,
      `});`,
    ].join('\n'),
  };

  return templates[hookType] ?? templates.intercept!;
}

// ---------------------------------------------------------------------------
// Public handler class
// ---------------------------------------------------------------------------

export class BridgeHandlers {
  private runner: ExternalToolRunner;

  constructor(runner: ExternalToolRunner) {
    this.runner = runner;
  }

  async handleFridaBridge(args: Record<string, unknown>) {
    const action = parseStringArg(args, 'action', true) ?? 'guide';

    if (action === 'check_env') {
      return checkExternalCommand('frida', ['--version'], 'frida');
    }

    if (action === 'generate_script') {
      const target = parseStringArg(args, 'target') ?? '<process_name>';
      const hookType = parseStringArg(args, 'hookType') ?? 'intercept';
      const functionName =
        parseStringArg(args, 'functionName') ?? '<target_function>';
      const script = generateFridaTemplate(hookType, functionName);

      return toTextResponse({
        success: true,
        target,
        hookType,
        functionName,
        script,
        usage: `frida -p <PID> -l script.js  // or: frida -n "${target}" -l script.js`,
        tip: 'Save the script to a .js file, then use the frida CLI to inject it.',
      });
    }

    // action === 'guide'
    return toTextResponse({
      success: true,
      guide: {
        what: 'Frida is a dynamic instrumentation toolkit for native apps (Android, iOS, Windows, macOS, Linux).',
        install: [
          'pip install frida-tools',
          'npm install frida  // optional Node.js bindings',
        ],
        workflow: [
          '1. Use process_find / process_find_chromium to locate the target process',
          '2. Use frida_bridge(action="generate_script") to generate a hook template',
          '3. Save the script and run: frida -p <PID> -l script.js',
          '4. Use page_evaluate or console_execute to interact with the hooked process',
          '5. Combine with network_enable + network_get_requests for full-chain analysis',
        ],
        links: [
          'https://frida.re/docs/home/',
          'https://frida.re/docs/javascript-api/',
        ],
        integration:
          'Frida hooks can call back to this MCP via fetch("http://localhost:<port>/...") for real-time data exchange.',
      },
    });
  }

  async handleJadxBridge(args: Record<string, unknown>) {
    const action = parseStringArg(args, 'action', true) ?? 'guide';

    if (action === 'check_env') {
      return checkExternalCommand('jadx', ['--version'], 'jadx');
    }

    if (action === 'decompile') {
      const inputPath = parseStringArg(args, 'inputPath', true);
      if (!inputPath) {
        throw new Error('inputPath is required for decompile action');
      }

      const absoluteInput = resolve(inputPath);
      const outputDirArg = parseStringArg(args, 'outputDir');
      const extraArgs = Array.isArray(args.extraArgs)
        ? (args.extraArgs as string[]).filter((a) => typeof a === 'string')
        : [];

      const outputIdentity = basename(absoluteInput, extname(absoluteInput));
      const outputDirectory = await resolveOutputDirectory(
        'jadx-decompile',
        outputIdentity,
        outputDirArg
      );

      const jadxArgs = [
        '-d',
        outputDirectory.absolutePath,
        ...extraArgs,
        absoluteInput,
      ];

      try {
        const result = await this.runner.run({
          tool: 'platform.jadx',
          args: jadxArgs,
          timeoutMs: 300_000,
        });

        return toTextResponse({
          success: result.ok,
          outputDir: outputDirectory.displayPath,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
          truncated: result.truncated,
          durationMs: result.durationMs,
        });
      } catch (error) {
        return toErrorResponse('jadx_bridge', error, {
          hint: 'Ensure jadx is installed: https://github.com/skylot/jadx/releases',
        });
      }
    }

    // action === 'guide'
    return toTextResponse({
      success: true,
      guide: {
        what: 'Jadx is a DEX to Java decompiler. Supports APK, DEX, AAR, AAB, and ZIP files.',
        install: [
          'Download from: https://github.com/skylot/jadx/releases',
          'Ensure jadx is in PATH (or provide full path)',
          'Requires Java 11+ runtime',
        ],
        workflow: [
          '1. Use jadx_bridge(action="check_env") to verify jadx installation',
          '2. Use jadx_bridge(action="decompile", inputPath="app.apk") to decompile',
          '3. Use search_in_scripts / collect_code to analyze the decompiled Java source',
          '4. Combine with crypto_extract_standalone for sign/encrypt function extraction',
        ],
        commonArgs: [
          '--deobf            // Enable deobfuscation',
          '--show-bad-code    // Show decompiled code even if errors occur',
          '--no-res           // Skip resource decoding (faster)',
          '--threads-count 4  // Parallel decompilation',
        ],
        links: [
          'https://github.com/skylot/jadx',
          'https://github.com/skylot/jadx/wiki/jadx-CLI-options',
        ],
      },
    });
  }
}
