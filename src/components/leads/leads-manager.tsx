"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_CSS_VARS, LEAD_STAGE_COLORS } from "@/components/shell-tokens";
import type { LeadRow } from "@/lib/leads/load";
import type { LeadStats } from "@/lib/leads/today";
import { buildToday } from "@/lib/leads/today";
import { BOARD_STAGES, LOST_REASON_LABEL, STAGE_KEYS, STAGE_LABEL, TYPE_KEYS, TYPE_LABEL } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey, type LeadTypeKey } from "@/lib/leads/parse-deal";
import { DEVICE_INTEREST_KEYS, formatPhone, type DeviceInterestKey } from "@/lib/clients/labels";
import type { ReviewClient } from "@/lib/history/review-load";
import { api } from "@/components/clients/client-forms";
import { DownloadIcon, PhoneIcon, SearchIcon, StatusChip, fmtAgo, fmtDate } from "@/components/clients/ui";
import { useMediaQuery } from "@/components/clients/use-media-query";
import { LeadCard, type CardIntent } from "./lead-card";
import { BTN, LostDialog, NewLeadDialog } from "./lead-dialogs";
import { DevicePill, OwnerAvatar, RefreshIcon, StageChip, TypeTag, Waiting, fmtRange, isUrgent } from "./lead-ui";

// Sygnały (/sygnaly) — wygląd wg docs/crm/mockup-sygnaly.html, logika wg
// docs/crm/prompt-claude-code-crm-2-sygnaly.md (sekcja 3). Sygnałów jest
// kilkaset, więc filtrowanie i widoki liczą się w przeglądarce. Karta: prawa
// kolumna od 1280 px, poniżej panel wysuwany.

type View = "today" | "board" | "list";
const VIEW_LABEL: Record<View, string> = { today: "Na dziś", board: "Tablica", list: "Lista" };

const RETURNING = new Set(["STALY", "USPIONY"]);

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

function daysIn(iso: string, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

function StatTile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-3">
      <div className="text-[13px] text-[var(--c-muted)]">{label}</div>
      <div className={`font-semibold text-[var(--c-navy)] tabular-nums ${small ? "pt-1 text-lg" : "text-[24px]"}`}>{value}</div>
    </div>
  );
}

// Wiersz widoku „Na dziś” — cały klikalny (otwiera kartę), z akcją po prawej.
function TodayRow({
  r,
  bar,
  right,
  actions,
  selected,
  onOpen,
}: {
  r: LeadRow;
  bar?: string;
  right?: React.ReactNode;
  actions: React.ReactNode;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`flex cursor-pointer flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border bg-white px-4 py-3 transition-colors hover:border-[var(--c-brand)] ${
        selected ? "border-[var(--c-brand)]" : "border-[var(--c-border)]"
      }`}
      style={bar ? { boxShadow: `inset 3px 0 0 ${bar}` } : undefined}
    >
      <div className="min-w-0 flex-grow basis-[260px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[15px] font-semibold text-[var(--c-navy)]">{r.title}</span>
          {r.clientStatus && RETURNING.has(r.clientStatus) && (
            <span className="rounded-md bg-[var(--c-green-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]">Powracająca klientka</span>
          )}
          {r.clientStatus === "NIE_KONTAKTOWAC" && <StatusChip status="NIE_KONTAKTOWAC" />}
          <TypeTag type={r.type} />
          <DevicePill devices={r.devices} from={r.requestedFrom} days={r.requestedDays} />
        </div>
        <div className="mt-0.5 truncate text-[13px] text-[var(--c-muted)]">
          {[r.clientName && r.clientName !== r.title ? r.clientName : null, r.person, r.city, r.phone ? formatPhone(r.phone) : null].filter(Boolean).join(" · ")}
          {r.message && <span className="text-[var(--c-sidebar-text)]"> · „{r.message.slice(0, 90)}{r.message.length > 90 ? "…" : ""}”</span>}
        </div>
      </div>
      {right}
      <div className="flex flex-none gap-1.5" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  );
}

