"use client";

import { useState } from "react";
import { api } from "@/components/clients/client-forms";
import type { MailDraftDto } from "@/lib/leads/mail-draft";
import { DRAFT_STATUS_LABEL, replySubject, stripSignOff } from "@/lib/leads/mail-draft-rules";

// Odpowiedź mailowa przy sygnale (wniosek 44): notatka (skąd propozycja) i
// rozwijane pole z pełnym szkicem do poprawienia. „Zapisz szkic w Gmailu”
// tworzy szkic na kontakt@ (w wątku klientki) — wysyła człowiek w Gmailu, panel
// niczego nie wysyła. Treść to zwykły tekst; podpis (stopka z grafiką) dochodzi
// przy zapisie do Gmaila.

const BTN = "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 text-[12.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[#1B6FA8] px-3 text-[12.5px] font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40";
const INPUT = "w-full rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 py-1.5 text-[13px] text-[var(--c-text)] focus:border-[#1B6FA8] focus:outline-none";
const fmt = (iso: string) => new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export type OfferStarter = { to: string | null; subject: string; body: string };

export function LeadMailDraft({
  leadId,
  draft,
  defaultTo,
  lastInbound,
  offer,
  readOnly,
  onDraft,
}: {
  leadId: string;
  draft: MailDraftDto | null;
  defaultTo: string | null;
  lastInbound: { id: string; subject: string | null; sentAt: string } | null;
  offer: OfferStarter | null;
  readOnly: boolean;
  onDraft: (d: MailDraftDto | null) => void;
}) {
  const active = draft && (draft.status === "PROPOZYCJA" || draft.status === "SZKIC_GMAIL") ? draft : null;
  const [busy, setBusy] = useState<null | "save" | "gmail" | "create" | "discard">(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  // Lokalna edycja; nowa wersja z serwera (inny updatedAt) resetuje pola.
  const [form, setForm] = useState({ to: active?.toAddress ?? "", subject: active?.subject ?? "", bodyText: active?.bodyText ?? "", reply: Boolean(active?.replyTo) });
  const [seen, setSeen] = useState(active?.updatedAt ?? "");
  if ((active?.updatedAt ?? "") !== seen) {
    setSeen(active?.updatedAt ?? "");
    setForm({ to: active?.toAddress ?? "", subject: active?.subject ?? "", bodyText: active?.bodyText ?? "", reply: Boolean(active?.replyTo) });
  }
  const dirty = !!active && (form.to !== active.toAddress || form.subject !== active.subject || form.bodyText !== active.bodyText || form.reply !== Boolean(active.replyTo));

  async function create(starter: { to: string; subject: string; bodyText: string } | null, kind: "create") {
    setBusy(kind);
    setMsg(null);
    const body = starter ?? { to: defaultTo ?? "", subject: replySubject(lastInbound?.subject), bodyText: "" };
    const { ok, data } = await api<{ draft: MailDraftDto }>(`/api/leads/${leadId}/draft`, "PUT", body);
    setBusy(null);
    if (!ok) return setMsg({ text: (data as { message?: string }).message ?? "Nie udało się utworzyć szkicu.", error: true });
    onDraft(data.draft);
    setOpen(true);
  }

  async function save(): Promise<boolean> {
    if (!active) return false;
    setBusy("save");
    setMsg(null);
    const { ok, data } = await api<{ draft: MailDraftDto }>(`/api/leads/${leadId}/draft`, "PUT", {
      to: form.to,
      subject: form.subject,
      bodyText: form.bodyText,
      replyToEmailId: form.reply ? (active.replyTo?.id ?? lastInbound?.id ?? null) : null,
    });
    setBusy(null);
    if (!ok) {
      setMsg({ text: (data as { message?: string }).message ?? "Nie udało się zapisać.", error: true });
      return false;
    }
    onDraft(data.draft);
    setMsg({ text: "Zapisano zmiany w szkicu." });
    return true;
  }

  async function toGmail() {
    if (dirty && !(await save())) return;
    setBusy("gmail");
    setMsg(null);
    const { ok, data } = await api<{ draft: MailDraftDto }>(`/api/leads/${leadId}/draft/gmail`, "POST", {});
    setBusy(null);
    if (!ok) return setMsg({ text: (data as { message?: string }).message ?? "Nie udało się zapisać szkicu w Gmailu.", error: true });
    onDraft(data.draft);
    setMsg({ text: "Szkic zapisany w Gmailu (kontakt@). Wysyłasz go stamtąd." });
  }

  async function discard() {
    if (!window.confirm("Odrzucić ten szkic odpowiedzi?")) return;
    setBusy("discard");
    setMsg(null);
    const { ok, data } = await api(`/api/leads/${leadId}/draft`, "DELETE", undefined);
    setBusy(null);
    if (!ok) return setMsg({ text: (data as { message?: string }).message ?? "Nie udało się odrzucić.", error: true });
    onDraft(null);
  }

  // Brak aktywnego szkicu: podsumowanie wysłanego (jeśli jest) i przyciski startowe.
  if (!active) {
    if (readOnly && !draft) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-semibold text-[var(--c-navy)]">✉ Odpowiedź mailowa</span>
          {draft?.status === "WYSLANY" && (
            <span className="text-[var(--c-muted)]">
              wysłano {draft.sentAt ? fmt(draft.sentAt) : ""} — „{draft.subject}”
            </span>
          )}
          {!readOnly && (
            <>
              <button type="button" className={BTN} disabled={busy !== null} onClick={() => void create(null, "create")}>
                Napisz odpowiedź
              </button>
              {offer && (
                <button
                  type="button"
                  className={BTN}
                  disabled={busy !== null}
                  title="Wypełnia temat i treść gotowym tekstem oferty (urządzenie, wolne terminy, cena)"
                  onClick={() => void create({ to: offer.to ?? defaultTo ?? "", subject: offer.subject, bodyText: stripSignOff(offer.body) }, "create")}
                >
                  Z szkicu oferty
                </button>
              )}
            </>
          )}
        </div>
        {msg && <p className={`m-0 text-[12.5px] ${msg.error ? "text-[var(--c-red)]" : "text-[#2F7A68]"}`}>{msg.text}</p>}
      </div>
    );
  }

  const stale = active.stale;
  const editable = !readOnly;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--c-border)] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 flex-grow text-sm font-semibold text-[var(--c-navy)]">✉ Odpowiedź mailowa</h3>
        <span className="rounded-md bg-[var(--c-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-muted)]">{DRAFT_STATUS_LABEL[active.status]}</span>
        <span className="text-[11.5px] text-[var(--c-muted)]">
          {active.authorKind === "AGENT" ? `przygotował agent${active.authorName ? ` ${active.authorName}` : ""}` : (active.authorName ?? "biuro")}
          {active.editedByUser && active.authorKind === "AGENT" ? " · poprawione przez biuro" : ""} · {fmt(active.updatedAt)}
        </span>
      </div>

      {active.note && (
        <div className="whitespace-pre-line rounded-md bg-[var(--c-bg)] px-2.5 py-2 text-[12.5px] text-[var(--c-text)]">
          <b className="font-semibold text-[var(--c-navy)]">Notatka:</b> {active.note}
        </div>
      )}

      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-md border border-[var(--c-border)]">
        <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[13px] font-semibold text-[var(--c-brand-deep)]">
          Szkic odpowiedzi <span className="font-normal text-[var(--c-muted)]">— {active.subject || "(bez tematu)"}</span>
        </summary>
        <div className="flex flex-col gap-2 border-t border-[var(--c-border)] px-2.5 py-2.5">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--c-muted)]">
            Do
            <input className={INPUT} value={form.to} disabled={!editable} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="adres e-mail klientki" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--c-muted)]">
            Temat
            <input className={INPUT} value={form.subject} disabled={!editable} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--c-muted)]">
            Treść (zwykły tekst — pusta linia = nowy akapit)
            <textarea className={`${INPUT} min-h-[220px] leading-relaxed`} value={form.bodyText} disabled={!editable} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} />
          </label>
          {(lastInbound || active.replyTo) && (
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--c-text)]">
              <input type="checkbox" checked={form.reply} disabled={!editable} onChange={(e) => setForm({ ...form, reply: e.target.checked })} />
              Jako odpowiedź w wątku klientki: „{(active.replyTo ?? lastInbound)?.subject ?? "(bez tematu)"}”
            </label>
          )}
          <p className="m-0 text-[11.5px] text-[var(--c-faint)]">Podpis (stopka z grafiką) dochodzi automatycznie przy zapisie do Gmaila. Panel niczego nie wysyła — maila wysyłasz z Gmaila.</p>
        </div>
      </details>

      {active.status === "SZKIC_GMAIL" && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-[#2F7A68]">✓ W Gmailu{active.gmailSavedAt ? ` (zapisano ${fmt(active.gmailSavedAt)})` : ""}</span>
          {active.gmailUrl && (
            <a href={active.gmailUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--c-brand)] underline">
              Otwórz szkic w Gmailu ↗
            </a>
          )}
          {stale && <span className="font-semibold text-[#B8612F]">Zmieniono po zapisie — zapisz w Gmailu ponownie.</span>}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy !== null} onClick={() => void toGmail()}>
            {busy === "gmail" ? "Zapisywanie…" : active.status === "SZKIC_GMAIL" ? "Zaktualizuj szkic w Gmailu" : "Zapisz szkic w Gmailu"}
          </button>
          <button type="button" className={BTN} disabled={busy !== null || !dirty} onClick={() => void save()}>
            {busy === "save" ? "Zapisywanie…" : "Zapisz zmiany"}
          </button>
          <button type="button" className="ml-auto text-[12.5px] text-[var(--c-muted)] hover:text-[var(--c-red)]" disabled={busy !== null} onClick={() => void discard()}>
            Odrzuć szkic
          </button>
        </div>
      )}
      {msg && <p className={`m-0 text-[12.5px] ${msg.error ? "text-[var(--c-red)]" : "text-[#2F7A68]"}`}>{msg.text}</p>}
    </div>
  );
}
