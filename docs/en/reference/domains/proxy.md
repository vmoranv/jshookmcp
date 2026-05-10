# Proxy

Domain: `proxy`

Full-stack HTTP/HTTPS MITM proxy domain for system-level traffic interception, modification, and application configuration.

## Profiles

- full

## Typical scenarios

- Global HTTP/HTTPS capture
- API Mocking and forwarding
- Android assisted mounting

## Common combinations

- proxy + network
- proxy + adb-bridge

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `proxy_start` | Start the local HTTP/HTTPS interception proxy with optional TLS. |
| `proxy_stop` | Stop the proxy and release all active rules. |
| `proxy_status` | Report proxy status, listen port, and CA certificate path. |
| `proxy_export_ca` | Read the proxy CA certificate. |
| `proxy_add_rule` | Add an interception rule: forward, mock response, or block. |
| `proxy_get_requests` | Read captured proxy requests. |
| `proxy_clear_logs` | Clear all captured proxy request/response logs. |
| `proxy_setup_adb_device` | Configure an Android device to use the proxy. |
