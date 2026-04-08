import type { CrossDomainEvidenceBridge } from './evidence-graph-bridge';

export interface SyscallEvent {
  pid: number;
  tid: number;
  syscallName: string;
  timestamp: number;
}

export interface JSStackFrame {
  functionName: string;
}

export interface JSStack {
  threadId: number;
  timestamp: number;
  frames: JSStackFrame[];
}

export interface SyscallCorrelation {
  syscallName: string;
  topJsFunction: string;
  threadId: number;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface SyscallCorrelationResult {
  syscalls: number;
  correlations: SyscallCorrelation[];
  unmatchedSyscalls: Array<{ syscallName: string; tid: number }>;
  correlationConfidence: number;
  graphNodeIds: string[];
}

/**
 * Patterns mapping syscall names to JS API patterns for confidence scoring.
 * If the JS function name matches a pattern associated with a syscall, confidence is higher.
 */
const SYSCALL_JS_PATTERNS: Record<string, RegExp> = {
  NtReadFile: /read|fs[_.]read/i,
  NtWriteFile: /write|fs[_.]write/i,
  NtOpenFile: /open|fs[_.]open/i,
  NtCreateFile: /create|fs[_.]create/i,
  NtClose: /close|fs[_.]close/i,
  NtDeviceIoControlFile: /ioctl|device/i,
  NtQueryInformationFile: /stat|info|query/i,
  NtSetInformationFile: /set|chmod|chown/i,
};

function scoreConfidence(syscallName: string, functionName: string): 'high' | 'medium' | 'low' {
  const pattern = SYSCALL_JS_PATTERNS[syscallName];
  if (pattern && pattern.test(functionName)) {
    return 'high';
  }
  // Generic file-system related heuristic
  if (/file|fs|read|write|open|close/i.test(functionName)) {
    return 'medium';
  }
  return 'low';
}

export function correlateSyscallToJS(
  bridge: CrossDomainEvidenceBridge,
  syscallEvents: SyscallEvent[],
  jsStacks: JSStack[],
): SyscallCorrelationResult {
  const graphNodeIds: string[] = [];
  const correlations: SyscallCorrelation[] = [];
  const unmatchedSyscalls: Array<{ syscallName: string; tid: number }> = [];

  if (syscallEvents.length === 0) {
    return {
      syscalls: 0,
      correlations: [],
      unmatchedSyscalls: [],
      correlationConfidence: 0,
      graphNodeIds: [],
    };
  }

  for (const event of syscallEvents) {
    const syscallNode = bridge.addSyscallEvent({
      pid: event.pid,
      tid: event.tid,
      syscallName: event.syscallName,
      timestamp: event.timestamp,
    });
    graphNodeIds.push(syscallNode.id);

    // Find matching JS stack by thread ID and timestamp
    const matchingStack = jsStacks.find(
      (stack) => stack.threadId === event.tid && stack.timestamp === event.timestamp,
    );

    if (matchingStack && matchingStack.frames.length > 0) {
      const topFrame = matchingStack.frames[0];
      if (topFrame) {
        const functionName = topFrame.functionName;
        const confidence = scoreConfidence(event.syscallName, functionName);

        // Create a function node for the JS function and link it
        const funcNode = bridge.addNode('function', functionName, {
          domain: 'v8-inspector',
          functionName,
          threadId: event.tid,
        });
        graphNodeIds.push(funcNode.id);

        bridge.getGraph().addEdge(funcNode.id, syscallNode.id, 'syscall-emitted-by', {
          domain: 'cross-domain',
          confidence,
        });

        correlations.push({
          syscallName: event.syscallName,
          topJsFunction: functionName,
          threadId: event.tid,
          timestamp: event.timestamp,
          confidence,
        });
      } else {
        unmatchedSyscalls.push({ syscallName: event.syscallName, tid: event.tid });
      }
    } else {
      unmatchedSyscalls.push({ syscallName: event.syscallName, tid: event.tid });
    }
  }

  const correlationConfidence =
    syscallEvents.length === 0 ? 0 : correlations.length / syscallEvents.length;

  return {
    syscalls: syscallEvents.length,
    correlations,
    unmatchedSyscalls,
    correlationConfidence,
    graphNodeIds,
  };
}
