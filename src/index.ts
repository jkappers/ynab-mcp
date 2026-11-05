import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildOps, spec } from "./openapi.js";
import { callOp } from "./client.js";

if (!process.env.API_TOKEN) {
  console.error("API_TOKEN is required (set it in the environment or .env)");
  process.exit(1);
}

const ops = buildOps();
const byName = new Map(ops.map((o) => [o.name, o]));

function makeServer() {
const server = new Server(
  { name: "ynab", version: spec.info.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ops.map((o) => ({
    name: o.name,
    description: o.description,
    inputSchema: o.inputSchema,
    annotations: o.annotations,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const op = byName.get(req.params.name);
  if (!op) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
  try {
    const r = await callOp(op, (req.params.arguments ?? {}) as Record<string, any>);
    return {
      ...(r.ok ? {} : { isError: true }),
      content: [{ type: "text", text: r.ok ? r.text : `HTTP ${r.status}: ${r.text}` }],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
});

return server;
}

if (process.env.MCP_TRANSPORT === "http") {
  const port = Number(process.env.PORT || 3000);
  createServer(async (req, res) => {
    if (req.url === "/healthz") return void res.writeHead(200).end("ok");
    if (req.url !== "/mcp") return void res.writeHead(404).end();
    if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return void res.writeHead(400).end();
    }
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }).listen(port, () => console.error(`ynab MCP (http) on :${port}/mcp with ${ops.length} tools`));
} else {
  await makeServer().connect(new StdioServerTransport());
  console.error(`ynab MCP server running with ${ops.length} tools`);
}
