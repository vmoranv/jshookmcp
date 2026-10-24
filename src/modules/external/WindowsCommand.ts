/**
 * Windows command resolution for execFile/spawn without a shell.
 *
 * On Windows, execFile only starts PE images (.exe/.com). `where <tool>` can list an
 * extensionless POSIX launcher before the runnable `.bat`/`.cmd` (jadx, apktool and Ghidra ship
 * such pairs), and Node refuses to start `.bat`/`.cmd` without a shell since CVE-2024-27980
 * (spawn EINVAL). This module picks a runnable `where` hit and wraps batch files in an explicit
 * `cmd.exe /d /s /c "..."` call whose command line is escaped the way cross-spawn does it
 * (lib/util/escape.js), so arguments cannot inject cmd.exe syntax.
 */

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

// cmd.exe metacharacters, as in cross-spawn (lib/util/escape.js).
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

export interface ExecFileCommand {
  file: string;
  args: string[];
  /** Pass through to execFile/spawn options; true only for the cmd.exe wrapper. */
  windowsVerbatimArguments: boolean;
}

function extensionOf(file: string): string {
  const base = file.slice(Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Pick the first `where` output line whose extension is listed in PATHEXT.
 * Returns undefined when no line is runnable.
 */
export function pickWindowsExecutable(
  whereOutput: string,
  pathExt = process.env.PATHEXT || DEFAULT_PATHEXT,
): string | undefined {
  const runnable = new Set(
    pathExt
      .split(';')
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.startsWith('.')),
  );
  return whereOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && runnable.has(extensionOf(line)));
}

/** Escape a command path for a cmd.exe command line (cross-spawn `escape.command`). */
export function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META_CHARS, '^$1');
}

/**
 * Escape one argument for a cmd.exe command line (cross-spawn `escape.argument`, single level).
 *
 * cmd.exe consumes the carets, so the batch file receives each argument wrapped in plain quotes.
 * Because toExecFileCommand refuses arguments that contain a quote, every later re-parse inside
 * the batch file (`%*`, `set ARGS=%*`, `if "x%~1" == "x"`) sees the metacharacters inside quotes.
 * cross-spawn's second caret level is not applied: it breaks Gradle-style launchers such as
 * jadx.bat, whose `if "x%~1" == "x"` check then fails with a syntax error.
 */
export function escapeCmdArgument(arg: string): string {
  // Backslashes before a quote are doubled and the quote is escaped; backslashes at the end are
  // doubled because a closing quote follows. Other backslashes stay literal.
  let escaped = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
  return `"${escaped}"`.replace(CMD_META_CHARS, '^$1');
}

/**
 * Turn `file args` into an execFile-ready command. On Windows a `.bat`/`.cmd` file runs through
 * `cmd.exe /d /s /c "<escaped line>"` with verbatim arguments; everything else is unchanged.
 */
export function toExecFileCommand(
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ExecFileCommand {
  const ext = extensionOf(file);
  if (platform !== 'win32' || (ext !== '.bat' && ext !== '.cmd')) {
    return { file, args: [...args], windowsVerbatimArguments: false };
  }
  // A quote or line break cannot be passed through a batch file's own argument forwarding
  // safely, and no Windows path contains one.
  const unsafe = args.find((arg) => /["\r\n\0]/.test(arg));
  if (unsafe !== undefined) {
    throw new Error(`Refusing to pass an argument containing a quote or line break to ${file}`);
  }
  const line = [escapeCmdCommand(file), ...args.map((arg) => escapeCmdArgument(arg))].join(' ');
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
