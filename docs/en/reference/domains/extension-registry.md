# Extension Registry

Domain: `extension-registry`

Extension registry domain for managing and discovering community extensions.

## Profiles

- workflow
- full

## Typical scenarios

- Extension browsing
- Extension installation
- Extension version management

## Common combinations

- extension-registry + workflow
- extension-registry + maintenance

## Representative tools

- `extension_list_installed` — List installed extensions from the local extension registry
- `extension_execute_in_context` — Load an extension and execute a named exported context function
- `extension_install` — Install an extension from a local or remote manifest/module URL
- `extension_reload` — Reload an installed extension by unloading and loading it again
- `extension_uninstall` — Uninstall an extension from the local extension registry
- `webhook_create` — Create a new webhook endpoint for external callbacks
- `webhook_list` — List all registered webhook endpoints
- `webhook_delete` — Delete a webhook endpoint by ID
- `webhook_commands` — Get or set commands queued for a webhook endpoint

## Full tool list (9)

| Tool | Description |
| --- | --- |
| `extension_list_installed` | List installed extensions from the local extension registry |
| `extension_execute_in_context` | Load an extension and execute a named exported context function |
| `extension_install` | Install an extension from a local or remote manifest/module URL |
| `extension_reload` | Reload an installed extension by unloading and loading it again |
| `extension_uninstall` | Uninstall an extension from the local extension registry |
| `webhook_create` | Create a new webhook endpoint for external callbacks |
| `webhook_list` | List all registered webhook endpoints |
| `webhook_delete` | Delete a webhook endpoint by ID |
| `webhook_commands` | Get or set commands queued for a webhook endpoint |
