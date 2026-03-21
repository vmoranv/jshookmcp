# Custom Macro Configuration

## Overview

Create custom macros by placing JSON files in the `macros/` directory at the project root.
Files are auto-discovered at server startup.

## JSON Schema

```json
{
  "id": "my_custom_macro",
  "displayName": "My Custom Macro",
  "description": "Description shown in list_macros",
  "tags": ["custom"],
  "timeoutMs": 30000,
  "steps": [
    {
      "id": "step_1",
      "toolName": "deobfuscate",
      "input": { "code": "var a=1;" }
    },
    {
      "id": "step_2",
      "toolName": "ast_transform_beautify",
      "inputFrom": { "code": "step_1.code" },
      "optional": true,
      "timeoutMs": 5000
    }
  ]
}
```

## Macro Fields

| Field         | Type     | Required | Description                           |
| ------------- | -------- | -------- | ------------------------------------- |
| `id`          | string   | ✓        | Unique macro identifier               |
| `displayName` | string   | ✓        | Human-readable name                   |
| `description` | string   |          | Description for `list_macros`         |
| `tags`        | string[] |          | Tags for filtering                    |
| `timeoutMs`   | number   |          | Total timeout in ms (default: 120000) |
| `steps`       | array    | ✓        | Ordered list of tool invocations      |

## Step Fields

| Field       | Type    | Required | Description                        |
| ----------- | ------- | -------- | ---------------------------------- |
| `id`        | string  | ✓        | Unique step ID within macro        |
| `toolName`  | string  | ✓        | MCP tool name to invoke            |
| `input`     | object  |          | Static input arguments             |
| `inputFrom` | object  |          | Map output fields from prior steps |
| `timeoutMs` | number  |          | Per-step timeout                   |
| `optional`  | boolean |          | If true, failure won't stop macro  |

## Data Flow — `inputFrom`

Use `inputFrom` to pipe data between steps:

```json
{ "code": "step_1.code" }
```

This takes the `code` field from `step_1`'s output and passes it as `code` input to the current step.

## Examples

### Deobfuscate + Extract Functions

```json
{
  "id": "full_analysis",
  "displayName": "Full JS Analysis",
  "description": "Deobfuscate + extract function tree",
  "steps": [
    { "id": "deob", "toolName": "deobfuscate", "input": {} },
    { "id": "tree", "toolName": "extract_function_tree", "inputFrom": { "code": "deob.code" } }
  ]
}
```

### Multi-Target Scan

```json
{
  "id": "scan_and_dump",
  "displayName": "Scan & Dump",
  "description": "Memory scan → dump matched regions",
  "tags": ["memory"],
  "timeoutMs": 60000,
  "steps": [
    {
      "id": "scan",
      "toolName": "memory_scan_first",
      "input": { "pid": 0, "valueType": "int32", "value": "100" }
    },
    {
      "id": "dump",
      "toolName": "memory_dump",
      "inputFrom": { "address": "scan.address" }
    }
  ]
}
```

## Usage

```bash
# List all available macros
list_macros

# Run a macro
run_macro({ macroId: "full_analysis", inputOverrides: { "deob": { "code": "..." } } })
```

## Overriding Built-in Macros

User macros with the same `id` as a built-in macro will override it. This lets you customize the default workflows.
