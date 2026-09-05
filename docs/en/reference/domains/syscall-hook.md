# Syscall Hook

Domain: `syscall-hook`

System call hooking domain providing system call monitoring and mapping capabilities.

## Profiles

- full

## Typical scenarios

- System call monitoring
- API hooking
- Behavioral analysis

## Common combinations

- syscall-hook + process
- syscall-hook + instrumentation

## Full tool list (15)

| Tool | Description |
| --- | --- |
| `syscall_start_monitor` | Start syscall monitoring. |
| `syscall_stop_monitor` | Stop syscall interception and release all captured events. |
| `syscall_capture_events` | Capture syscall events from the active or last monitoring session. |
| `syscall_correlate_js` | Correlate captured syscalls with likely JavaScript functions. |
| `syscall_filter` | Filter captured syscall events by name, PID, or return value. |
| `syscall_get_stats` | Get syscall monitoring statistics. |
| `syscall_ebpf_trace` | Trace syscalls on Linux with eBPF. Requires root or CAP_BPF. |
| `syscall_resolve_ssn` | Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. Parses the export table to extract Zw* → SSN mappings and locates a syscall;ret gadget for direct invocation stubs. Win32 only. |
| `syscall_direct_invoke` | Direct NT syscall invocation guidance. Resolves SSN for a given NT function and returns a stub template with usage instructions for in-process direct syscall invocation. Bypasses user-mode hooks on ntdll.dll. Win32 only. |
| `syscall_stack_capture` | Correlate captured syscall events with real JS call stacks via debugger integration. Goes beyond static heuristics by querying live CDP call stacks for syscall→JS mapping. Falls back to heuristic-only mode when no debugger is attached. |
| `syscall_trace_compare` | Diff two syscall trace snapshots to find appeared/disappeared syscalls and frequency changes. Useful for understanding what OS calls a JS operation triggers. Capture baseline events → perform the operation → capture target events → pass both arrays here. Use syscall_capture_events (or syscall_trace_export) to obtain each snapshot. |
| `syscall_trace_export` | Export captured syscall events to portable NDJSON with optional time-range filtering and deduplication. Returns both structured array and NDJSON string. |
| `syscall_ebpf_attach` | Live eBPF syscall attach — spawns a bpftrace process, captures syscall events as structured JSON in real time, and returns them directly. Unlike syscall_ebpf_trace (script-generator), this tool actually runs bpftrace and captures output. Falls back to script mode on non-Linux or when bpftrace is unavailable. Requires bpftrace + CAP_BPF or root on Linux. |
| `syscall_origin_map` | Build a unified syscall→JS origin map by integrating live CDP call stacks (syscall_stack_capture) with static timing heuristics (syscall_correlate_js). Aggregates recent syscall events by JavaScript function so callers can see which JS function triggered which syscalls and how often. Debugger stacks are preferred when available; heuristics fill the gaps. |
| `syscall_pattern_detect` | Scan captured syscall events for behavioral patterns relevant to reverse engineering: anti-debug probes (ptrace / IsDebuggerPresent), system fingerprinting (uname / getuid), filesystem enumeration (openat + getdents), network beaconing (connect / sendto), process spawning (clone / execve), and Windows registry probing. Returns classified patterns with evidence. |
