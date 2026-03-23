import { basename, extname, resolve } from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { argStringArray } from '@server/domains/shared/parse-args';
import { type ExternalToolRunner } from '@server/domains/shared/modules';
import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
  resolveOutputDirectory,
  checkExternalCommand,
} from '@server/domains/platform/handlers/platform-utils';

const execFileAsync = promisify(execFile);

// ── Private helpers ──

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

// ── Frida session tracking ──

interface FridaSession {
  id: string;
  pid: number;
  child: ChildProcess;
  output: string[];
  startedAt: number;
}

const fridaSessions = new Map<string, FridaSession>();

// ── Public handler class ──

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
      const functionName = parseStringArg(args, 'functionName') ?? '<target_function>';
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

    if (action === 'attach') {
      return this._handleFridaAttach(args);
    }

    if (action === 'run_script') {
      return this._handleFridaRunScript(args);
    }

    if (action === 'detach') {
      return this._handleFridaDetach(args);
    }

    if (action === 'list_sessions') {
      return this._handleFridaListSessions();
    }

    // action === 'guide'
    return toTextResponse({
      success: true,
      guide: {
        what: 'Frida is a dynamic instrumentation toolkit for native apps (Android, iOS, Windows, macOS, Linux).',
        install: ['pip install frida-tools', 'npm install frida  // optional Node.js bindings'],
        workflow: [
          '1. Use process_find / process_find_chromium to locate the target process',
          '2. Use frida_bridge(action="attach", pid=<PID>) to live-attach to the process',
          '3. Use frida_bridge(action="run_script", sessionId=<id>, script="...") to inject hooks',
          '4. Use frida_bridge(action="generate_script") to generate hook templates',
          '5. Use frida_bridge(action="detach", sessionId=<id>) to clean disconnect',
          '6. Combine with electron_launch_debug for main-process Frida injection',
        ],
        actions: ['check_env', 'attach', 'run_script', 'detach', 'list_sessions', 'generate_script', 'guide'],
        links: ['https://frida.re/docs/home/', 'https://frida.re/docs/javascript-api/'],
        integration:
          'Frida hooks can call back to this MCP via fetch("http://localhost:<port>/...") for real-time data exchange.',
      },
    });
  }

  /**
   * Live-attach Frida to a running process.
   */
  private async _handleFridaAttach(args: Record<string, unknown>) {
    const pid = args.pid as number | undefined;
    const processName = parseStringArg(args, 'processName');

    if (!pid && !processName) {
      throw new Error('Either pid or processName is required for attach');
    }

    // Try frida CLI subprocess for live attach
    const fridaArgs: string[] = [];
    if (pid) {
      fridaArgs.push('-p', String(pid));
    } else if (processName) {
      fridaArgs.push('-n', processName);
    }

    // Use --no-pause to attach without pausing the process
    fridaArgs.push('--no-pause');

    try {
      // Quick check: verify frida is available
      await execFileAsync('frida', ['--version'], { timeout: 5000 });
    } catch {
      return toTextResponse({
        success: false,
        tool: 'frida_bridge',
        error: 'frida CLI not found. Install with: pip install frida-tools',
        note: 'Frida live attach requires the frida CLI tools installed and in PATH.',
      });
    }

    // Start Frida process in interactive mode
    const child = spawn('frida', fridaArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const sessionId = `frida-${pid ?? processName}-${Date.now()}`;
    const session: FridaSession = {
      id: sessionId,
      pid: pid ?? 0,
      child,
      output: [],
      startedAt: Date.now(),
    };

    // Capture output
    child.stdout?.on('data', (data: Buffer) => {
      session.output.push(data.toString());
      // Keep only last 100 lines
      if (session.output.length > 100) session.output.shift();
    });
    child.stderr?.on('data', (data: Buffer) => {
      session.output.push(`[stderr] ${data.toString()}`);
      if (session.output.length > 100) session.output.shift();
    });
    child.on('exit', () => {
      fridaSessions.delete(sessionId);
    });

    fridaSessions.set(sessionId, session);

    // Wait for initial output
    await new Promise(r => setTimeout(r, 2000));

    return toTextResponse({
      success: true,
      tool: 'frida_bridge',
      action: 'attach',
      sessionId,
      pid: pid ?? processName,
      initialOutput: session.output.join('').slice(0, 2000),
      usage: {
        runScript: `frida_bridge(action="run_script", sessionId="${sessionId}", script="...")`,
        detach: `frida_bridge(action="detach", sessionId="${sessionId}")`,
      },
    });
  }

  /**
   * Run a Frida script in an active session.
   */
  private async _handleFridaRunScript(args: Record<string, unknown>) {
    const sessionId = parseStringArg(args, 'sessionId', true);
    const script = parseStringArg(args, 'script', true);

    if (!sessionId || !script) {
      throw new Error('sessionId and script are required');
    }

    const session = fridaSessions.get(sessionId);

    // If no interactive session, run as one-shot via frida CLI
    if (!session) {
      const pid = args.pid as number | undefined;
      const processName = parseStringArg(args, 'processName');

      if (!pid && !processName) {
        return toTextResponse({
          success: false,
          tool: 'frida_bridge',
          error: `Session ${sessionId} not found. Provide pid or processName for one-shot execution.`,
          activeSessions: Array.from(fridaSessions.keys()),
        });
      }

      // One-shot: run script via frida CLI -e flag
      const fridaArgs: string[] = [];
      if (pid) fridaArgs.push('-p', String(pid));
      else if (processName) fridaArgs.push('-n', processName);
      fridaArgs.push('--no-pause', '-e', script);

      try {
        const { stdout, stderr } = await execFileAsync('frida', fridaArgs, {
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024,
        });

        return toTextResponse({
          success: true,
          tool: 'frida_bridge',
          action: 'run_script',
          mode: 'one-shot',
          stdout: stdout.slice(0, 10_000),
          stderr: stderr.slice(0, 2000),
        });
      } catch (error) {
        return toErrorResponse('frida_bridge', error);
      }
    }

    // Interactive session: send script via stdin
    session.output.length = 0; // Clear output buffer
    session.child.stdin?.write(script + '\n');

    // Wait for output
    await new Promise(r => setTimeout(r, 3000));

    return toTextResponse({
      success: true,
      tool: 'frida_bridge',
      action: 'run_script',
      sessionId,
      mode: 'interactive',
      output: session.output.join('').slice(0, 10_000),
    });
  }

  /**
   * Detach from a Frida session.
   */
  private async _handleFridaDetach(args: Record<string, unknown>) {
    const sessionId = parseStringArg(args, 'sessionId', true);
    if (!sessionId) throw new Error('sessionId is required');

    const session = fridaSessions.get(sessionId);
    if (!session) {
      return toTextResponse({
        success: false,
        tool: 'frida_bridge',
        error: `Session not found: ${sessionId}`,
        activeSessions: Array.from(fridaSessions.keys()),
      });
    }

    // Send quit command and kill
    session.child.stdin?.write('%quit\n');
    setTimeout(() => {
      try { session.child.kill(); } catch { /* ignore */ }
    }, 2000);

    fridaSessions.delete(sessionId);

    return toTextResponse({
      success: true,
      tool: 'frida_bridge',
      action: 'detach',
      sessionId,
      message: 'Frida session detached.',
    });
  }

  /**
   * List all active Frida sessions.
   */
  private async _handleFridaListSessions() {
    const sessions = Array.from(fridaSessions.entries()).map(([id, s]) => ({
      sessionId: id,
      pid: s.pid,
      uptime: Math.round((Date.now() - s.startedAt) / 1000),
      outputLines: s.output.length,
    }));

    return toTextResponse({
      success: true,
      tool: 'frida_bridge',
      action: 'list_sessions',
      sessions,
      count: sessions.length,
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
      const extraArgs = argStringArray(args, 'extraArgs');

      const outputIdentity = basename(absoluteInput, extname(absoluteInput));
      const outputDirectory = await resolveOutputDirectory(
        'jadx-decompile',
        outputIdentity,
        outputDirArg
      );

      const jadxArgs = ['-d', outputDirectory.absolutePath, ...extraArgs, absoluteInput];

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