function CallButton({ r, onCall }: { r: LeadRow; onCall: () => void }) {
  const cls = "flex h-9 items-center gap-1.5 rounded-lg bg-[var(--c-brand)] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)]";
  return r.phone ? (
    <a href={`tel:${r.phone}`} onClick={onCall} className={cls}>
      <PhoneIcon size={14} />
      Zadzwoń
    </a>
  ) : (
    <button type="button" onClick={onCall} className={cls} title="Brak telefonu — otwórz kartę">
      Otwórz
    </button>
  );
}

function SectionTitle({ children, count, tone }: { children: React.ReactNode; count?: number; tone?: string }) {
  return (
    <h2 className="m-0 mt-2 flex items-center gap-2 text-[15px] font-semibold text-[var(--c-navy)] first:mt-0">
      {children}
      {count !== undefined && count > 0 && (
        <span className="rounded-full px-2 text-xs font-semibold text-white" style={{ background: tone ?? "var(--c-accent)" }}>
          {count}
        </span>
      )}
    </h2>
  );
}

export function LeadsManager({
  rows,
  users,
  currentUserId,
  isAdmin,
  stats,
  lastSync,
  hubspotConfigured,
  clients,
  initialSelectedId,
}: {
  rows: LeadRow[];
  users: { id: string; name: string }[];
  currentUserId: string;
  isAdmin: boolean;
  stats: LeadStats;
  lastSync: string | null;
  hubspotConfigured: boolean;
  clients: ReviewClient[];
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [view, setView] = useState<View>("today");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [intent, setIntent] = useState<CardIntent>(null);
  const [showNew, setShowNew] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Tablica
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<LeadStageKey | "LOST" | null>(null);
  const [lostIds, setLostIds] = useState<string[] | null>(null);
  // Zaległe
  const [staleSel, setStaleSel] = useState<Set<string>>(new Set());
  // Lista
  const [query, setQuery] = useState("");
  const [fStage, setFStage] = useState<LeadStageKey | "" | "OPEN">("OPEN");
  const [fType, setFType] = useState<LeadTypeKey | "">("");
  const [fDevice, setFDevice] = useState<DeviceInterestKey | "">("");
  const [fOwner, setFOwner] = useState("");
  const [fNoClient, setFNoClient] = useState(false);
  const [fSource, setFSource] = useState<"" | "hubspot" | "panel">("");
  const [limit, setLimit] = useState(60);
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

  const today = useMemo(
    () =>
      buildToday(
        list.map((r) => ({
          ...r,
          createdAt: new Date(r.createdAt),
          firstContactAt: r.firstContactAt ? new Date(r.firstContactAt) : null,
          nextActionAt: r.nextActionAt ? new Date(r.nextActionAt) : null,
          rentalStartsAt: r.rentalStartsAt ? new Date(r.rentalStartsAt) : null,
        })),
        now,
      ),
    [list, now],
  );
  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);
  const back = (xs: { id: string }[]) => xs.map((x) => byId.get(x.id)!).filter(Boolean);

  function open(id: string, i: CardIntent = null) {
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

  async function markLost(ids: string[], v: { lostReason: string; lostNote: string; returnAt: string }): Promise<string | null> {
    const body = { stage: "PRZEGRANA", lostReason: v.lostReason, lostNote: v.lostNote, returnAt: v.returnAt || null };
    const { ok, data } =
      ids.length === 1 ? await api(`/api/leads/${ids[0]}`, "PATCH", body) : await api<{ updated: number }>("/api/leads/bulk", "POST", { ids, patch: body });
    if (!ok) return data.message ?? "Nie udało się zapisać.";
    setLostIds(null);
    setStaleSel(new Set());
    setToast({ text: ids.length === 1 ? "Oznaczono jako przegraną." : `Zamknięto ${ids.length} sygnałów.` });
    refresh();
    return null;
  }

  // Lista — filtry lokalnie.
  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    return list.filter((r) => {
      if (fStage === "OPEN" ? !BOARD_STAGES.includes(r.stage) : fStage && r.stage !== fStage) return false;
      if (fType && r.type !== fType) return false;
      if (fDevice && !r.devices.includes(fDevice)) return false;
      if (fOwner && r.ownerId !== (fOwner === "none" ? null : fOwner)) return false;
      if (fNoClient && r.clientId) return false;
      if (fSource === "hubspot" && !r.fromHubspot) return false;
      if (fSource === "panel" && r.fromHubspot) return false;
      if (s.length >= 2 && !r.search.includes(s) && !(digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits))) return false;
      return true;
    });
  }, [list, query, fStage, fType, fDevice, fOwner, fNoClient, fSource]);

  const since30 = now.getTime() - 30 * 86_400_000;
  const won30 = list.filter((r) => r.stage === "WYGRANA" && new Date(r.stageChangedAt).getTime() >= since30).length;
  const lost30 = list.filter((r) => r.stage === "PRZEGRANA" && new Date(r.stageChangedAt).getTime() >= since30).length;
  const nothingToday = today.fresh.length + today.followUps.length + today.reservations.length === 0;

  const card = selectedId ? (
    <LeadCard key={selectedId} leadId={selectedId} users={users} intent={intent} onClose={close} onChanged={refresh} />
  ) : null;

  const selectCls = (on: boolean) =>
    `h-8 cursor-pointer rounded-full border px-2.5 text-xs transition-colors hover:border-[var(--c-brand)] focus:border-[var(--c-brand)] focus:outline-none ${
      on ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white text-[var(--c-text)]"
    }`;

  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      <div className={wide && selectedId ? "grid grid-cols-[minmax(0,1fr)_420px] gap-5" : ""}>
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
                  className={`h-8 rounded-lg px-3.5 text-sm transition-colors ${
                    view === v ? "bg-white font-semibold text-[var(--c-brand-deep)] shadow-[0_1px_2px_rgba(12,52,80,0.1)]" : "text-[var(--c-sidebar-text)] hover:text-[var(--c-text)]"
                  }`}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            <div className="flex-grow" />
            {hubspotConfigured && (
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
            <button type="button" onClick={() => setShowNew(true)} className="h-[34px] rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)]">
              + Nowy sygnał
            </button>
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
              {/* Podsumowanie 30 dni */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                <StatTile label="Nowe sygnały · 30 dni" value={String(stats.newCount)} />
                <StatTile
                  label="Czas do pierwszego kontaktu (mediana)"
                  value={stats.medianFirstContactHours == null ? "—" : `${stats.medianFirstContactHours.toLocaleString("pl-PL")} h rob.`}
                />
                <StatTile label="Doszło do rezerwacji" value={stats.reservationRate == null ? "—" : `${Math.round(stats.reservationRate * 100)}%`} />
                <StatTile
                  label="Najczęstszy powód przegranej"
                  value={stats.topLostReason ? `${LOST_REASON_LABEL[stats.topLostReason as keyof typeof LOST_REASON_LABEL] ?? stats.topLostReason} (${stats.topLostCount})` : "—"}
                  small
                />
              </div>

              {view === "today" && (
                <section aria-label="Na dziś" className="flex flex-col gap-2.5">
                  {nothingToday && (
                    <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-8 text-center">
                      <p className="text-[15px] font-semibold text-[var(--c-green-deep)]">Wszystko obsłużone 🎉</p>
                      <p className="mt-1 text-sm text-[var(--c-muted)]">Nie ma nowych sygnałów ani zaplanowanych kroków na dziś.</p>
                    </div>
                  )}

                  {today.fresh.length > 0 && <SectionTitle count={today.fresh.length}>Nowe — czekają na pierwszy kontakt</SectionTitle>}
                  {back(today.fresh).map((r) => (
                    <TodayRow
                      key={r.id}
                      r={r}
                      selected={selectedId === r.id}
                      onOpen={() => open(r.id)}
                      bar={isUrgent(r.createdAt, now) ? "var(--c-red)" : "var(--c-brand)"}
                      right={<Waiting since={r.createdAt} now={now} />}
                      actions={<CallButton r={r} onCall={() => open(r.id, "call")} />}
                    />
                  ))}

                  {today.followUps.length > 0 && <SectionTitle count={today.followUps.length} tone="var(--c-brand)">Follow-up na dziś</SectionTitle>}
                  {back(today.followUps).map((r) => {
                    const noAnswer = r.lastActivity?.type === "CALL_NO_ANSWER";
                    const overdue = r.nextActionAt && new Date(r.nextActionAt) < new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    return (
                      <TodayRow
                        key={r.id}
                        r={r}
                        selected={selectedId === r.id}
                        onOpen={() => open(r.id)}
                        bar={overdue ? "var(--c-accent)" : undefined}
                        right={
                          <div className="flex flex-col items-end gap-1 text-right">
                            {noAnswer ? (
                              <span className="rounded-md bg-[var(--c-purple-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-purple-deep)]">
                                Nie odebrała {fmtAgo(r.lastActivity!.at, now)}
                                {r.noAnswerCount > 1 ? ` · ${r.noAnswerCount}. próba` : ""}
                              </span>
                            ) : (
                              <StageChip stage={r.stage} suffix={r.stage === "OFERTA" ? fmtDate(r.stageChangedAt).slice(0, 5) : undefined} />
                            )}
                            {overdue && <span className="text-[11px] font-semibold text-[var(--c-accent-deep)]">zaległe od {fmtDate(r.nextActionAt!).slice(0, 5)}</span>}
                          </div>
                        }
                        actions={
                          <>
                            {r.phone && (
                              <button
                                type="button"
                                onClick={() => open(r.id, "sms")}
                                className="h-9 rounded-lg bg-[var(--c-brand-soft)] px-3 text-[13px] font-semibold text-[var(--c-brand-deep)] transition-colors hover:bg-[var(--c-navy-soft)]"
                              >
                                SMS
                              </button>
                            )}
                            <CallButton r={r} onCall={() => open(r.id, "call")} />
                          </>
                        }
                      />
                    );
                  })}

                  {today.reservations.length > 0 && (
                    <SectionTitle count={today.reservations.length} tone="var(--c-purple)">
                      Rezerwacje do potwierdzenia (3 dni)
                    </SectionTitle>
                  )}
                  {back(today.reservations).map((r) => (
                    <TodayRow
                      key={r.id}
                      r={r}
                      selected={selectedId === r.id}
                      onOpen={() => open(r.id)}
                      right={
                        <span className="whitespace-nowrap rounded-md bg-[var(--c-brand-soft)] px-[7px] py-0.5 text-[11px] text-[var(--c-brand-deep)]">
                          {r.rentalDevice} · {new Date(r.rentalStartsAt!).toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit" })}
                        </span>
                      }
                      actions={
                        <Link
                          href={`/kalendarz/wynajem/${r.rentalId}?from=/sygnaly`}
                          className="flex h-9 items-center rounded-lg bg-[var(--c-brand-soft)] px-3.5 text-[13px] font-semibold text-[var(--c-brand-deep)] transition-colors hover:bg-[var(--c-navy-soft)]"
                        >
                          Otwórz wynajem
                        </Link>
                      }
                    />
                  ))}

                  {today.stale.length > 0 && (
                    <details className="group mt-2 rounded-xl border border-[var(--c-border)] bg-white">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] [&::-webkit-details-marker]:hidden">
                        <span className="text-[10px] text-[var(--c-faint)] transition-transform group-open:rotate-90">▸</span>
                        <span className="font-semibold text-[var(--c-navy)]">Starsze bez kontaktu</span>
                        <span className="rounded-full bg-[var(--c-bg)] px-2 text-xs font-semibold text-[var(--c-muted)]">{today.stale.length}</span>
                        <span className="ml-1 text-xs text-[var(--c-muted)]">zaległość z HubSpota — przejrzyj, zadzwoń albo zamknij</span>
                      </summary>
                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--c-border)] px-4 py-2">
                        <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--c-muted)]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--c-brand)]"
                            checked={staleSel.size === today.stale.length}
                            onChange={(e) => setStaleSel(e.target.checked ? new Set(today.stale.map((l) => l.id)) : new Set())}
                          />
                          zaznacz wszystkie
                        </label>
                        {staleSel.size > 0 && (
                          <button type="button" className={`${BTN} ml-auto h-8`} onClick={() => setLostIds([...staleSel])}>
                            Zamknij zaznaczone ({staleSel.size}) jako przegrane…
                          </button>
                        )}
                      </div>
                      <ul className="max-h-[420px] overflow-y-auto">
                        {back(today.stale).map((r) => (
                          <li key={r.id} className="flex items-center gap-3 border-t border-[var(--c-border)] px-4 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Zaznacz ${r.title}`}
                              className="h-4 w-4 flex-none accent-[var(--c-brand)]"
                              checked={staleSel.has(r.id)}
                              onChange={(e) =>
                                setStaleSel((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(r.id);
                                  else n.delete(r.id);
                                  return n;
                                })
                              }
                            />
                            <button type="button" onClick={() => open(r.id)} className="min-w-0 flex-grow text-left">
                              <span className="block truncate text-[13px] font-semibold text-[var(--c-navy)]">{r.title}</span>
                              <span className="block truncate text-xs text-[var(--c-muted)]">
                                {TYPE_LABEL[r.type]} · {fmtDate(r.createdAt)}
                                {r.phone ? ` · ${formatPhone(r.phone)}` : ""}
                              </span>
                            </button>
                            {r.phone && (
                              <a href={`tel:${r.phone}`} onClick={() => open(r.id, "call")} className="flex-none text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                                Zadzwoń
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}

              {view === "board" && (
                <section aria-label="Tablica" className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {BOARD_STAGES.map((stage) => {
                      const col = list.filter((r) => r.stage === stage).sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt));
                      const c = LEAD_STAGE_COLORS[stage];
                      return (
                        <div
                          key={stage}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDropStage(stage);
                          }}
                          onDragLeave={() => setDropStage((s) => (s === stage ? null : s))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDropStage(null);
                            if (dragId) void moveTo(dragId, stage);
                          }}
                          className={`flex min-h-[200px] flex-col gap-2 rounded-xl border-2 p-2 transition-colors ${
                            dropStage === stage ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)]" : "border-transparent bg-[var(--c-bg)]"
                          }`}
                        >
                          <div className="flex items-center gap-2 px-1.5 pt-1 text-[13px] font-semibold text-[var(--c-navy)]">
                            <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
                            {STAGE_LABEL[stage]}
                            <span className="ml-auto text-xs font-normal text-[var(--c-muted)] tabular-nums">{col.length}</span>
                          </div>
                          <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto">
                            {col.map((r) => (
                              <div
                                key={r.id}
                                draggable
                                onDragStart={() => setDragId(r.id)}
                                onDragEnd={() => {
                                  setDragId(null);
                                  setDropStage(null);
                                }}
                                onClick={() => open(r.id)}
                                className={`cursor-grab rounded-[10px] border bg-white px-3 py-2.5 transition-shadow hover:shadow-[0_2px_8px_rgba(12,52,80,0.08)] active:cursor-grabbing ${
                                  selectedId === r.id ? "border-[var(--c-brand)]" : "border-[var(--c-border)]"
                                } ${dragId === r.id ? "opacity-50" : ""}`}
                              >
                                <div className="flex items-start gap-2">
                                  <span className="min-w-0 flex-grow text-[13px] font-semibold leading-snug text-[var(--c-navy)]">{r.title}</span>
                                  <OwnerAvatar name={r.ownerName} />
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {r.clientStatus && RETURNING.has(r.clientStatus) && (
                                    <span className="rounded-md bg-[var(--c-green-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]">Stała</span>
                                  )}
                                  <DevicePill devices={r.devices} from={r.rentalStartsAt ?? r.requestedFrom} days={r.rentalStartsAt ? null : r.requestedDays} />
                                  <TypeTag type={r.type} />
                                </div>
                                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--c-muted)]">
                                  <span>{daysIn(r.stageChangedAt, now) === 0
                                      ? "dziś w etapie"
                                      : `od ${daysIn(r.stageChangedAt, now)} ${daysIn(r.stageChangedAt, now) === 1 ? "dnia" : "dni"} w etapie`}</span>
                                  {r.nextActionAt && <span className="ml-auto font-semibold text-[var(--c-brand-deep)]">krok: {fmtDate(r.nextActionAt).slice(0, 5)}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-stretch gap-3">
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropStage("LOST");
                      }}
                      onDragLeave={() => setDropStage((s) => (s === "LOST" ? null : s))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropStage(null);
                        if (dragId) setLostIds([dragId]);
                      }}
                      className={`flex min-w-[240px] flex-grow items-center justify-center rounded-xl border-2 border-dashed px-4 py-3 text-[13px] transition-colors ${
                        dropStage === "LOST" ? "border-[var(--c-red)] bg-[var(--c-red-soft)] text-[var(--c-red)]" : "border-[var(--c-border)] text-[var(--c-muted)]"
                      }`}
                    >
                      Upuść tutaj, żeby oznaczyć jako przegraną
                    </div>
                    <button type="button" onClick={() => (setFStage("WYGRANA"), setView("list"))} className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-3 text-left text-[13px] hover:border-[var(--c-green)]">
                      <span className="text-[var(--c-muted)]">Wygrane · 30 dni</span>
                      <span className="block text-lg font-semibold text-[var(--c-green-deep)] tabular-nums">{won30}</span>
                    </button>
                    <button type="button" onClick={() => (setFStage("PRZEGRANA"), setView("list"))} className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-3 text-left text-[13px] hover:border-[var(--c-red)]">
                      <span className="text-[var(--c-muted)]">Przegrane · 30 dni</span>
                      <span className="block text-lg font-semibold text-[var(--c-red)] tabular-nums">{lost30}</span>
                    </button>
                  </div>
                </section>
              )}

              {view === "list" && (
                <section aria-label="Lista" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex h-9 min-w-[220px] flex-grow items-center gap-2 rounded-[10px] border border-[var(--c-border)] bg-white px-3 transition-colors focus-within:border-[var(--c-brand)] sm:max-w-[340px]">
                      <SearchIcon size={15} className="flex-none text-[var(--c-muted)]" />
                      <span className="sr-only">Szukaj sygnału</span>
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Szukaj: nazwa, osoba, telefon, e-mail…"
                        className="min-w-0 flex-grow bg-transparent text-sm outline-none placeholder:text-[var(--c-faint)]"
                      />
                    </label>
                    <select aria-label="Etap" className={selectCls(fStage !== "")} value={fStage} onChange={(e) => setFStage(e.target.value as LeadStageKey | "" | "OPEN")}>
                      <option value="OPEN">Otwarte</option>
                      <option value="">Wszystkie etapy</option>
                      {STAGE_KEYS.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <select aria-label="Typ" className={selectCls(Boolean(fType))} value={fType} onChange={(e) => setFType(e.target.value as LeadTypeKey | "")}>
                      <option value="">Każdy typ</option>
                      {TYPE_KEYS.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <select aria-label="Urządzenie" className={selectCls(Boolean(fDevice))} value={fDevice} onChange={(e) => setFDevice(e.target.value as DeviceInterestKey | "")}>
                      <option value="">Każde urządzenie</option>
                      {DEVICE_INTEREST_KEYS.filter((k) => k !== "SZKOLENIE").map((k) => (
                        <option key={k} value={k}>
                          {LEAD_DEVICE_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <select aria-label="Prowadzi" className={selectCls(Boolean(fOwner))} value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
                      <option value="">Każdy prowadzący</option>
                      <option value={currentUserId}>Moje</option>
                      <option value="none">Nieprzypisane</option>
                      {users
                        .filter((u) => u.id !== currentUserId)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                    <select aria-label="Źródło" className={selectCls(Boolean(fSource))} value={fSource} onChange={(e) => setFSource(e.target.value as "" | "hubspot" | "panel")}>
                      <option value="">HubSpot i panel</option>
                      <option value="hubspot">Z HubSpota</option>
                      <option value="panel">Z panelu</option>
                    </select>
                    <button type="button" aria-pressed={fNoClient} onClick={() => setFNoClient((v) => !v)} className={`${selectCls(fNoClient)} px-3`}>
                      Bez klienta
                    </button>
                    <button
                      type="button"
                      onClick={() => exportCsv(filtered)}
                      disabled={filtered.length === 0}
                      className="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40"
                    >
                      <DownloadIcon />
                      CSV
                    </button>
                  </div>
                  <p className="text-xs text-[var(--c-muted)]">{filtered.length} sygnałów</p>
                  <div className="overflow-x-auto rounded-xl border border-[var(--c-border)] bg-white">
                    <table className="w-full min-w-[760px] text-[13px]">
                      <thead className="bg-[var(--c-bg)] text-left text-xs text-[var(--c-muted)]">
                        <tr>
                          <th className="px-3 py-2 font-medium">Sygnał</th>
                          <th className="px-3 py-2 font-medium">Etap</th>
                          <th className="px-3 py-2 font-medium">Typ</th>
                          <th className="px-3 py-2 font-medium">Urządzenie / termin</th>
                          <th className="px-3 py-2 font-medium">Wpłynęło</th>
                          <th className="px-3 py-2 font-medium">Następny krok</th>
                          <th className="px-3 py-2 font-medium">Prowadzi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, limit).map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => open(r.id)}
                            className={`cursor-pointer border-t border-[var(--c-border)] transition-colors hover:bg-[var(--c-brand-soft)]/40 ${selectedId === r.id ? "bg-[var(--c-brand-soft)]/60" : ""}`}
                          >
                            <td className="max-w-[280px] px-3 py-2">
                              <span className="block truncate font-semibold text-[var(--c-navy)]">{r.title}</span>
                              <span className="block truncate text-xs text-[var(--c-muted)]">{[r.clientId ? r.clientName : "bez klienta", r.phone ? formatPhone(r.phone) : null].filter(Boolean).join(" · ")}</span>
                            </td>
                            <td className="px-3 py-2">
                              <StageChip stage={r.stage} />
                              {r.lostReason && <span className="block text-[11px] text-[var(--c-muted)]">{LOST_REASON_LABEL[r.lostReason]}</span>}
                            </td>
                            <td className="px-3 py-2 text-[var(--c-sidebar-text)]">{TYPE_LABEL[r.type]}</td>
                            <td className="px-3 py-2">
                              <DevicePill devices={r.devices} from={r.requestedFrom} days={r.requestedDays} />
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-[var(--c-muted)]">{fmtDate(r.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{r.nextActionAt ? fmtDate(r.nextActionAt) : <span className="text-[var(--c-faint)]">—</span>}</td>
                            <td className="px-3 py-2">{r.ownerName ?? <span className="text-[var(--c-faint)]">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length > limit && (
                    <button type="button" onClick={() => setLimit((l) => l + 60)} className={`${BTN} self-center`}>
                      Pokaż więcej ({filtered.length - limit})
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {/* Karta sygnału: kolumna (≥1280 px) albo panel wysuwany */}
        {card &&
          (wide ? (
            <aside aria-label="Karta sygnału" className="sticky top-4 h-[calc(100vh-110px)] overflow-hidden rounded-[14px] border border-[var(--c-border)]">
              {card}
            </aside>
          ) : (
            <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Karta sygnału">
              <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/25" onClick={close} />
              <div className="relative h-full w-full max-w-[440px] shadow-[0_0_40px_rgba(0,0,0,0.2)]">{card}</div>
            </div>
          ))}
      </div>

      {showNew && (
        <NewLeadDialog
          clients={clients}
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
