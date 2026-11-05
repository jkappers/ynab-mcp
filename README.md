# ynab-mcp

An [MCP](https://modelcontextprotocol.io) server for the [YNAB API](https://api.ynab.com). Tools are generated at startup from YNAB's published OpenAPI spec, so there are no hand-written wrappers.

I built it to clean up a backlog of uncategorized transactions with Claude Code. Write-up: [Using Claude Code to clean up years of YNAB and Amazon charges](https://jkappers.me/writing/ynab-amazon-cleanup/).

## Tools

At startup the server fetches the spec from `SPEC_URL` and creates one tool per operation (44 in spec v1.89.0). Restart to pick up API changes. Startup needs network access to the spec URL.

- Name: `operationId` in snake_case (`getTransactionsByAccount` is `get_transactions_by_account`).
- Input: path and query parameters are top-level properties. A JSON request body is a single `body` property, with `$ref`s resolved inline.
- Annotations: `GET` is `readOnlyHint`, `DELETE` is `destructiveHint`.
- Output: the raw JSON response. Non-2xx responses return `isError` with `HTTP <status>: <body>`.

## Requirements

- Node.js 22.9+ and [pnpm](https://pnpm.io). The Docker image uses Node 26.
- A YNAB personal access token, from Account Settings, then Developer Settings.

## Install

```sh
pnpm install --frozen-lockfile
pnpm build
```

## Configuration

| Variable        | Required | Default                                           | Purpose                                      |
| --------------- | -------- | ------------------------------------------------- | -------------------------------------------- |
| `API_TOKEN`     | yes      |                                                   | YNAB token, sent as a Bearer token.          |
| `API_URL`       | no       | spec `servers[0].url` (`https://api.ynab.com/v1`) | API base URL.                                |
| `SPEC_URL`      | no       | `https://api.ynab.com/papi/open_api_spec.yaml`    | OpenAPI spec (YAML or JSON).                 |
| `MCP_TRANSPORT` | no       | stdio                                             | Set to `http` for Streamable HTTP.           |
| `PORT`          | no       | `3000`                                            | HTTP port.                                   |

`pnpm start` loads `.env` if present. `node dist/index.js` does not, so use `--env-file` or real environment variables.

## Usage

### stdio

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/path/to/ynab-mcp/dist/index.js"],
      "env": { "API_TOKEN": "your-ynab-token" }
    }
  }
}
```

To keep the token out of the config, drop `env` and add `"--env-file=/path/to/ynab-mcp/.env"` before the script path in `args`.

Claude Code:

```sh
claude mcp add ynab -e API_TOKEN=your-ynab-token -- node /path/to/ynab-mcp/dist/index.js
```

### HTTP

```sh
MCP_TRANSPORT=http pnpm start
claude mcp add --transport http ynab http://127.0.0.1:3000/mcp
```

`POST /mcp` is the stateless Streamable HTTP endpoint. `GET /healthz` returns `200`.

### Docker

The image runs in HTTP mode on port 3000.

```sh
docker build -t ynab-mcp .
docker run --rm -p 127.0.0.1:3000:3000 -e API_TOKEN=your-ynab-token ynab-mcp
```

Or `docker compose up -d --build`, which reads `.env`.

## YNAB API notes

- Amounts are in milliunits: `1000` is 1.00, `-12340` is -12.34, for inputs and outputs. Responses also carry `*_formatted` and `*_currency` fields (API v1.82.0+).
- The limit is 200 requests per hour per token, in a rolling window. Past that you get HTTP 429.

## Security

- The token has full read/write access to your budget. `.env` is gitignored and dockerignored.
- Write and delete tools are exposed. Use your client's tool approval prompts.
- HTTP mode has no authentication. Keep it on localhost, as `compose.yaml` does, or put an authenticating proxy in front.
- The spec drives the tool definitions. Only point `SPEC_URL` at a source you trust.
