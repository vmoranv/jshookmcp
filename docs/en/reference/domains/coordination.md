# Coordination

Domain: `coordination`

Coordination domain for session insights, MCP Task Handoff, and cross-agent shared state board, bridging the planning and execution boundaries of LLMs.

## Profiles

- workflow
- full

## Typical scenarios

- MCP Task Handoff
- Recording deep session insights
- Cross-agent data sharing and state broadcasting

## Common combinations

- coordination + workflow
- coordination + browser

## Full tool list (12)

| Tool | Description |
| --- | --- |
| `create_task_handoff` | Create a persisted task handoff for cross-tool coordination. |
| `complete_task_handoff` | Mark a task handoff as completed. |
| `update_task_handoff` | Update task handoff status or metadata without completing it. |
| `get_task_context` | Read persisted task handoff context and session insights. |
| `append_session_insight` | Record a persisted insight for the current session. |
| `save_page_snapshot` | Save current page state. |
| `restore_page_snapshot` | Restore a saved page snapshot. |
| `list_page_snapshots` | List saved page snapshots. |
| `coordination_restore_snapshot` | Restore a saved page snapshot including IndexedDB data. Navigates to the captured URL, re-injects cookies, localStorage, sessionStorage, and IndexedDB records from the snapshot. |
| `state_board` | CRUD operations on the cross-tool shared state board. TTL contract for set: omitting ttlSeconds defaults to 24h expiry; ttlSeconds: 0 means explicit permanent (no expiry, bounded only by the LRU cap); any other value is honored verbatim. NOTE: before this change, omitting ttlSeconds meant permanent — this is a behavior change. |
| `state_board_watch` | Watch state board keys for changes with configurable polling. |
| `state_board_io` | Serialize state board to JSON or restore from a previous export. |
