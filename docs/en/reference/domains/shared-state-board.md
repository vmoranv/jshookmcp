# Shared State Board

Domain: `shared-state-board`

Cross-agent state synchronization domain providing a global shared state board for multi-agent collaboration.

## Profiles

- full

## Typical scenarios

- Cross-agent data sharing
- Multi-agent workflow coordination
- Real-time state broadcasting

## Common combinations

- shared-state-board + coordination
- shared-state-board + workflow

## Representative tools

- `state_board_set` — Set a value in the shared state board. Supports string, number, boolean, object, and array values.
- `state_board_get` — Get a value from the shared state board by key.
- `state_board_delete` — Delete a value from the shared state board by key.
- `state_board_list` — List all keys in the shared state board, optionally filtered by namespace.
- `state_board_watch` — Watch a key or pattern for changes. Returns a watch ID that can be used to poll for updates.
- `state_board_unwatch` — Stop watching a key or pattern.
- `state_board_history` — Get the change history for a key.
- `state_board_export` — Export all or filtered state board entries as JSON.
- `state_board_import` — Import state board entries from JSON. Merges with existing state.
- `state_board_clear` — Clear all or filtered state board entries.

## Full tool list (10)

| Tool | Description |
| --- | --- |
| `state_board_set` | Set a value in the shared state board. Supports string, number, boolean, object, and array values. |
| `state_board_get` | Get a value from the shared state board by key. |
| `state_board_delete` | Delete a value from the shared state board by key. |
| `state_board_list` | List all keys in the shared state board, optionally filtered by namespace. |
| `state_board_watch` | Watch a key or pattern for changes. Returns a watch ID that can be used to poll for updates. |
| `state_board_unwatch` | Stop watching a key or pattern. |
| `state_board_history` | Get the change history for a key. |
| `state_board_export` | Export all or filtered state board entries as JSON. |
| `state_board_import` | Import state board entries from JSON. Merges with existing state. |
| `state_board_clear` | Clear all or filtered state board entries. |
