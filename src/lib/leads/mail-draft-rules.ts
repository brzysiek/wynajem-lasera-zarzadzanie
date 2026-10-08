// Szkic maila przy sygnale (wniosek 44): reguły i walidacja. Czysty moduł
// (vitest bez "@/").

export const DRAFT_ACTIVE = ["PROPOZYCJA", "SZKIC_GMAIL"] as const;
export type DraftStatus = "PROPOZYCJA" | "SZKIC_GMAIL" | "WYSLANY" | "ODRZUCONY";

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  PROPOZYCJA: "propozycja",
  SZKIC_GMAIL: "szkic w Gmailu",
  WYSLANY: "wysłany",
  ODRZUCONY: "odrzucony",
};

export const DRAFT_LIMITS = { subject: 255, body: 20_000, note: 5_000 } as const;

// „Re: temat” bez podwajania; brak tematu → pusty (biuro wpisze własny).
export function replySubject(original: string | null | undefined): string {
  const s = (original ?? "").trim();
  if (!s) return "";
  return /^(re|odp)\s*:/i.test(s) ? s : `Re: ${s}`;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// Komunikat błędu po polsku albo null, gdy szkic nadaje się do zapisu.
export function validateDraft(d: { to: string; subject: string; bodyText: string }): string | null {
  if (!EMAIL.test(d.to.trim())) return "Podaj poprawny adres e-mail odbiorcy.";
  if (!d.subject.trim()) return "Wpisz temat maila.";
  if (d.subject.length > DRAFT_LIMITS.subject) return `Temat może mieć najwyżej ${DRAFT_LIMITS.subject} znaków.`;
  if (!d.bodyText.trim()) return "Treść maila jest pusta.";
  if (d.bodyText.length > DRAFT_LIMITS.body) return `Treść może mieć najwyżej ${DRAFT_LIMITS.body} znaków.`;
  return null;
}

// Treść zmieniona po ostatnim zapisie do Gmaila — trzeba zapisać ponownie.
export function isDraftStale(contentUpdatedAt: Date | string, gmailSavedAt: Date | string | null): boolean {
  if (!gmailSavedAt) return false;
  return new Date(contentUpdatedAt).getTime() > new Date(gmailSavedAt).getTime() + 1000;
}

// Gotowy tekst oferty kończy się własnym podpisem („Pozdrawiam, Ania, …”), a
// szkic dostaje podpis ze stopki przy zapisie do Gmaila — obcinamy zakończenie,
// żeby podpis nie był podwójny.
export function stripSignOff(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const i = lines.findLastIndex((l) => /^\s*(pozdrawiam|z poważaniem|serdecznie pozdrawiam)\b/i.test(l));
  return (i >= 0 ? lines.slice(0, i) : lines).join("\n").trimEnd();
}

// Link do szkicu w skrzynce kontakt@ (działa po zalogowaniu na to konto).
export function gmailDraftUrl(mailbox: string, messageId: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#drafts?compose=${encodeURIComponent(messageId)}`;
}

// Wysłana wiadomość w wątku szkicu po jego zapisaniu w Gmailu = szkic wysłany.
export function findSentDraft<T extends { gmailThreadId: string | null; gmailSavedAt: Date | null }>(drafts: T[], mail: { threadId: string; sentAt: Date }): T | undefined {
  return drafts.find((d) => d.gmailThreadId === mail.threadId && d.gmailSavedAt != null && mail.sentAt.getTime() >= d.gmailSavedAt.getTime() - 60_000);
}
