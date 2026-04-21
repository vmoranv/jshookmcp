# Shared State Board

Domain: `shared-state-board`

Cross-agent state synchronization domain providing a global shared state board for multi-agent collaboration.

## Profiles

- workflow
- full

## Typical scenarios

- Cross-agent data sharing
- Multi-agent workflow coordination
- Real-time state broadcasting

## Common combinations

- shared-state-board + coordination
- shared-state-board + workflow

## Representative tools

- `state_board` — Unified shared state board for cross-agent key-value coordination.
- `state_board_watch` — Watch a key or pattern for changes. This is a POLL-based watch — call state_board_watch with action=poll and the returned watchId to check for changes. No server-side push; the caller must poll periodically.
- `state_board_io` — Export or import state board entries.

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `state_board` | Unified shared state board for cross-agent key-value coordination. |
| `state_board_watch` | Watch a key or pattern for changes. This is a POLL-based watch — call state_board_watch with action=poll and the returned watchId to check for changes. No server-side push; the caller must poll periodically. |
| `state_board_io` | Export or import state board entries. |
