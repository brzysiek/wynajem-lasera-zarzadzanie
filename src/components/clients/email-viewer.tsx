"use client";

import { useEffect, useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { api } from "./client-forms";

// Podgląd e-maila (prompt 3, 4.4): treść pobierana z Gmaila w chwili
// otwarcia — panel jej nie zapisuje. Wyłącznie tekst (bez HTML, skryptów i
// zdalnych obrazów) + lista załączników + „Otwórz w Gmailu”. Wątek: strzałki
// między wiadomościami (od najnowszej).

type Email = {
  subject: string;
  from: string;
  to: string;
  cc: string | null;
  sentAt: string;
  direction: "IN" | "OUT";
  mailbox: string;
  text: string;
  attachments: { filename: string; size: number }[];
  gmailUrl: string;
};

function kb(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function EmailViewer({ messageIds, onClose }: { messageIds: string[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [cache, setCache] = useState<Record<string, Email | { error: string }>>({});
  const id = messageIds[index];
  const email = cache[id];

  useEffect(() => {
    if (cache[id]) return;
    let alive = true;
    void api<Email>(`/api/emails/${id}`, "GET").then(({ ok, data }) => {
      if (alive) setCache((c) => ({ ...c, [id]: ok ? data : { error: data.message ?? "Nie udało się pobrać wiadomości." } }));
    });
    return () => {
      alive = false;
    };
  }, [id, cache]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={APP_CSS_VARS} data-lead-modal className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="E-mail">
      <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.2)]">
        <div className="flex items-start gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0 flex-grow">
            <h2 className="m-0 text-base font-semibold text-[var(--c-navy)]">{email && "subject" in email ? email.subject : "E-mail"}</h2>
            {email && "subject" in email && (
              <div className="mt-1 space-y-0.5 text-xs text-[var(--c-muted)]">
                <p>
                  <b className="font-semibold text-[var(--c-text)]">{email.direction === "IN" ? "Od klienta" : "Do klienta"}</b> ·{" "}
                  {new Date(email.sentAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} · skrzynka{" "}
                  {email.mailbox}
                </p>
                <p className="truncate">Od: {email.from}</p>
                <p className="truncate">Do: {email.to}</p>
                {email.cc && <p className="truncate">DW: {email.cc}</p>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded-md p-1.5 text-[var(--c-muted)] hover:bg-[var(--c-bg)]">
            ✕
          </button>
        </div>

        <div className="min-h-[160px] flex-grow overflow-y-auto px-5 py-4">
          {!email && <p className="text-sm text-[var(--c-muted)]">Pobieranie z Gmaila…</p>}
          {email && "error" in email && <p className="text-sm text-[var(--c-red)]">{email.error}</p>}
          {email && "text" in email && (
            <>
              <pre className="whitespace-pre-wrap break-words font-[inherit] text-[13px] leading-relaxed text-[var(--c-text)]">{email.text || "(pusta treść)"}</pre>
              {email.attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {email.attachments.map((a, i) => (
                    <span key={i} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-sidebar-text)]">
                      📎 {a.filename} <span className="text-[var(--c-faint)]">{kb(a.size)}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--c-border)] px-5 py-3">
          {messageIds.length > 1 && (
            <>
              <button
                type="button"
                disabled={index >= messageIds.length - 1}
                onClick={() => setIndex((i) => i + 1)}
                className="h-8 rounded-lg border border-[var(--c-border)] px-3 text-[13px] hover:border-[var(--c-brand)] disabled:opacity-40"
              >
                ← Starsza
              </button>
              <span className="text-xs text-[var(--c-muted)] tabular-nums">
                {messageIds.length - index} / {messageIds.length} w wątku
              </span>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((i) => i - 1)}
                className="h-8 rounded-lg border border-[var(--c-border)] px-3 text-[13px] hover:border-[var(--c-brand)] disabled:opacity-40"
              >
                Nowsza →
              </button>
            </>
          )}
          {email && "gmailUrl" in email && (
            <a href={email.gmailUrl} target="_blank" rel="noreferrer" className="ml-auto text-[13px] font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              Otwórz w Gmailu ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
