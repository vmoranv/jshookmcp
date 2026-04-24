import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import * as parser from "@babel/parser";

const execAsync = promisify(exec);

const server = new Server(
  { name: "jshook-project-helper", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ast_explore",
        description: "Parse a JavaScript/TypeScript file into an AST for inspection.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path to the JS/TS file" }
          },
          required: ["filePath"]
        }
      },
      {
        name: "regex_eval",
        description: "Evaluate a regular expression against text safely.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern (without slashes)" },
            flags: { type: "string", description: "Regex flags (e.g., 'g', 'i')" },
            text: { type: "string", description: "Text to evaluate against" }
          },
          required: ["pattern", "text"]
        }
      },
      {
        name: "run_vitest",
        description: "Run vitest for a specific test file.",
        inputSchema: {
          type: "object",
          properties: {
            testFile: { type: "string", description: "Path to the test file" }
          },
          required: ["testFile"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "ast_explore") {
      const code = await fs.readFile(args.filePath, "utf-8");
      const ast = parser.parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      });
      // Return a truncated version to avoid huge payload size issues
      const types = new Map();
      let totalNodes = 0;
      const traverse = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type) {
          types.set(node.type, (types.get(node.type) || 0) + 1);
          totalNodes++;
        }
        for (const key in node) {
          if (Array.isArray(node[key])) node[key].forEach(traverse);
          else traverse(node[key]);
        }
      };
      traverse(ast);
      
      return {
        content: [{ type: "text", text: `AST Parsing Successful.\nTotal Nodes: ${totalNodes}\nNode Types: ${JSON.stringify(Object.fromEntries(types), null, 2)}` }]
      };
    } 
    
    if (name === "regex_eval") {
      const { pattern, flags = "", text } = args;
      const regex = new RegExp(pattern, flags);
      const matches = [...text.matchAll(regex)];
      return {
        content: [{ type: "text", text: JSON.stringify({ matches: matches.map(m => m[0]), count: matches.length }, null, 2) }]
      };
    }

    if (name === "run_vitest") {
      try {
        const { stdout, stderr } = await execAsync(`npm run test -- ${args.testFile}`);
        return { content: [{ type: "text", text: stdout + (stderr ? "\nSTDERR:\n" + stderr : "") }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.stdout + "\n" + err.stderr }] };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
