import { describe, expect, it } from 'vitest';

import {
  escapeCmdArgument,
  escapeCmdCommand,
  pickWindowsExecutable,
  toExecFileCommand,
} from '@modules/external/WindowsCommand';

const PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.JS';
const COMSPEC = process.env.ComSpec || 'cmd.exe';

describe('pickWindowsExecutable', () => {
  it('skips an extensionless launcher listed before the batch file', () => {
    const where = 'C:\\tools\\jadx\\bin\\jadx\r\nC:\\tools\\jadx\\bin\\jadx.bat\r\n';
    expect(pickWindowsExecutable(where, PATHEXT)).toBe('C:\\tools\\jadx\\bin\\jadx.bat');
  });

  it('keeps the first hit when it is already runnable', () => {
    const where = 'C:\\sdk\\adb.exe\r\nC:\\other\\adb.exe\r\n';
    expect(pickWindowsExecutable(where, PATHEXT)).toBe('C:\\sdk\\adb.exe');
  });

  it('matches PATHEXT case-insensitively and ignores dots in directory names', () => {
    const where = 'C:\\tools\\apktool.d\\apktool\nC:\\tools\\apktool.d\\APKTOOL.BAT\n';
    expect(pickWindowsExecutable(where, '.exe;.bat')).toBe('C:\\tools\\apktool.d\\APKTOOL.BAT');
  });

  it('returns undefined when no hit has a PATHEXT extension', () => {
    expect(pickWindowsExecutable('C:\\tools\\jadx\\bin\\jadx\r\n', PATHEXT)).toBeUndefined();
    expect(pickWindowsExecutable('', PATHEXT)).toBeUndefined();
  });
});

describe('escapeCmdArgument', () => {
  it('quotes and caret-escapes spaces and cmd metacharacters', () => {
    expect(escapeCmdArgument('a b', false)).toBe('^"a^ b^"');
    expect(escapeCmdArgument('x&y|z', false)).toBe('^"x^&y^|z^"');
    expect(escapeCmdArgument('100%', false)).toBe('^"100^%^"');
    expect(escapeCmdArgument('c^d', false)).toBe('^"c^^d^"');
    expect(escapeCmdArgument('<a>(b)!', false)).toBe('^"^<a^>^(b^)^!^"');
  });

  it('escapes embedded quotes and the backslashes before them', () => {
    expect(escapeCmdArgument('say "hi"', false)).toBe('^"say^ \\^"hi\\^"^"');
    expect(escapeCmdArgument('a\\"b', false)).toBe('^"a\\\\\\^"b^"');
  });

  it('doubles trailing backslashes so they do not escape the closing quote', () => {
    expect(escapeCmdArgument('C:\\out dir\\', false)).toBe('^"C:\\out^ dir\\\\^"');
    expect(escapeCmdArgument('C:\\a\\b', false)).toBe('^"C:\\a\\b^"');
  });

  it('double-escapes metacharacters for batch files', () => {
    expect(escapeCmdArgument('a b', true)).toBe('^^^"a^^^ b^^^"');
    expect(escapeCmdArgument('x&y', true)).toBe('^^^"x^^^&y^^^"');
    expect(escapeCmdArgument('%PATH%', true)).toBe('^^^"^^^%PATH^^^%^^^"');
  });

  it('escapes an empty argument to an empty quoted string', () => {
    expect(escapeCmdArgument('', true)).toBe('^^^"^^^"');
  });
});

describe('escapeCmdCommand', () => {
  it('caret-escapes metacharacters in the command path', () => {
    expect(escapeCmdCommand('C:\\Program Files (x86)\\t&t\\tool.bat')).toBe(
      'C:\\Program^ Files^ ^(x86^)\\t^&t\\tool.bat',
    );
  });
});

describe('toExecFileCommand', () => {
  it('wraps a .bat file in an escaped cmd.exe line with verbatim arguments', () => {
    const command = toExecFileCommand(
      'C:\\tools\\jadx\\bin\\jadx.bat',
      ['-d', 'C:\\out & more\\', 'sample.apk'],
      'win32',
    );
    expect(command).toEqual({
      file: COMSPEC,
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\tools\\jadx\\bin\\jadx.bat ^^^"-d^^^" ^^^"C:\\out^^^ ^^^&^^^ more\\\\^^^" ^^^"sample.apk^^^""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it('wraps .cmd files the same way, case-insensitively', () => {
    const command = toExecFileCommand('C:\\bin\\TOOL.CMD', [], 'win32');
    expect(command.file).toBe(COMSPEC);
    expect(command.args).toEqual(['/d', '/s', '/c', '"C:\\bin\\TOOL.CMD"']);
  });

  it('leaves .exe files and non-Windows platforms unchanged', () => {
    expect(toExecFileCommand('C:\\sdk\\adb.exe', ['devices'], 'win32')).toEqual({
      file: 'C:\\sdk\\adb.exe',
      args: ['devices'],
      windowsVerbatimArguments: false,
    });
    expect(toExecFileCommand('/opt/jadx/bin/jadx.bat', ['a b'], 'linux')).toEqual({
      file: '/opt/jadx/bin/jadx.bat',
      args: ['a b'],
      windowsVerbatimArguments: false,
    });
  });

  it('refuses quotes and line breaks in batch-file arguments', () => {
    expect(() => toExecFileCommand('C:\\t\\tool.bat', ['a"&calc'], 'win32')).toThrow(
      /quote or line break/,
    );
    expect(() => toExecFileCommand('C:\\t\\tool.bat', ['a\r\ncalc'], 'win32')).toThrow(
      /quote or line break/,
    );
  });
});
