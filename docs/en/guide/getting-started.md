# Getting Started

A minimalist guide for successfully configuring `jshookmcp` for the first time.

## 1. Install Node.js

Ensure **Node.js 20.19+** or **22.12+** is installed on your system.

## 2. Update MCP Client Configuration

Append the following server definition to your MCP client configuration file (e.g., Claude Desktop or Cursor):

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"]
    }
  }
}
```

::: warning Note
The `-y` flag in the arguments is strictly required. Omitting it causes `npx` to await user prompt confirmation, resulting in an indefinite client timeout lock.
:::

## 3. Restart and Verify

Restart your MCP client and verify that the `jshook` tools are available. Send the following test prompt to your AI:

> "Please use the `page_navigate` tool from jshook to visit `https://example.com` and parse the page title."

Congratulations! The configuration is complete.

---

For advanced cache tuning or behavior modification, proceed to the [Configuration Guide](/en/guide/configuration).
