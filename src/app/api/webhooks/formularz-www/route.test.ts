import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const logs: { result: string }[] = [];
const intake = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { webhookLog: { create: vi.fn(async ({ data }: { data: { result: string } }) => (logs.push(data), data)) } },
}));
vi.mock("@/lib/leads/www-intake", () => ({ intakeWwwForm: (...a: unknown[]) => intake(...a) }));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

const { POST } = await import("./route");
const URL_BASE = "http://localhost/api/webhooks/formularz-www";

function req(query: string, body: string, contentType: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${URL_BASE}${query}`, { method: "POST", body, headers: { "content-type": contentType, ...headers } });
}

describe("POST /api/webhooks/formularz-www", () => {
  beforeEach(() => {
    logs.length = 0;
    intake.mockReset();
    process.env.WWW_WEBHOOK_TOKEN = "sekret-testowy";
  });

  it("zły albo brak tokenu → 401 i wpis w logu", async () => {
    expect((await POST(req("?token=zly", "{}", "application/json"))).status).toBe(401);
    expect((await POST(req("", "{}", "application/json"))).status).toBe(401);
    expect(logs.map((l) => l.result)).toEqual(["UNAUTHORIZED", "UNAUTHORIZED"]);
    expect(intake).not.toHaveBeenCalled();
  });

  it("JSON z tokenem w ?token= → sygnał, typ i pola zmapowane", async () => {
    intake.mockResolvedValue({ result: "CREATED", leadId: "L1" });
    const body = JSON.stringify({ text: " rezerwacja-wynajmu", "contact-email": "Jan@Example.PL", "contact-phone": "600 100 200", "contact-days": "tydzień (Observ)", "contact-device": ["Observ 520x"] });
    const res = await POST(req("?token=sekret-testowy", body, "application/json"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: "CREATED", leadId: "L1" });
    const form = intake.mock.calls[0][0];
    expect(form).toMatchObject({ type: "REZERWACJA_WWW", email: "jan@example.pl", phone: "600 100 200", requestedDays: 7 });
    expect(logs[0].result).toBe("CREATED");
  });

  it("form-urlencoded z tokenem w nagłówku, puste daty nie wywracają zapisu", async () => {
    intake.mockResolvedValue({ result: "CREATED", leadId: "L2" });
    const body = "text=cennik&contact-email=a%40b.pl&contact-date-from=&contact-days=";
    const res = await POST(req("", body, "application/x-www-form-urlencoded", { "x-webhook-token": "sekret-testowy" }));
    expect(res.status).toBe(200);
    expect(intake.mock.calls[0][0]).toMatchObject({ type: "POBRANIE_CENNIKA", requestedFrom: null, requestedDays: null });
  });

  it("duplikat → 200 bez nowego sygnału", async () => {
    intake.mockResolvedValue({ result: "DUPLICATE" });
    const res = await POST(req("?token=sekret-testowy", JSON.stringify({ text: "kontakt", "contact-email": "a@b.pl" }), "application/json"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: "DUPLICATE", leadId: null });
  });

  it("błąd zapisu → 500 i wpis ERROR", async () => {
    intake.mockRejectedValue(new Error("db padła"));
    const res = await POST(req("?token=sekret-testowy", JSON.stringify({ text: "kontakt", "contact-email": "a@b.pl" }), "application/json"));
    expect(res.status).toBe(500);
    expect(logs[0].result).toBe("ERROR");
  });
});
