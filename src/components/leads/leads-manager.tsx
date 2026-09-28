"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { LeadRow } from "@/lib/leads/load";
import { LOST_REASON_LABEL, STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey } from "@/lib/leads/parse-deal";
import type { ReviewClient } from "@/lib/history/review-load";
import { api } from "@/components/clients/client-forms";
import { fmtDate } from "@/components/clients/ui";
import { useMediaQuery } from "@/components/clients/use-media-query";
import { LeadCard, type CardIntent } from "./lead-card";
import { toFunnel, type LinkSuggestion } from "./funnel-views";
import { Cheatsheet } from "./cheatsheet";
import { SignalsTour } from "./signals-tour";
import { seasonReservations } from "@/lib/leads/playbook";
import type { Playbook } from "@/lib/leads/playbook";
import type { DayProgress } from "@/lib/leads/load";
import { applySmsPlaceholders } from "@/lib/sms-template";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";
import { ReportView } from "./report-view";
import { callQueue } from "@/lib/leads/funnel";
import { LostDialog, NewLeadDialog } from "./lead-dialogs";
import { RefreshIcon, fmtRange } from "./lead-ui";

// Sygnały (/sygnaly) — wygląd wg docs/crm/mockup-sygnaly.html, logika wg
// docs/crm/prompt-claude-code-crm-2-sygnaly.md (sekcja 3). Sygnałów jest
// kilkaset, więc filtrowanie i widoki liczą się w przeglądarce. Karta: prawa
// kolumna od 1280 px, poniżej panel wysuwany.

// Lejek v2 (zmiana 28.09 — bez osobnej Skrzynki): Lista (domyślna, filtr
// „Na dziś” z Planem dnia) · Tablica · Raport. „Dzwoń po kolei” w „Na dziś”.
type View = "list" | "board" | "report";
const VIEW_LABEL: Record<View, string> = { list: "Lista", board: "Tablica", report: "Raport" };


