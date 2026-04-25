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

## Representative tools

- `proxy_start` — Start the local HTTP/HTTPS proxy.
- `proxy_stop` — Stop the proxy.
- `proxy_status` — Read proxy status and CA path.
- `proxy_export_ca` — Read the proxy CA certificate.
- `proxy_add_rule` — Add a proxy rule.
- `proxy_get_requests` — Read captured proxy requests.
- `proxy_clear_logs` — Clear captured proxy logs.
- `proxy_setup_adb_device` — Configure an Android device to use the proxy.

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `proxy_start` | Start the local HTTP/HTTPS proxy. |
| `proxy_stop` | Stop the proxy. |
| `proxy_status` | Read proxy status and CA path. |
| `proxy_export_ca` | Read the proxy CA certificate. |
| `proxy_add_rule` | Add a proxy rule. |
| `proxy_get_requests` | Read captured proxy requests. |
| `proxy_clear_logs` | Clear captured proxy logs. |
| `proxy_setup_adb_device` | Configure an Android device to use the proxy. |
