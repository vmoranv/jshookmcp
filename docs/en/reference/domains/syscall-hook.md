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
- syscall-hook + hooks

## Full tool list (7)

| Tool | Description |
| --- | --- |
| `syscall_start_monitor` | Start syscall monitoring. |
| `syscall_stop_monitor` | Stop syscall interception and release all captured events. |
| `syscall_capture_events` | Capture syscall events from the active or last monitoring session. |
| `syscall_correlate_js` | Correlate captured syscalls with likely JavaScript functions. |
| `syscall_filter` | Filter captured syscall events by name, PID, or return value. |
| `syscall_get_stats` | Get syscall monitoring statistics. |
| `syscall_ebpf_trace` | Trace syscalls on Linux with eBPF. Requires root or CAP_BPF. |
