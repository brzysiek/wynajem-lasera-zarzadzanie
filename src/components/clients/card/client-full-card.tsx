"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { APP_CSS_VARS, CARD_CSS_VARS } from "@/components/shell-tokens";
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
import { MergeDialog } from "./merge-dialog";
import { SplitDialog } from "./split-dialog";
import { ArchiveDialog } from "@/components/porzadki/archive-dialog";
import { ARCHIVE_REASON_LABEL, type ArchiveReasonKey } from "@/lib/porzadki/labels";
import type { ReviewClient } from "@/lib/history/review-load";
import { CardHeader, Indicators, NextStepBanner, TaskDialog } from "./card-header";
import { CardLeft, Tile } from "./card-left";
import { CardRight, InvoicesSection, QualitySection } from "./card-right";
import { TermsSection } from "./card-terms";

// Pełna karta klienta /klienci/[id] z zakładkami (docs/crm/prompt-claude-code-crm-3b-karta-klienta.md,
// wygląd: docs/crm/zrzuty/karta-*.png). Nagłówek wspólny dla zakładek,
// aktywna zakładka w URL (?tab=…) — link do zakładki da się wysłać.

export const LIST_URL_KEY = "wl_clients_list_search";

const TABS: { key: CardTab; label: string }[] = [
  { key: "karta", label: "Karta" },
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
  mergeOptions = [],
  pendingProposals = 0,
}: {
  initial: ClientDetail;
  initialTab: CardTab;
  isAdmin: boolean;
  isAgent?: boolean;
  // Klienci do wyboru przy „Scal duplikat” (Porządki).
  mergeOptions?: ReviewClient[];
  // Oczekujące propozycje zmian agenta dla tego klienta (Porządki → Propozycje).
  pendingProposals?: number;
}) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<CardTab>(initialTab);
  const [sms, setSms] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [focusNote, setFocusNote] = useState(0);
  const [emailIds, setEmailIds] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"archive" | "merge" | "split" | null>(null);
  const [splitTo, setSplitTo] = useState<string | null>(null);
  const [backHref, setBackHref] = useState("/klienci");
  const [task, setTask] = useState<{ title: string; due: string | null } | null>(null);

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
    if (t === "karta") url.searchParams.delete("tab");
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
    "flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const soft = `${btn} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`;

  const toastEl = toast && (
    <p
      role="status"
      className={`rounded-lg px-3 py-2 text-[12px] ${toast.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}
    >
      {toast.text}
    </p>
  );
  const dialogs = (
    <>
      {emailIds && <EmailViewer messageIds={emailIds} onClose={() => setEmailIds(null)} />}
      {task && (
        <TaskDialog
          d={d}
          initialTitle={task.title}
          initialDue={task.due}
          onClose={() => setTask(null)}
          onDone={(n) => {
            setTask(null);
            setD(n);
            notify("Utworzono zadanie.");
          }}
        />
      )}
      {dialog === "archive" && (
        <ArchiveDialog
          type="client"
          ids={[d.id]}
          label={d.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            notify("Zarchiwizowano. Klient zniknął z list; przywrócisz go tutaj albo w Porządki → Archiwum.");
            void reload();
          }}
        />
      )}
      {dialog === "split" && (
        <SplitDialog
          source={d}
          onClose={() => setDialog(null)}
          onDone={(next, newClientId) => {
            setDialog(null);
            setD(next);
            setSplitTo(newClientId);
            notify("Wydzielono do nowego klienta. Wpis jest w dzienniku.");
          }}
        />
      )}
      {dialog === "merge" && (
        <MergeDialog
          target={d}
          clients={mergeOptions}
          onClose={() => setDialog(null)}
          onMerged={(next) => {
            setDialog(null);
            setD(next);
            notify("Scalono. Duplikat jest w archiwum (powód: duplikat).");
          }}
        />
      )}
    </>
  );

  // Karta wg wzoru (karta-klienta-wzor.html) — domyślny widok.
  if (tab === "karta") {
    // Układ 1:1 z projektu Main.dc.html: nagłówek, pas wskaźników na całą
    // szerokość, dwie kolumny (440 px + reszta) z marginesem 48 px.
    return (
      <div style={CARD_CSS_VARS} className="-mx-4 -mt-6 flex flex-col bg-[#FDFBF8] text-[13px] leading-[1.45] tabular-nums text-[#3A3A3A] md:-mx-[30px] md:-mt-[26px]">
        {d.archive && (
          <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 border-l-[3px] border-[#E08A5C] bg-[#FBF0E7] px-4 py-2 text-[13px] text-[#B8612F] md:mx-7">
            <b className="font-semibold">W archiwum</b>
            <span>
              {d.archive.reason ? ARCHIVE_REASON_LABEL[d.archive.reason as ArchiveReasonKey] ?? d.archive.reason : ""}
              {d.archive.note ? ` — ${d.archive.note}` : ""} · od {new Date(d.archive.at).toLocaleDateString("pl-PL")}
            </span>
            {isAdmin && (
              <button
                type="button"
                className="ml-auto font-semibold underline"
                onClick={async () => {
                  const { ok, data } = await api("/api/porzadki/archiwum/przywroc", "POST", { type: "client", ids: [d.id] });
                  if (!ok) return notify(data.message ?? "Nie udało się przywrócić.", true);
                  notify("Przywrócono z archiwum.");
                  void reload();
                }}
              >
                Przywróć
              </button>
            )}
          </div>
        )}
        <CardHeader d={d} backHref={backHref} isAgent={isAgent} onSms={() => setSms((v) => !v)} onTask={() => setTask({ title: "", due: null })} />
        {(sms || splitTo || toastEl) && (
          <div className="flex flex-col gap-3 px-4 pb-4 md:px-7">
            {sms && (
              <div className="max-w-[560px]">
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
            {splitTo && (
              <p className="bg-[#EAF4FB] px-3 py-2 text-[13px] text-[#1B6FA8]">
                Nowy klient z wydzielonych osób:{" "}
                <Link href={`/klienci/${splitTo}`} className="font-semibold underline">
                  otwórz kartę →
                </Link>
              </p>
            )}
            {toastEl}
          </div>
        )}
        <Indicators d={d} />
        {/* Dwie kolumny; drugi rząd: Warunki handlowe (lewa) na równi z
            Fakturami i płatnościami (prawa), pod nimi Jakość danych. */}
        <div className="flex flex-col gap-7 px-4 pb-10 pt-5 md:px-7 xl:grid xl:grid-cols-[470px_minmax(0,1fr)] xl:items-start xl:gap-x-7 xl:gap-y-6">
          <CardLeft d={d} onChanged={setD} notify={notify} isAdmin={isAdmin} isAgent={isAgent} pendingProposals={pendingProposals} onDialog={setDialog} />
          <CardRight
            d={d}
            onChanged={setD}
            notify={notify}
            onOpenItem={openItem}
            onTab={switchTab}
            top={<NextStepBanner d={d} onChanged={setD} notify={notify} onTask={(title, due) => setTask({ title, due })} />}
          />
          <div className="flex xl:self-stretch [&>*]:w-full">
            <Tile>
              <TermsSection d={d} onChanged={setD} notify={notify} />
            </Tile>
          </div>
          <div className="flex min-w-0 xl:self-stretch [&>*]:w-full">
            <InvoicesSection d={d} onShowAll={() => switchTab("transakcje")} onChanged={setD} notify={notify} />
          </div>
          <div className="min-w-0 xl:col-start-2">
            <QualitySection d={d} onShowData={() => switchTab("dane")} />
          </div>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      {/* Nagłówek */}
      <div className="-mx-4 -mt-6 border-b border-[var(--c-border)] bg-white px-4 pt-5 md:-mx-[30px] md:-mt-[26px] md:px-[30px]">
        <button type="button" onClick={() => switchTab("karta")} className="text-[12px] font-medium text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
          ← Karta klienta
        </button>
        {d.archive && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[12px] text-[var(--c-red)]">
            <b className="font-semibold">W archiwum</b>
            <span>
              {d.archive.reason ? ARCHIVE_REASON_LABEL[d.archive.reason as ArchiveReasonKey] ?? d.archive.reason : ""}
              {d.archive.note ? ` — ${d.archive.note}` : ""} · od {new Date(d.archive.at).toLocaleDateString("pl-PL")}
            </span>
            {isAdmin && (
              <button
                type="button"
                className="ml-auto font-semibold underline"
                onClick={async () => {
                  const { ok, data } = await api("/api/porzadki/archiwum/przywroc", "POST", { type: "client", ids: [d.id] });
                  if (!ok) return notify(data.message ?? "Nie udało się przywrócić.", true);
                  notify("Przywrócono z archiwum.");
                  void reload();
                }}
              >
                Przywróć
              </button>
            )}
          </div>
        )}
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
              {pendingProposals > 0 && (
                <Link
                  href={`/propozycje?klient=${d.id}`}
                  className="rounded-full bg-[var(--c-purple-soft)] px-2.5 py-[3px] text-xs font-semibold text-[var(--c-purple-deep)] hover:underline"
                >
                  {pendingProposals} {pendingProposals === 1 ? "propozycja zmian" : "propozycje zmian"} do akceptacji
                </Link>
              )}
              {overdue > 0 && (
                <span className="rounded-full bg-[var(--c-red-soft)] px-2.5 py-[3px] text-xs font-semibold text-[var(--c-red)]">
                  {overdue} {overdue === 1 ? "faktura" : "faktury"} po terminie
                </span>
              )}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--c-muted)]">
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
            {!isAgent && !d.archive && (
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
            {!d.archive && (
              <button type="button" onClick={() => setDialog("merge")} className={soft} title="Połącz z duplikatem tego klienta">
                Scal duplikat
              </button>
            )}
            {!isAgent && !d.archive && d.contacts.length > 1 && (
              <button type="button" onClick={() => setDialog("split")} className={soft} title="Część osób to inny gabinet — wydziel je do nowego klienta">
                Wydziel osoby
              </button>
            )}
            {isAdmin && !d.archive && (
              <button type="button" onClick={() => setDialog("archive")} className={`${btn} text-[var(--c-muted)] hover:bg-[var(--c-red-soft)] hover:text-[var(--c-red)]`}>
                Archiwizuj
              </button>
            )}
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
                className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-[3px] px-4 pb-3 pt-1 text-[13px] transition-colors ${
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
        {splitTo && (
          <p className="mb-4 rounded-lg bg-[var(--c-brand-soft)] px-3 py-2 text-[12px] text-[var(--c-brand-deep)]">
            Nowy klient z wydzielonych osób:{" "}
            <Link href={`/klienci/${splitTo}`} className="font-semibold underline">
              otwórz kartę →
            </Link>
          </p>
        )}
        {toastEl && <div className="mb-4">{toastEl}</div>}
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

      {dialogs}
    </div>
  );
}
