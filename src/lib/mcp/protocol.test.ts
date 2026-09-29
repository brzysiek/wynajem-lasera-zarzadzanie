import { describe, expect, it } from "vitest";
import { handleMessage, type Dispatch } from "./protocol";

const d: Dispatch = {
  tools: [{ name: "echo", title: "Echo", description: "x", inputSchema: { type: "object" }, readOnly: true }],
  call: async (name, args) => (args.fail ? { ok: false, message: "zły parametr" } : { ok: true, value: { name, args } }),
};

describe("MCP JSON-RPC", () => {
  it("initialize uzgadnia wersję", async () => {
    const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, d);
    expect(r?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "wynajem-lasera-panel" } });
    const r2 = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, d);
    expect((r2?.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
  });
  it("wersja serwera zmienia się ze schematem narzędzi", async () => {
    const v1 = ((await handleMessage({ jsonrpc: "2.0", id: 7, method: "initialize" }, d))?.result as { serverInfo: { version: string } }).serverInfo.version;
    const d2: Dispatch = { ...d, tools: [{ ...d.tools[0], inputSchema: { type: "object", properties: { bez_powiazania: { type: "boolean" } } } }] };
    const v2 = ((await handleMessage({ jsonrpc: "2.0", id: 8, method: "initialize" }, d2))?.result as { serverInfo: { version: string } }).serverInfo.version;
    expect(v1).not.toBe(v2);
    expect(v1).toMatch(/^1\.1\./);
  });
  it("powiadomienia bez odpowiedzi", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, d)).toBeNull();
  });
  it("tools/list z adnotacjami", async () => {
    const r = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, d);
    expect(r?.result).toMatchObject({ tools: [{ name: "echo", annotations: { readOnlyHint: true, destructiveHint: false } }] });
  });
  it("tools/call: wynik, błąd narzędzia, nieznane narzędzie", async () => {
    const ok = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } }, d);
    expect(ok?.result).toEqual({ content: [{ type: "text", text: JSON.stringify({ name: "echo", args: { a: 1 } }) }] });
    const bad = await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: { fail: true } } }, d);
    expect(bad?.result).toEqual({ content: [{ type: "text", text: "zły parametr" }], isError: true });
    const unknown = await handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "usun_wszystko" } }, d);
    expect(unknown?.error?.code).toBe(-32602);
  });
  it("nieznana metoda", async () => {
    expect((await handleMessage({ jsonrpc: "2.0", id: 7, method: "resources/list" }, d))?.error?.code).toBe(-32601);
  });
});
