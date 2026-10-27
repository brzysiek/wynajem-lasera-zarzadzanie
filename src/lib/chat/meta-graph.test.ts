import { describe, expect, it } from "vitest";
import { metaConfigStatus, sanitizeGraphError, summarizeSubscription } from "./meta-graph";

describe("meta-graph", () => {
  it("status konfiguracji pokazuje tylko, czy zmienne są ustawione (nigdy wartości)", () => {
    const s = metaConfigStatus({ META_APP_SECRET: "tajny", META_PAGE_ID: "1" } as unknown as NodeJS.ProcessEnv);
    expect(s).toEqual({ appSecret: true, verifyToken: false, pageToken: false, pageId: true, appId: false });
    expect(JSON.stringify(s)).not.toContain("tajny");
  });
  it("błędy Graph API są oczyszczone z tokenów", () => {
    const t = "EAAB" + "x".repeat(120);
    expect(sanitizeGraphError(`Invalid OAuth access token ${t}.`)).not.toContain("xxxx");
  });
  it("podsumowanie subskrypcji: nasza aplikacja i brakujące pola", () => {
    const page = { name: "WynajemLasera", instagram_business_account: { id: "IG1", username: "wynajemlasera" } };
    const subs = { data: [{ id: "111", name: "HubSpot", subscribed_fields: ["messages"] }, { id: "222", name: "Panel", subscribed_fields: ["messages", "message_echoes"] }] };
    const info = summarizeSubscription(page, subs, "222");
    expect(info).toMatchObject({ pageName: "WynajemLasera", instagram: { id: "IG1", username: "wynajemlasera" }, missing: ["standby"] });
    expect(info.apps.find((a) => a.ours)?.name).toBe("Panel");
    expect(summarizeSubscription(page, subs, undefined).missing).toEqual([]);
  });
});
