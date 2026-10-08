import { describe, expect, it } from "vitest";
import { findSentDraft, gmailDraftUrl, isDraftStale, replySubject, validateDraft } from "./mail-draft-rules";

describe("replySubject", () => {
  it("dopisuje Re: tylko raz", () => {
    expect(replySubject("Wynajem Almy")).toBe("Re: Wynajem Almy");
    expect(replySubject("Re: Wynajem Almy")).toBe("Re: Wynajem Almy");
    expect(replySubject("ODP: pytanie")).toBe("ODP: pytanie");
    expect(replySubject("  ")).toBe("");
    expect(replySubject(null)).toBe("");
  });
});

describe("validateDraft", () => {
  const ok = { to: "klientka@example.com", subject: "Re: Wynajem", bodyText: "Dzień dobry" };
  it("poprawny szkic", () => expect(validateDraft(ok)).toBeNull());
  it("odrzuca zły adres, pusty temat i pustą treść", () => {
    expect(validateDraft({ ...ok, to: "bez-malpy" })).toMatch(/adres/);
    expect(validateDraft({ ...ok, to: "a@b.pl, c@d.pl" })).toMatch(/adres/);
    expect(validateDraft({ ...ok, subject: "  " })).toMatch(/temat/);
    expect(validateDraft({ ...ok, bodyText: "\n " })).toMatch(/pusta/);
  });
  it("limity długości", () => {
    expect(validateDraft({ ...ok, subject: "x".repeat(256) })).toMatch(/Temat/);
    expect(validateDraft({ ...ok, bodyText: "x".repeat(20_001) })).toMatch(/Treść/);
  });
});

describe("isDraftStale", () => {
  it("zmiana po zapisie do Gmaila = nieaktualny; brak zapisu = nie dotyczy", () => {
    expect(isDraftStale("2026-10-08T12:05:00Z", "2026-10-08T12:00:00Z")).toBe(true);
    expect(isDraftStale("2026-10-08T12:00:00Z", "2026-10-08T12:00:00Z")).toBe(false);
    expect(isDraftStale("2026-10-08T12:00:00.500Z", "2026-10-08T12:00:00Z")).toBe(false); // tolerancja 1 s
    expect(isDraftStale("2026-10-08T12:05:00Z", null)).toBe(false);
  });
});

describe("gmailDraftUrl", () => {
  it("link do szkicu na koncie kontakt@", () => {
    expect(gmailDraftUrl("kontakt@wynajemlasera.pl", "18c0ffee")).toBe("https://mail.google.com/mail/u/kontakt%40wynajemlasera.pl/#drafts?compose=18c0ffee");
  });
});

describe("findSentDraft", () => {
  const saved = new Date("2026-10-08T12:00:00Z");
  const drafts = [
    { id: "a", gmailThreadId: "T1", gmailSavedAt: saved },
    { id: "b", gmailThreadId: "T2", gmailSavedAt: null },
  ];
  it("wysłana wiadomość w wątku po zapisie szkicu → ten szkic", () => {
    expect(findSentDraft(drafts, { threadId: "T1", sentAt: new Date("2026-10-08T12:30:00Z") })?.id).toBe("a");
  });
  it("inny wątek, brak zapisu w Gmailu albo wiadomość sprzed szkicu → nic", () => {
    expect(findSentDraft(drafts, { threadId: "T9", sentAt: new Date("2026-10-08T12:30:00Z") })).toBeUndefined();
    expect(findSentDraft(drafts, { threadId: "T2", sentAt: new Date("2026-10-08T12:30:00Z") })).toBeUndefined();
    expect(findSentDraft(drafts, { threadId: "T1", sentAt: new Date("2026-10-08T11:00:00Z") })).toBeUndefined();
  });
});
