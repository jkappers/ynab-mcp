import { spec, type Op } from "./openapi.js";

export async function callOp(op: Op, args: Record<string, any>) {
  const token = process.env.API_TOKEN;
  if (!token) throw new Error("API_TOKEN is not set");
  const base = (process.env.API_URL || spec.servers[0].url).replace(/\/+$/, "");

  let path = op.path;
  for (const name of op.pathParams) {
    if (args[name] === undefined) throw new Error(`Missing path parameter: ${name}`);
    path = path.replace(`{${name}}`, encodeURIComponent(String(args[name])));
  }
  const qs = new URLSearchParams();
  for (const name of op.queryParams) {
    if (args[name] !== undefined) qs.set(name, String(args[name]));
  }
  const url = `${base}${path}${qs.size ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: op.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(op.hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: op.hasBody && args.body !== undefined ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: text || (res.ok ? JSON.stringify({ ok: true }) : "") };
}
