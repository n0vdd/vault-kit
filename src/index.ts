import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { buildGraph } from "./graph.js";
import { registerAllTools } from "./tools/index.js";

const vaultPath = process.env.VAULT_PATH || join(homedir(), "Dropbox", "notes");

if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
  console.error(
    `[vault-kit] Error: vault path does not exist or is not a directory: ${vaultPath}`,
  );
  process.exit(1);
}

console.error(`[vault-kit] Building graph from: ${vaultPath}`);
const state = buildGraph(vaultPath);
console.error(
  `[vault-kit] Graph built: ${state.notes.size} notes, ${state.missing.size} missing links`,
);

const server = new McpServer({
  name: "vault-kit",
  version: "1.0.0",
});

registerAllTools(server, state);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[vault-kit] MCP server running on stdio");
