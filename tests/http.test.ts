// The one HTTP client, against a local server.

import { afterAll, expect, test } from "bun:test";
import { Client } from "../src/core/http.ts";

const seen: { method: string; url: string; auth: string | null; body: string }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    seen.push({
      method: request.method,
      url: url.pathname + url.search,
      auth: request.headers.get("authorization"),
      body: await request.text(),
    });
    if (url.pathname === "/missing") return new Response("no such task", { status: 404 });
    if (url.pathname === "/empty") return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  },
});
afterAll(() => server.stop());

const api = new Client(`http://localhost:${server.port}`, "secret");

test("null in a body reaches the server, which is how a field is cleared", async () => {
  await api.post("/tasks/1", { deadline_date: null, content: "c" });
  expect(JSON.parse(seen.at(-1)?.body ?? "{}")).toEqual({ deadline_date: null, content: "c" });
});

test("undefined query params are left out rather than sent as the string", async () => {
  await api.get("/tasks", { project_id: "P", cursor: undefined, limit: 200 });
  expect(seen.at(-1)?.url).toBe("/tasks?project_id=P&limit=200");
});

test("every request carries the bearer token", async () => {
  await api.delete("/tasks/1");
  expect(seen.at(-1)).toMatchObject({ method: "DELETE", auth: "Bearer secret" });
});

test("an error status throws with the method, url and body", async () => {
  await expect(api.get("/missing")).rejects.toThrow(/GET .*\/missing -> 404: no such task/);
});

test("an empty reply reads as null", async () => {
  expect(await api.post("/empty")).toBeNull();
});
