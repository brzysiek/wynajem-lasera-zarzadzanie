"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { formatNip, formatPhone } from "@/lib/clients/labels";
import { SmsComposer, api } from "../client-forms";
import { EmailViewer } from "../email-viewer";
import { Avatar, PhoneIcon, StatusChip } from "../ui";
import { gmailComposeUrl } from "./shared";
import { TabCommunication } from "./tab-communication";
import { TabData } from "./tab-data";
import { TabOverview, type CardTab } from "./tab-overview";
import { TabTransactions } from "./tab-transactions";

// Pełna karta klienta /klienci/[id] z zakładkami (docs/crm/prompt-claude-code-crm-3b-karta-klienta.md,
// wygląd: docs/crm/zrzuty/karta-*.png). Nagłówek wspólny dla zakładek,
// aktywna zakładka w URL (?tab=…) — link do zakładki da się wysłać.

export const LIST_URL_KEY = "wl_clients_list_search";

const TABS: { key: CardTab; label: string }[] = [
  { key: "przeglad", label: "Przegląd" },
  { key: "transakcje", label: "Wynajmy i faktury" },
  { key: "komunikacja", label: "Komunikacja" },
  { key: "dane", label: "Dane" },
];

function personName(c: { firstName: string | null; lastName: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
}

// isAgent — rola AGENT: bez SMS, e-maila i nowej rezerwacji (nie kontaktuje
// się z klientami); formularze danych wymagają źródła zmiany (AgentModeProvider
// na stronie).
export function ClientFullCard({
  initial,
  initialTab,
  isAdmin,
  isAgent = false,
}: {
  initial: ClientDetail;
  initialTab: CardTab;
  isAdmin: boolean;
  isAgent?: boolean;
}) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<CardTab>(initialTab);
  const [sms, setSms] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [focusNote, setFocusNote] = useState(0);
  const [emailIds, setEmailIds] = useState<string[] | null>(null);
  const [backHref, setBackHref] = useState("/klienci");

  useEffect(() => {
    try {
      const search = sessionStorage.getItem(LIST_URL_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage dostępny dopiero w przeglądarce
      if (search) setBackHref(`/klienci${search}`);
    } catch {
      // brak sessionStorage — zostaje zwykły powrót do listy
    }
  }, []);

  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const switchTab = useCallback((t: CardTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "przeglad") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const notify = (text: string, error = false) => setToast({ text, error });
  const reload = async () => {
    const { ok, data } = await api<ClientDetail>(`/api/clients/${d.id}`, "GET");
    if (ok) setD(data);
  };

  const openItem = (h: ClientHistoryItem) => {
    if (h.kind === "email") setEmailIds(h.messageIds);
    else switchTab("komunikacja");
  };

  const primary = d.contacts.find((c) => c.isPrimary) ?? d.contacts[0] ?? null;
  const smsRecipients = d.contacts.flatMap((c) =>
    [
      c.phone ? { label: `${personName(c) ?? "osoba"} · ${formatPhone(c.phone)}`, phone: c.phone } : null,
      c.phone2 ? { label: `${personName(c) ?? "osoba"} · ${c.phone2Label ?? "drugi"} ${formatPhone(c.phone2)}`, phone: c.phone2 } : null,
    ].filter((x): x is { label: string; phone: string } => Boolean(x)),
  );
  const email = d.contacts.find((c) => c.isPrimary && c.email)?.email ?? d.contacts.find((c) => c.email)?.email ?? null;
  const commCount = d.history.filter((h) => h.kind === "email" || h.kind === "message" || h.kind === "activity").length;
  const overdue = d.txTotals.overdueCount;
  const btn =
    "flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const soft = `${btn} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`;

  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      {/* Nagłówek */}
      <div className="-mx-4 -mt-6 border-b border-[var(--c-border)] bg-white px-4 pt-5 md:-mx-[30px] md:-mt-[26px] md:px-[30px]">
        <Link href={backHref} className="text-[13px] font-medium text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
          ← Klienci
        </Link>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <Avatar name={d.name} id={d.id} size={56} />
          <div className="min-w-0 flex-grow basis-[320px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-[26px] font-semibold leading-tight text-[var(--c-navy)]">{d.name}</h1>
              {d.qualification.qualified ? (
                <StatusChip status={d.summary.status} />
              ) : (
                <span className="rounded-full border border-dashed border-[var(--c-faint)] px-2.5 py-[2px] text-xs font-semibold text-[var(--c-sidebar-text)]">
                  Kontakt z zapytania
                </span>
              )}
              {overdue > 0 && (
                <span className="rounded-full bg-[var(--c-red-soft)] px-2.5 py-[3px] text-xs font-semibold text-[var(--c-red)]">
                  {overdue} {overdue === 1 ? "faktura" : "faktury"} po terminie
                </span>
              )}
            </div>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--c-muted)]">
              {[
                primary ? personName(primary) : null,
                primary?.phone ? (
                  <a key="p" href={`tel:${primary.phone}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                    {formatPhone(primary.phone)}
                  </a>
                ) : null,
                email ? (
                  <a key="e" href={`mailto:${email}`} className="text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                    {email}
                  </a>
                ) : null,
                d.city,
                d.nip ? `NIP ${formatNip(d.nip)}` : null,
                d.summary.firstSeenAt ? `klient od ${new Date(d.summary.firstSeenAt).toLocaleDateString("pl-PL", { month: "2-digit", year: "numeric" })}` : null,
              ]
                .filter(Boolean)
                .map((x, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    <span className="break-words sm:whitespace-nowrap">{x}</span>
                  </span>
                ))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {primary?.phone ? (
              <a href={`tel:${primary.phone}`} className={`${btn} bg-[var(--c-brand)] text-white hover:bg-[var(--c-brand-deep)]`}>
                <PhoneIcon />
                Zadzwoń
              </a>
            ) : (
              <button type="button" disabled className={`${btn} bg-[var(--c-brand)] text-white`}>
                <PhoneIcon />
                Zadzwoń
              </button>
            )}
            {!isAgent && (
              <button type="button" disabled={smsRecipients.length === 0} onClick={() => setSms((v) => !v)} className={soft}>
                SMS
              </button>
            )}
            {isAgent ? null : email ? (
              <a href={gmailComposeUrl(email, d.gmail.mailboxes[0] ?? null)} target="_blank" rel="noreferrer" className={soft} title="Nowa wiadomość w Gmailu">
                E-mail
              </a>
            ) : (
              <button type="button" disabled className={soft}>
                E-mail
              </button>
            )}
            {!isAgent && (
              <Link href={`/kalendarz/wynajem/nowy?klient=${d.id}`} className={soft}>
                Nowa rezerwacja
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                switchTab("komunikacja");
                setFocusNote((n) => n + 1);
              }}
              className={soft}
            >
              Notatka
            </button>
          </div>
        </div>

        {sms && (
          <div className="mt-3 max-w-[560px]">
            <SmsComposer
              recipients={smsRecipients}
              clientName={d.name}
              onCancel={() => setSms(false)}
              onSent={() => {
                setSms(false);
                notify("SMS wysłany.");
                void reload();
              }}
            />
          </div>
        )}

        {/* Zakładki */}
        <div role="tablist" className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => switchTab(t.key)}
                className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-[3px] px-4 pb-3 pt-1 text-[15px] transition-colors ${
                  on ? "border-[var(--c-brand)] font-semibold text-[var(--c-navy)]" : "border-transparent text-[var(--c-sidebar-text)] hover:text-[var(--c-text)]"
                }`}
              >
                {t.label}
                {t.key === "transakcje" && overdue > 0 && (
                  <span className="rounded-full bg-[var(--c-red-soft)] px-2 text-[11px] font-semibold text-[var(--c-red)]">{overdue} po terminie</span>
                )}
                {t.key === "komunikacja" && commCount > 0 && (
                  <span className="rounded-full bg-[var(--c-bg)] px-2 text-[11px] font-semibold text-[var(--c-muted)] tabular-nums">{commCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-6">
        {toast && (
          <p
            role="status"
            className={`mb-4 rounded-lg px-3 py-2 text-[13px] ${toast.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}
          >
            {toast.text}
          </p>
        )}
        {tab === "przeglad" && <TabOverview d={d} onTab={switchTab} onOpenItem={openItem} />}
        {tab === "transakcje" && <TabTransactions d={d} isAdmin={isAdmin} />}
        {tab === "komunikacja" && <TabCommunication
            d={d}
            onChanged={(n) => {
              setD(n);
              notify("Zapisano.");
            }}
            focusNote={focusNote}
          />}
        {tab === "dane" && <TabData d={d} onChanged={setD} notify={notify} isAdmin={isAdmin} />}
      </div>

      {emailIds && <EmailViewer messageIds={emailIds} onClose={() => setEmailIds(null)} />}
    </div>
  );
}
