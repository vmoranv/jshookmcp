# Mojo IPC

Domain: `mojo-ipc`

Mojo IPC monitoring domain for Chromium inter-process communication analysis.

## Profiles

- full

## Typical scenarios

- Mojo message monitoring
- IPC pattern analysis
- Chromium internal protocol reversing

## Common combinations

- mojo-ipc + browser
- mojo-ipc + network

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `mojo_ipc_capabilities` | Report Mojo IPC monitoring availability. |
| `mojo_monitor` | Start or stop Mojo IPC monitoring for the active Chromium-based target. |
| `mojo_decode_message` | Decode a Mojo IPC hex payload into a structured field map. |
| `mojo_encode_message` | Encode a structured Mojo IPC message into a hex payload. |
| `mojo_list_interfaces` | List discovered Mojo IPC interfaces and their pending message counts. |
| `mojo_messages_get` | Retrieve captured Mojo IPC messages from the active monitoring session. |
| `mojo_messages_summarize` | Aggregate the captured Mojo IPC buffer (non-destructive) into interface/method/direction breakdowns, top-N lists, and a capture time window. Does not drain the buffer. |
| `mojo_verify_live` | Generate a Frida verification script that probes a target Chromium process for known Mojo C-API exports (MojoWriteMessage, MojoWriteMessageNew) across modules. Uses a curated symbol database covering Chromium M96+ across Win32, Linux, and macOS. Returns a ready-to-run Frida script and probe metadata. Honest boundary (B-class): symbol DB is manually curated; symbols may vary by build config. Verified flag is always false — confirm against the live binary. |
