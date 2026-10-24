import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    const where = 'C:\\platform-tools\\adb.exe\r\nC:\\other\\adb.exe\r\n';
    expect(pickWindowsExecutable(where, PATHEXT)).toBe('C:\\platform-tools\\adb.exe');
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
    expect(escapeCmdArgument('a b')).toBe('^"a^ b^"');
    expect(escapeCmdArgument('x&y|z')).toBe('^"x^&y^|z^"');
    expect(escapeCmdArgument('100%')).toBe('^"100^%^"');
    expect(escapeCmdArgument('%PATH%')).toBe('^"^%PATH^%^"');
    expect(escapeCmdArgument('c^d')).toBe('^"c^^d^"');
    expect(escapeCmdArgument('<a>(b)!')).toBe('^"^<a^>^(b^)^!^"');
  });

  it('escapes embedded quotes and the backslashes before them', () => {
    expect(escapeCmdArgument('say "hi"')).toBe('^"say^ \\^"hi\\^"^"');
    expect(escapeCmdArgument('a\\"b')).toBe('^"a\\\\\\^"b^"');
  });

  it('doubles trailing backslashes so they do not escape the closing quote', () => {
    expect(escapeCmdArgument('C:\\out dir\\')).toBe('^"C:\\out^ dir\\\\^"');
    expect(escapeCmdArgument('C:\\a\\b')).toBe('^"C:\\a\\b^"');
  });

  it('escapes an empty argument to an empty quoted string', () => {
    expect(escapeCmdArgument('')).toBe('^"^"');
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
        '"C:\\tools\\jadx\\bin\\jadx.bat ^"-d^" ^"C:\\out^ ^&^ more\\\\^" ^"sample.apk^""',
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
    expect(toExecFileCommand('C:\\platform-tools\\adb.exe', ['devices'], 'win32')).toEqual({
      file: 'C:\\platform-tools\\adb.exe',
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

describe.runIf(process.platform === 'win32')('toExecFileCommand through real batch files', () => {
  let dir = '';
  const tricky = [
    '--version',
    'a b',
    'x&y',
    'p|q',
    '100%',
    '%PATH%',
    'c^d',
    'trail\\',
    'C:\\dir with space\\',
    '(paren)',
    '!bang!',
    '<lt>gt',
    'semi;colon',
    'comma,',
    'star*?',
    '`tick`',
    '&calc',
  ];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jshook winbat & (x) 100% '));
    writeFileSync(join(dir, 'argv.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n');
    const node = `"${process.execPath}" "%~dp0argv.js"`;
    // Plain %* forwarding, and the Gradle start-script pattern used by jadx.bat.
    writeFileSync(join(dir, 'forward.bat'), `@${node} %*\r\n`);
    writeFileSync(
      join(dir, 'gradle.bat'),
      [
        '@echo off',
        'set CMD_LINE_ARGS=',
        'if "x%~1" == "x" goto execute',
        'set CMD_LINE_ARGS=%*',
        ':execute',
        `${node} %CMD_LINE_ARGS%`,
        '',
      ].join('\r\n'),
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(['forward.bat', 'gradle.bat'])('passes every argument through %s unchanged', (bat) => {
    const command = toExecFileCommand(join(dir, bat), tricky);
    const { stdout, status } = spawnSync(command.file, command.args, {
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    });
    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(tricky);
  });
});
