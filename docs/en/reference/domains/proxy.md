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

- `proxy_start` — Start the Mockttp local HTTP/HTTPS proxy server. Generates a local CA if one does not exist for TLS interception.
- `proxy_stop` — Stop the running Mockttp proxy server.
- `proxy_status` — Get the current status of the proxy server and the generated CA path.
- `proxy_export_ca` — Export the path or raw string of the local CA root certificate so the user can install and trust it on their target test devices.
- `proxy_add_rule` — Add a new interception, forwarding, or mocking rule to the proxy.
- `proxy_get_requests` — Retrieve the captured HTTP/HTTPS requests from the proxy buffer. You can filter by URL.
- `proxy_clear_logs` — Clear the captured HTTP/HTTPS requests buffer.
- `proxy_setup_adb_device` — Configure an Android device via ADB to route traffic through this proxy and inject the CA certificate.

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `proxy_start` | Start the Mockttp local HTTP/HTTPS proxy server. Generates a local CA if one does not exist for TLS interception. |
| `proxy_stop` | Stop the running Mockttp proxy server. |
| `proxy_status` | Get the current status of the proxy server and the generated CA path. |
| `proxy_export_ca` | Export the path or raw string of the local CA root certificate so the user can install and trust it on their target test devices. |
| `proxy_add_rule` | Add a new interception, forwarding, or mocking rule to the proxy. |
| `proxy_get_requests` | Retrieve the captured HTTP/HTTPS requests from the proxy buffer. You can filter by URL. |
| `proxy_clear_logs` | Clear the captured HTTP/HTTPS requests buffer. |
| `proxy_setup_adb_device` | Configure an Android device via ADB to route traffic through this proxy and inject the CA certificate. |
