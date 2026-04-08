import type { SyscallEvent } from './SyscallMonitor';

export interface CorrelatedSyscall {
  syscall: SyscallEvent;
  jsFunction?: string;
  confidence: number;
  reasoning: string;
}

interface CorrelationRule {
  syscallNames: string[];
  jsFunction: string;
  baseConfidence: number;
  explanation: string;
}

const CORRELATION_RULES: ReadonlyArray<CorrelationRule> = [
  {
    syscallNames: ['NtCreateFile', 'openat', 'open_nocancel'],
    jsFunction: 'fs.open',
    baseConfidence: 0.8,
    explanation: 'File open syscalls commonly originate from Node.js file-system entry points.',
  },
  {
    syscallNames: ['NtReadFile', 'read', 'read_nocancel'],
    jsFunction: 'fs.readFile',
    baseConfidence: 0.78,
    explanation: 'Read-oriented syscalls usually map back to file or stream reads in JavaScript.',
  },
  {
    syscallNames: ['NtWriteFile', 'write', 'write_nocancel'],
    jsFunction: 'fs.writeFile',
    baseConfidence: 0.78,
    explanation: 'Write-oriented syscalls are strongly associated with Node.js file writes.',
  },
  {
    syscallNames: ['NtDeviceIoControlFile', 'ioctl'],
    jsFunction: 'child_process.spawn',
    baseConfidence: 0.55,
    explanation:
      'Device and control syscalls are often triggered by child processes or native helpers.',
  },
  {
    syscallNames: ['connect', 'sendto', 'recvfrom'],
    jsFunction: 'fetch',
    baseConfidence: 0.7,
    explanation:
      'Socket syscalls generally indicate outbound network activity from fetch-like APIs.',
  },
];

function findRuleBySyscallName(syscallName: string): CorrelationRule | undefined {
  return CORRELATION_RULES.find((rule) => rule.syscallNames.includes(syscallName));
}

function clampConfidence(confidence: number): number {
  if (confidence < 0) {
    return 0;
  }
  if (confidence > 1) {
    return 1;
  }
  return confidence;
}

function hasArgContaining(args: string[], fragments: string[]): boolean {
  return args.some((arg) => fragments.some((fragment) => arg.toLowerCase().includes(fragment)));
}

export class SyscallToJSMapper {
  map(syscall: SyscallEvent): CorrelatedSyscall | null {
    const jsFunction = this.findJSFunction(syscall.syscall);
    if (!jsFunction) {
      return null;
    }

    const rule = findRuleBySyscallName(syscall.syscall);
    if (!rule) {
      return null;
    }

    let confidence = rule.baseConfidence;
    if (jsFunction.startsWith('fs.') && hasArgContaining(syscall.args, ['.js', '.json', '.node'])) {
      confidence += 0.08;
    }
    if (jsFunction === 'fetch' && hasArgContaining(syscall.args, ['80', '443', 'http', 'https'])) {
      confidence += 0.1;
    }

    return {
      syscall: {
        timestamp: syscall.timestamp,
        pid: syscall.pid,
        syscall: syscall.syscall,
        args: [...syscall.args],
        returnValue: syscall.returnValue,
        duration: syscall.duration,
      },
      jsFunction,
      confidence: clampConfidence(confidence),
      reasoning: this.getCorrelationReason(syscall, jsFunction),
    };
  }

  findJSFunction(syscallName: string): string | null {
    const rule = findRuleBySyscallName(syscallName);
    if (!rule) {
      return null;
    }
    return rule.jsFunction;
  }

  getCorrelationReason(syscall: SyscallEvent, jsFunc: string): string {
    const rule = findRuleBySyscallName(syscall.syscall);
    const detailParts: string[] = [];

    if (rule) {
      detailParts.push(rule.explanation);
    }

    if (jsFunc.startsWith('fs.') && hasArgContaining(syscall.args, ['.js', '.json', '.node'])) {
      detailParts.push(
        'The syscall arguments reference module-like file extensions, which strengthens the fs correlation.',
      );
    }

    if (jsFunc === 'fetch' && hasArgContaining(syscall.args, ['80', '443', 'http', 'https'])) {
      detailParts.push(
        'The syscall arguments look like network endpoints, which aligns with fetch or low-level HTTP clients.',
      );
    }

    if (detailParts.length === 0) {
      detailParts.push(
        `Mapped ${syscall.syscall} to ${jsFunc} using the default syscall-to-JS heuristic table.`,
      );
    }

    return detailParts.join(' ');
  }
}
