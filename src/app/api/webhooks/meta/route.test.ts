import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ingest = vi.fn(async () => ({ stored: 1, duplicates: 0, leads: 1 }));
const logs: unknown[] = [];
vi.mock("@/lib/chat/ingest", () => ({ ingestMetaEvents: ingest }));
vi.mock("@/lib/prisma", () => ({ prisma: { webhookLog: { create: vi.fn(async ({ data }: { data: unknown }) => (logs.push(data), {})) } } }));
vi.mock("@/lib/alerts", () => ({ sendAlert: vi.fn(async () => true) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { GET, POST } = await import("./route");

const payload = { object: "page", entry: [{ id: "P1", messaging: [{ sender: { id: "U1" }, recipient: { id: "P1" }, timestamp: 1780000000000, message: { mid: "m1", text: "Cześć" } }] }] };
const raw = JSON.stringify(payload);
const sign = (body: string, secret = "sekret") => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const post = (body: string, sig: string | null) => POST(new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body, headers: { "Content-Type": "application/json", ...(sig ? { "x-hub-signature-256": sig } : {}) } }));

beforeEach(() => {
  process.env.META_APP_SECRET = "sekret";
  process.env.META_VERIFY_TOKEN = "weryfikacja";
  ingest.mockClear();
  logs.length = 0;
});

describe("GET (weryfikacja subskrypcji Meta)", () => {
  const get = (q: string) => GET(new NextRequest(`http://localhost/api/webhooks/meta?${q}`));
  it("zwraca challenge przy poprawnym tokenie", async () => {
    const res = await get("hub.mode=subscribe&hub.verify_token=weryfikacja&hub.challenge=12345");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });
  it("odrzuca zły token i brak konfiguracji", async () => {
    expect((await get("hub.mode=subscribe&hub.verify_token=zly&hub.challenge=1")).status).toBe(403);
    delete process.env.META_VERIFY_TOKEN;
    expect((await get("hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1")).status).toBe(403);
  });
});

describe("POST", () => {
  it("poprawny podpis → wiadomość zapisana", async () => {
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ kind: "meta-chat", result: "OK", externalId: "m1" });
  });
  it("zły albo brakujący podpis → 403 i nic się nie zapisuje", async () => {
    expect((await post(raw, sign(raw, "inny"))).status).toBe(403);
    expect((await post(raw, null)).status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ result: "UNAUTHORIZED" });
  });
  it("podpis poprawny, ale ładunek bez wiadomości → 200 i pominięcie", async () => {
    const body = JSON.stringify({ object: "page", entry: [{ id: "P1", messaging: [{ sender: { id: "U1" }, recipient: { id: "P1" }, read: { watermark: 1 } }] }] });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("błąd zapisu → 500 (Meta ponowi dostarczenie)", async () => {
    ingest.mockRejectedValueOnce(new Error("baza niedostępna"));
    expect((await post(raw, sign(raw))).status).toBe(500);
    expect(logs[0]).toMatchObject({ result: "ERROR" });
  });
});
