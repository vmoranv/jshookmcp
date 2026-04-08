# Syscall Hook

Domain: `syscall-hook`

System call hooking domain providing system call monitoring and mapping capabilities.

## Profiles

- workflow
- full

## Typical scenarios

- System call monitoring
- API hooking
- Behavioral analysis

## Common combinations

- syscall-hook + process
- syscall-hook + hooks

## Representative tools

- `syscall_start_monitor` — Start syscall monitoring using ETW, strace, or dtrace.
- `syscall_stop_monitor` — Stop syscall monitoring.
- `syscall_capture_events` — Capture syscall events from the active or last monitoring session.
- `syscall_correlate_js` — Correlate captured syscalls with likely JavaScript functions.
- `syscall_filter` — Filter captured syscall events by syscall name.
- `syscall_get_stats` — Get syscall monitoring statistics.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `syscall_start_monitor` | Start syscall monitoring using ETW, strace, or dtrace. |
| `syscall_stop_monitor` | Stop syscall monitoring. |
| `syscall_capture_events` | Capture syscall events from the active or last monitoring session. |
| `syscall_correlate_js` | Correlate captured syscalls with likely JavaScript functions. |
| `syscall_filter` | Filter captured syscall events by syscall name. |
| `syscall_get_stats` | Get syscall monitoring statistics. |
