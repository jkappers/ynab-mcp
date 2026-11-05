import { parse } from "yaml";

type Json = any;

export interface Op {
  name: string;
  method: string;
  path: string;
  description: string;
  inputSchema: Json;
  pathParams: string[];
  queryParams: string[];
  hasBody: boolean;
  annotations: Record<string, boolean>;
}

const SPEC_URL = process.env.SPEC_URL || "https://api.ynab.com/papi/open_api_spec.yaml";

async function loadSpec(): Promise<Json> {
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec from ${SPEC_URL}: HTTP ${res.status}`);
  return parse(await res.text());
}

export const spec: Json = await loadSpec();

const STRIP = new Set(["nullable", "example", "examples", "discriminator", "xml", "externalDocs"]);
const MAX_DEPTH = 12;

function resolve(node: Json, stack: string[] = []): Json {
  if (Array.isArray(node)) return node.map((n) => resolve(n, stack));
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const ref: string = node.$ref;
    if (stack.includes(ref) || stack.length >= MAX_DEPTH) return { type: "object" };
    const target = ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], spec);
    const { $ref, ...rest } = node;
    return { ...resolve(target, [...stack, ref]), ...resolve(rest, stack) };
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (!STRIP.has(k)) out[k] = resolve(v, stack);
  }
  return out;
}

const snake = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();

export function buildOps(): Op[] {
  const ops: Op[] = [];
  for (const [path, item] of Object.entries<Json>(spec.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      const params: Json[] = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => resolve(p));
      const properties: Json = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      for (const p of params) {
        if (p.in !== "path" && p.in !== "query") continue;
        properties[p.name] = { ...p.schema, ...(p.description ? { description: p.description } : {}) };
        if (p.required) required.push(p.name);
        (p.in === "path" ? pathParams : queryParams).push(p.name);
      }
      let hasBody = false;
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        hasBody = true;
        properties.body = {
          ...resolve(bodySchema),
          ...(op.requestBody.description ? { description: op.requestBody.description } : {}),
        };
        if (op.requestBody.required) required.push("body");
      }
      const desc = [op.summary, op.description].filter(Boolean).join("\n\n");
      ops.push({
        name: snake(op.operationId),
        method: method.toUpperCase(),
        path,
        description:
          desc + (hasBody ? "\n\nNote: monetary amounts are in milliunits (1000 = 1.00 currency unit)." : ""),
        inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
        pathParams,
        queryParams,
        hasBody,
        annotations:
          method === "get"
            ? { readOnlyHint: true, openWorldHint: true }
            : { readOnlyHint: false, destructiveHint: method === "delete", openWorldHint: true },
      });
    }
  }
  return ops;
}