function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: LeadRow[]) {
  const header = ["Sygnał", "Etap", "Typ", "Klient", "Osoba", "Telefon", "E-mail", "Urządzenia", "Termin", "Wpłynęło", "Następny krok", "Powód przegranej", "Prowadzi"];
  const lines = rows.map((r) =>
    [
      r.title,
      STAGE_LABEL[r.stage],
      TYPE_LABEL[r.type],
      r.clientName,
      r.person,
      r.phone,
      r.email,
      r.devices.map((d) => LEAD_DEVICE_LABEL[d]).join(", "),
      r.requestedFrom ? fmtRange(r.requestedFrom, r.requestedDays) : "",
      fmtDate(r.createdAt),
      r.nextActionAt ? fmtDate(r.nextActionAt) : "",
      r.lostReason ? LOST_REASON_LABEL[r.lostReason] : "",
      r.ownerName,
    ]
      .map(csvCell)
      .join(";"),
  );
  const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sygnaly-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// „przed chwilą” / „12 min temu” / „3 h temu” — ostatnie pobranie z HubSpota.
function syncAgo(iso: string, now: Date) {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h temu`;
  return fmtDate(iso);
}


export function LeadsManager({
  rows,
  users,
  currentUserId,
  isAdmin,
  readOnly = false,
  lastSync,
  linkSuggestions,
  callStats,
  archivedRows,
  hubspotConfigured,
  clients,
  initialSelectedId,
  playbook,
  progress,
  tour,
}: {
  rows: LeadRow[];
  users: { id: string; name: string }[];
  currentUserId: string;
  isAdmin: boolean;
  // Rola AGENT: podgląd sygnałów, notatki, zadania i „Przenieś do klientów”;
  // bez nowych sygnałów, pobierania, zmian etapu i dzwonienia (API tak samo).
  readOnly?: boolean;
  lastSync: string | null;
  // „Rezerwacje do spięcia” — podpowiedź wynajmu dla sygnału bez wynajmu.
  linkSuggestions: Record<string, LinkSuggestion>;
  callStats: { talked: number; noAnswer: number };
  // Tablica → „Archiwum 2025”.
  archivedRows: LeadRow[];
  hubspotConfigured: boolean;
  clients: ReviewClient[];
  initialSelectedId: string | null;
  // Złote zasady (Ściąga, podpowiedzi w karcie, cel sezonu).
  playbook: Playbook;
  // Skrzynka → „Plan dnia”: dzisiejsze wynajmy, obsłużone dziś, tydzień.
  progress: DayProgress;
  // Przewodnik po nowych Sygnałach (wniosek 19): czy pokazać i imię (wołacz).
  tour: { show: boolean; name: string };
}) {
  const router = useRouter();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [intent, setIntent] = useState<CardIntent>(null);
  const [showNew, setShowNew] = useState<false | "new" | "mail">(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Tablica
  const [lostIds, setLostIds] = useState<string[] | null>(null);
  // Do obdzwonienia — filtry i tryb seryjny (po wyniku rozmowy karta
  // przechodzi do następnego kontaktu z listy).
  const [serial, setSerial] = useState(false);
  const [serialDone, setSerialDone] = useState<Set<string>>(new Set());
  // Optymistyczne etapy po przeciągnięciu — ważne tylko dla tej wersji
  // danych; po odświeżeniu (nowe `rows`) liczy się już stan z serwera.
  const [movedState, setMovedState] = useState<{ base: LeadRow[]; map: Map<string, LeadStageKey> }>({ base: rows, map: new Map() });
  const moved = useMemo(() => (movedState.base === rows ? movedState.map : new Map<string, LeadStageKey>()), [movedState, rows]);

  const refresh = useCallback(() => router.refresh(), [router]);

  // Nowe sygnały z crona (co 5 min) pojawiają się bez przeładowania strony.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      if (document.visibilityState === "visible") refresh();
    }, 120_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Escape zamyka kartę — chyba że otwarte jest okno (przegrana, nowy sygnał).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-lead-modal]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const list = useMemo(() => rows.map((r) => (moved.has(r.id) ? { ...r, stage: moved.get(r.id)! } : r)), [rows, moved]);

  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);

  // „Do obdzwonienia” — kolejka liczona na bieżąco (lejek, L1); tryb seryjny
  // po wyniku kontaktu otwiera następny kontakt z kolejki.
  const visibleCalls = useMemo(() => callQueue(toFunnel(list), now).map((f) => byId.get(f.id)!).filter(Boolean), [list, now, byId]);

  function nextCall(afterId: string | null): LeadRow | null {
    const done = new Set(serialDone);
    if (afterId) done.add(afterId);
    const i = afterId ? visibleCalls.findIndex((r) => r.id === afterId) : -1;
    const rest = [...visibleCalls.slice(i + 1), ...visibleCalls.slice(0, Math.max(i, 0))];
    return rest.find((r) => !done.has(r.id)) ?? null;
  }

  function onOutcome() {
    if (!serial || !selectedId) return;
    const current = selectedId;
    setSerialDone((d) => new Set(d).add(current));
    const next = nextCall(current);
    if (next) open(next.id, "call");
    else {
      setSerial(false);
      close();
      setToast({ text: "Koniec listy w tej sesji — obdzwoniono wszystkie widoczne kontakty." });
    }
  }

  const [sheet, setSheet] = useState(false);
  const [tourOpen, setTourOpen] = useState(tour.show);
  async function tourDone(action: "later" | "done") {
    setTourOpen(false);
    await api("/api/me/tour", "POST", { tour: "signalsV2", action });
  }

  function open(id: string, i: CardIntent = null) {
    setSheet(false);
    setSelectedId(id);
    setIntent(i);
    const url = new URL(window.location.href);
    url.searchParams.set("id", id);
    window.history.replaceState(null, "", url.toString());
  }
  function close() {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    window.history.replaceState(null, "", url.toString());
  }

  async function pull() {
    setSyncing(true);
    let created = 0;
    let notes = 0;
    for (let i = 0; i < 10; i++) {
      const { ok, data } = await api<{ created: number; remaining: number; notesAdded: number; notesError: string | null }>("/api/leads/pull", "POST");
      if (!ok) {
        setSyncing(false);
        return setToast({ text: data.message ?? "Nie udało się pobrać z HubSpota.", error: true });
      }
      created += data.created;
      notes += data.notesAdded;
      if (data.remaining === 0) break;
    }
    setSyncing(false);
    setToast({ text: created || notes ? `Pobrano: ${created} nowych sygnałów${notes ? `, ${notes} notatek` : ""}.` : "Brak nowych sygnałów w HubSpocie." });
    refresh();
  }

  async function moveTo(id: string, stage: LeadStageKey) {
    const r = byId.get(id);
    if (!r || r.stage === stage) return;
    setMovedState({ base: rows, map: new Map(moved).set(id, stage) });
    const { ok, data } = await api(`/api/leads/${id}`, "PATCH", { stage });
    if (!ok) {
      setMovedState({ base: rows, map: new Map([...moved].filter(([k]) => k !== id)) });
      return setToast({ text: data.message ?? "Nie udało się zmienić etapu.", error: true });
    }
    setToast({ text: `${r.title}: ${STAGE_LABEL[stage]}.` });
    refresh();
  }

  // Skrzynka: wynik kontaktu jednym kliknięciem (Rozmawiałam / Nie odebrała).
  async function quickOutcome(id: string, outcome: "talked" | "no_answer" | "offer_sent") {
    const r = byId.get(id);
    const { ok, data } = await api(`/api/leads/${id}/activity`, "POST", { outcome });
    if (!ok) return setToast({ text: data.message ?? "Nie udało się zapisać.", error: true });
    // Złote zasady, pkt 2: nie odebrała → SMS z szablonu od razu.
    let smsNote = "";
    if (outcome === "no_answer" && r?.phone) {
      const tpl = await noAnswerTemplate();
      if (tpl) {
        const sms = await api(`/api/leads/${id}/sms`, "POST", { phone: r.phone, message: applySmsPlaceholders(tpl, { clientName: r.clientName ?? r.person }) });
        smsNote = sms.ok ? " SMS z szablonu wysłany." : ` SMS nie poszedł: ${sms.data.message ?? "błąd bramki"}.`;
      }
    }
    const msg =
      outcome === "talked"
        ? "rozmowa zapisana → W kontakcie, krok za 2 dni rob. (zmienisz w karcie)"
        : outcome === "offer_sent"
          ? "oferta wysłana → follow-up za 3 dni rob."
          : "nie odebrała → kolejna próba jutro";
    setToast({ text: `${r ? r.title : "Sygnał"}: ${msg}.${smsNote}` });
    refresh();
  }

  // Szablon „lead_no_answer” (Ustawienia → Szablony SMS) — pobrany raz.
  const [tplCache, setTplCache] = useState<string | null | undefined>(undefined);
  async function noAnswerTemplate(): Promise<string | null> {
    if (tplCache !== undefined) return tplCache;
    const { ok, data } = await api<{ templates: { key: string; body: string }[] }>("/api/message-templates", "GET");
    const body = ok ? (data.templates.find((t) => t.key === "lead_no_answer")?.body ?? null) : null;
    setTplCache(body);
    return body;
  }

  function startSerial() {
    const first = visibleCalls[0];
    if (!first) return setToast({ text: "Nikogo do obdzwonienia teraz — nowe i telefony na dziś są zrobione." });
    setSerialDone(new Set());
    setSerial(true);
    open(first.id, "call");
  }

  async function linkRental(leadId: string, rentalId: string) {
    const { ok, data } = await api(`/api/leads/${leadId}`, "PATCH", { rentalId });
    if (!ok) return setToast({ text: data.message ?? "Nie udało się powiązać.", error: true });
    setToast({ text: "Powiązano z wynajmem." });
    refresh();
  }

  async function markLost(ids: string[], v: { lostReason: string; lostNote: string; returnAt: string }): Promise<string | null> {
    const body = { stage: "PRZEGRANA", lostReason: v.lostReason, lostNote: v.lostNote, returnAt: v.returnAt || null };
    const { ok, data } =
      ids.length === 1 ? await api(`/api/leads/${ids[0]}`, "PATCH", body) : await api<{ updated: number }>("/api/leads/bulk", "POST", { ids, patch: body });
    if (!ok) return data.message ?? "Nie udało się zapisać.";
    setLostIds(null);
    setToast({ text: ids.length === 1 ? "Oznaczono jako przegraną." : `Zamknięto ${ids.length} sygnałów.` });
    refresh();
    return null;
  }

  const card = selectedId ? (
    <LeadCard
      key={`${selectedId}:${intent === "postpone" ? "p" : ""}`}
      leadId={selectedId}
      users={users}
      intent={intent}
      onClose={() => {
        setSerial(false);
        close();
      }}
      onChanged={refresh}
      onOutcome={onOutcome}
      agent={readOnly}
      canArchive={isAdmin}
      playbook={playbook}
    />
  ) : null;
  // Prawa kolumna: Ściąga albo karta sygnału.
  const side = sheet ? (
    <Cheatsheet
      playbook={playbook}
      onClose={() => setSheet(false)}
      onStartTour={
        readOnly
          ? undefined
          : () => {
              setSheet(false);
              setView("list");
              setTourOpen(true);
            }
      }
    />
  ) : (
    card
  );

  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      <div className={wide && side ? `grid ${sheet ? "grid-cols-[minmax(0,1fr)_480px]" : "grid-cols-[minmax(0,1fr)_420px]"} gap-5` : ""}>
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Nagłówek */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-[26px] font-semibold text-[var(--c-navy)]">Sygnały</h1>
            <div role="tablist" aria-label="Widok" className="flex gap-1 rounded-[10px] bg-[var(--c-bg)] p-1">
              {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  data-tour={v === "board" ? "tab-board" : undefined}
                  className={`h-8 rounded-lg px-3.5 text-sm transition-colors ${
                    view === v ? "bg-white font-semibold text-[var(--c-brand-deep)] shadow-[0_1px_2px_rgba(12,52,80,0.1)]" : "text-[var(--c-sidebar-text)] hover:text-[var(--c-text)]"
                  }`}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            <div className="flex-grow" />
            <button
              type="button"
              onClick={() => setSheet((v) => !v)}
              aria-pressed={sheet}
              data-tour="cheatsheet"
              className={`h-[34px] rounded-lg border px-3 text-[13px] transition-colors ${sheet ? "border-[#0C3450] bg-[#0C3450] text-white" : "border-[#C9D3DC] bg-white text-[#0C3450] hover:border-[var(--c-brand)]"}`}
              title="Złote zasady obsługi zapytań"
            >
              📖 Ściąga
            </button>
            {hubspotConfigured && !readOnly && (
              <button
                type="button"
                onClick={() => void pull()}
                disabled={syncing}
                className="flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] text-[var(--c-muted)] transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-50"
                title="Pobiera nowe sygnały i notatki z HubSpota (robi to też automatycznie co 5 minut)"
              >
                <RefreshIcon className={syncing ? "animate-spin" : ""} />
                {syncing ? "Pobieranie…" : lastSync ? `HubSpot · ${syncAgo(lastSync, now)}` : "Pobierz z HubSpota"}
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setShowNew("new")}
                className="h-[34px] rounded-lg border border-[#C9D3DC] bg-white px-3 text-[13px] text-[#0C3450] transition-colors hover:border-[var(--c-brand)]"
              >
                + Szybki sygnał (telefon)
              </button>
            )}
            {!readOnly && (
              <button type="button" onClick={() => setShowNew("mail")} className="h-[34px] rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)]">
                + Sygnał
              </button>
            )}
          </div>

          {toast && (
            <p role="status" className={`rounded-lg px-3 py-2 text-[13px] ${toast.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}>
              {toast.text}
            </p>
          )}

          {rows.length === 0 ? (
            <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center">
              <p className="text-[15px] font-semibold text-[var(--c-navy)]">Nie ma jeszcze sygnałów</p>
              <p className="mt-1 text-sm text-[var(--c-muted)]">
                {isAdmin ? (
                  <>
                    Zaimportuj transakcje z HubSpota w{" "}
                    <Link href="/ustawienia/integracje/hubspot" className="text-[var(--c-brand-deep)] underline">
                      Ustawienia → Integracje → HubSpot
                    </Link>{" "}
                    albo dodaj pierwszy sygnał ręcznie.
                  </>
                ) : (
                  "Administrator uruchamia import z HubSpota; możesz też dodać sygnał ręcznie."
                )}
              </p>
            </div>
          ) : (
            <>
              {view === "board" && (
                <BoardView
                  rows={list}
                  archived={archivedRows}
                  users={users}
                  now={now}
                  selectedId={selectedId}
                  readOnly={readOnly}
                  onOpen={(id) => open(id)}
                  onMove={(id, stage) => void moveTo(id, stage)}
                  onLost={(id) => setLostIds([id])}
                  onQuick={quickOutcome}
                  onPostpone={(id) => open(id, "postpone")}
                  canArchive2025={isAdmin}
                />
              )}

              {view === "report" && <ReportView rows={list} now={now} />}

              {view === "list" && (
                <ListView
                  rows={list}
                  archived={archivedRows}
                  users={users}
                  now={now}
                  selectedId={selectedId}
                  onOpen={(id, i) => open(id, i ?? null)}
                  onExport={exportCsv}
                  currentUserId={currentUserId}
                  readOnly={readOnly}
                  progress={progress}
                  playbook={playbook}
                  suggestions={linkSuggestions}
                  callStats={callStats}
                  onQuick={quickOutcome}
                  onLost={(id) => setLostIds([id])}
                  onLink={(leadId, rentalId) => void linkRental(leadId, rentalId)}
                  onSerial={startSerial}
                />
              )}
            </>
          )}
        </div>

        {/* Karta sygnału / Ściąga: kolumna (≥1280 px) albo panel wysuwany */}
        {side &&
          (wide ? (
            <aside aria-label={sheet ? "Ściąga" : "Karta sygnału"} className="sticky top-4 h-[calc(100vh-110px)] overflow-hidden rounded-[14px] border border-[var(--c-border)]">
              {side}
            </aside>
          ) : (
            <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={sheet ? "Ściąga" : "Karta sygnału"}>
              <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/25" onClick={() => (sheet ? setSheet(false) : close())} />
              <div className="relative h-full w-full max-w-[480px] shadow-[0_0_40px_rgba(0,0,0,0.2)]">{side}</div>
            </div>
          ))}
      </div>

      {tourOpen && !readOnly && (
        <SignalsTour
          name={tour.name}
          season={seasonReservations(toFunnel(rows), playbook.season)}
          target={playbook.season.target}
          reward={playbook.season.reward}
          onFinish={() => void tourDone("done")}
          onLater={() => void tourDone("later")}
          onBeforeStep={() => {
            if (view !== "list") setView("list");
            if (selectedId) close();
            setSheet(false);
          }}
        />
      )}

      {showNew && (
        <NewLeadDialog
          clients={clients}
          initialType={showNew === "mail" ? "EMAIL" : "TELEFON"}
          title={showNew === "mail" ? "Nowy sygnał (mail, OLX, polecenie…)" : "Szybki sygnał z telefonu"}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            refresh();
            open(id);
          }}
        />
      )}
      {lostIds && <LostDialog count={lostIds.length} onClose={() => setLostIds(null)} onSubmit={(v) => markLost(lostIds, v)} />}
    </div>
  );
}
