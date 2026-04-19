# Extension Registry

Domain: `extension-registry`

Extension registry domain for managing and discovering community extensions.

## Profiles

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
- `extension_reload` — Reload an installed extension by unloading and loading it again
- `extension_uninstall` — Uninstall an extension from the local extension registry
- `webhook` — Manage webhook endpoints for external callbacks. Actions: create, list, delete, commands.

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `extension_list_installed` | List installed extensions from the local extension registry |
| `extension_execute_in_context` | Load an extension and execute a named exported context function |
| `extension_reload` | Reload an installed extension by unloading and loading it again |
| `extension_uninstall` | Uninstall an extension from the local extension registry |
| `webhook` | Manage webhook endpoints for external callbacks. Actions: create, list, delete, commands. |
