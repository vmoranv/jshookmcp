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

- `state_board_set` — Set a value in the shared state board.
- `state_board_get` — Get a value from the shared state board by key.
- `state_board_delete` — Delete a value from the shared state board by key.
- `state_board_list` — List all keys in the shared state board, optionally filtered by namespace.
- `state_board_watch` — Start or stop watching a key or pattern for changes.
- `state_board_history` — Get the change history for a key.
- `state_board_io` — Export or import state board entries.
- `state_board_clear` — Clear all or filtered state board entries.

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `state_board_set` | Set a value in the shared state board. |
| `state_board_get` | Get a value from the shared state board by key. |
| `state_board_delete` | Delete a value from the shared state board by key. |
| `state_board_list` | List all keys in the shared state board, optionally filtered by namespace. |
| `state_board_watch` | Start or stop watching a key or pattern for changes. |
| `state_board_history` | Get the change history for a key. |
| `state_board_io` | Export or import state board entries. |
| `state_board_clear` | Clear all or filtered state board entries. |
