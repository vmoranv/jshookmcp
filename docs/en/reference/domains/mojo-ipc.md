# Mojo IPC

Domain: `mojo-ipc`

Mojo IPC monitoring domain for Chromium inter-process communication analysis.

## Profiles

- workflow
- full

## Typical scenarios

- Mojo message monitoring
- IPC pattern analysis
- Chromium internal protocol reversing

## Common combinations

- mojo-ipc + browser
- mojo-ipc + network

## Representative tools

- `mojo_monitor_start` — Start Mojo IPC monitoring for the active Chromium-based target
- `mojo_monitor_stop` — Stop the active Mojo IPC monitoring session
- `mojo_decode_message` — Decode a Mojo IPC hex payload into a structured field map
- `mojo_list_interfaces` — List discovered Mojo IPC interfaces and their pending message counts
- `mojo_messages_get` — Retrieve captured Mojo IPC messages from the active monitoring session

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `mojo_monitor_start` | Start Mojo IPC monitoring for the active Chromium-based target |
| `mojo_monitor_stop` | Stop the active Mojo IPC monitoring session |
| `mojo_decode_message` | Decode a Mojo IPC hex payload into a structured field map |
| `mojo_list_interfaces` | List discovered Mojo IPC interfaces and their pending message counts |
| `mojo_messages_get` | Retrieve captured Mojo IPC messages from the active monitoring session |
