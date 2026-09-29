"use client";

import { TodayBar } from "@/components/today-bar";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import { CARD_CSS_VARS } from "@/components/shell-tokens";
import { CLINIC_TYPE_LABEL, DEVICE_INTEREST_KEYS, DEVICE_INTEREST_LABEL, RESIGN_REASON_LABEL, SOURCE_LABEL, STATUS_LABEL, type ClinicTypeKey, type DeviceInterestKey, type ResignReasonKey, type SourceKey } from "@/lib/clients/labels";
import type { ClientListRow } from "@/lib/clients/list-load";
import type { ClientStatus } from "@/lib/clients/status";
import type { SeasonWindow } from "@/lib/clients/list-rules";
import { REGIONS, REGION_LABEL, type RegionKey } from "@/lib/clients/region";
import { ClientCard, type CardIntent } from "../client-card";
import { AgentModeContext, NewClientDialog } from "../client-forms";
import { LIST_URL_KEY } from "../card/client-full-card";
import { RhythmHelp, RiskDot, Strip, StripCellBox } from "./rhythm";
import { FUNNELS, LEAD_STAGES, PotentialTable, isEmailName, potentialCounts, type Funnel } from "./potential";
import { STAGE_LABEL as LEAD_STAGE_LABEL } from "@/lib/leads/labels";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { BulkTaskDialog } from "./bulk";
import { RhythmView } from "./rhythm-view";
import { MapView } from "./map-view";
import { STATUS_BADGE, STATUS_TILE, TAB_STATUSES, daysBetween, dm, dmSmart, downloadCsv, mY, wd, wdLong } from "./format";

// Lista klientów (/klienci) — wygląd 1:1 z lista-klientow-wzor.html (1440 px),
// logika wg prompt-code-lista-klientow.md. Styl karty klienta (Jost + Open
// Sans, ostre narożniki) TYLKO na tej stronie. Klientów < 1000 — filtry,
// wyszukiwanie i sortowanie w przeglądarce, stronicowanie po 50.

export type UnassignedSummary = { count: number; months: string; examples: { name: string; at: string }[] };

type Tab = "KLIENCI" | "POTENCJALNI";
type SortKey = "next" | "last" | "name" | "risk" | "rentals" | "created";
const SORT_LABEL: Record<SortKey, string> = {
  next: "Następny wynajem",
  last: "Ostatni wynajem",
  name: "Nazwa",
  risk: "Ryzyko odejścia",
  rentals: "Liczba wynajmów (12 mies.)",
  created: "Data dodania",
};
type Risk = "niskie" | "średnie" | "wysokie" | "brak";
type Gap = "phone" | "nip" | "city" | "email" | "zip" | "emailName";
const GAP_LABEL: Record<Gap, string> = { phone: "bez telefonu", nip: "bez NIP", city: "bez miasta", email: "bez e-maila", zip: "bez kodu pocztowego", emailName: "nazwa = e-mail" };
type Special = "season" | "afterRental" | "stepSoon" | "check" | "resigned" | null;
const SPECIAL_LABEL: Record<Exclude<Special, null>, string> = {
  season: "Przed sezonem",
  afterRental: "Kontakt po wynajmie",
  stepSoon: "Następny krok ≤ 7 dni",
  check: "Do sprawdzenia",
  // Wniosek 24: filtr „Zrezygnowali” (klik w znacznik przy kliencie, ?widok=resigned).
  resigned: "Zrezygnowali",
};

const PAGE = 50;
// Skala jak w reszcie panelu (Jost, 13 px, przyciski 34 px) — prompt
// „zagęszczenie”, 27.09.2026: wiersz ok. 60 px, pierwszy klient ≤ 650 px.
// Rytm: 15 × 12 px + odstępy 2 px + kreska = ok. 215 px — kolumna 226 px.
const ROW_GRID = "grid grid-cols-[24px_minmax(200px,300px)_226px_120px_188px_minmax(140px,1fr)_66px] gap-x-3";
const LABEL_WIDE = "text-[10.5px] uppercase tracking-[0.14em]";
const BTN = "flex h-[34px] items-center whitespace-nowrap rounded-[6px] border border-[#A9D2EC] bg-white px-3 text-[13px] text-[#1B6FA8] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_PRIMARY = "flex h-[34px] items-center whitespace-nowrap rounded-[6px] border border-[#1B6FA8] bg-[#1B6FA8] px-3.5 text-[13px] font-medium text-white hover:bg-[#0C3450]";

function gapOf(r: ClientListRow, g: Gap): boolean {
  if (g === "phone") return !r.hasPhone;
  if (g === "nip") return !r.nip;
  if (g === "city") return !r.city;
  if (g === "email") return !r.primaryEmail;
  if (g === "emailName") return isEmailName(r);
  return !r.zip;
}

function nextKey(r: ClientListRow): string {
  // Najpierw rezerwacje (od najbliższej), potem prognoza z rytmu, na końcu reszta.
  if (r.nextRental) return `0${r.nextRental.at}`;
  if (r.forecastAt) return `1${r.forecastAt}`;
  return `2${r.lastRentalAt ? String(9e15 - new Date(r.lastRentalAt).getTime()) : "z"}`;
}

function Badge({ status }: { status: ClientStatus }) {
  const b = STATUS_BADGE[status];
  return <span className={`flex-none whitespace-nowrap px-[7px] py-px text-[10.5px] font-medium uppercase tracking-[0.14em] ${b.cls}`}>{b.label}</span>;
}

function Check({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`box-border flex h-4 w-4 items-center justify-center p-0 ${on ? "bg-[#1B6FA8]" : "border-[1.5px] border-[#B9BEC3] bg-white hover:border-[#1B6FA8]"}`}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 5.2 4 7.5 8.5 2.5" fill="none" stroke="#fff" strokeWidth="1.6" />
        </svg>
      )}
    </button>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`h-[30px] rounded-[6px] border px-2.5 text-[12.5px] ${active ? "border-[#1B6FA8] bg-[#EAF4FB] text-[#1B6FA8]" : "border-[#D6DADE] bg-white text-[#3A3A3A] hover:border-[#1B6FA8]"}`}
    >
      {children}
    </button>
  );
}

// Filtr-lista w wyglądzie chipa („Urządzenie ▾”) — natywny <select> pod spodem.
function SelectChip<T extends string>({ label, value, onChange, options }: { label: string; value: T | ""; onChange: (v: T | "") => void; options: { value: T; label: string }[] }) {
  const current = options.find((o) => o.value === value);
  return (
    <label
      className={`relative flex h-[30px] cursor-pointer items-center rounded-[6px] border px-2.5 text-[12.5px] ${value ? "border-[#1B6FA8] bg-[#EAF4FB] text-[#1B6FA8]" : "border-[#D6DADE] bg-white text-[#3A3A3A] hover:border-[#1B6FA8]"}`}
    >
      {current ? `${label}: ${current.label}` : label} ▾
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T | "")} className="absolute inset-0 cursor-pointer opacity-0">
        <option value="">Wszystkie</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ClientsList({
  rows: allRows,
  pendingHistory,
  unassigned,
  season,
  todayIso,
  initialQuery = {},
}: {
  rows: ClientListRow[];
  pendingHistory: number;
  unassigned: UnassignedSummary;
  season: Pick<SeasonWindow, "label" | "baseLabel" | "seasonLabel" | "baseMonths" | "seasonMonths" | "flip">;
  todayIso: string;
  initialQuery?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const agent = useContext(AgentModeContext);
  const today = useMemo(() => new Date(todayIso), [todayIso]);
  const iq = initialQuery;

  const [tab, setTab] = useState<Tab>(iq.zakladka === "potencjalni" || iq.zapytania === "1" ? "POTENCJALNI" : "KLIENCI");
  const [query, setQuery] = useState(iq.q ?? "");
  const [debounced, setDebounced] = useState(iq.q ?? "");
  const [status, setStatus] = useState<ClientStatus | "">((TAB_STATUSES as string[]).includes(iq.status ?? "") ? (iq.status as ClientStatus) : "");
  // Potencjalni: grupa lejka (W lejku / Poza lejkiem / Archiwum 2025) i etap z sygnału.
  const [stage, setStage] = useState<Funnel | "">(FUNNELS.some((s) => s.key === iq.etap) ? (iq.etap as Funnel) : "");
  const [leadStage, setLeadStage] = useState<LeadStageKey | "">(LEAD_STAGES.includes(iq.sygnal as LeadStageKey) ? (iq.sygnal as LeadStageKey) : "");
  const [region, setRegion] = useState<RegionKey | "">((REGIONS as readonly string[]).includes(iq.region ?? "") ? (iq.region as RegionKey) : "");
  const [device, setDevice] = useState<DeviceInterestKey | "">((DEVICE_INTEREST_KEYS as string[]).includes(iq.urzadzenie ?? "") ? (iq.urzadzenie as DeviceInterestKey) : "");
  const [clinicType, setClinicType] = useState<ClinicTypeKey | "">(iq.rodzaj && iq.rodzaj in CLINIC_TYPE_LABEL ? (iq.rodzaj as ClinicTypeKey) : "");
  const [source, setSource] = useState<SourceKey | "">(iq.zrodlo && iq.zrodlo in SOURCE_LABEL ? (iq.zrodlo as SourceKey) : "");
  const [risk, setRisk] = useState<Risk | "">((["niskie", "średnie", "wysokie", "brak"] as string[]).includes(iq.ryzyko ?? "") ? (iq.ryzyko as Risk) : "");
  const [overdue, setOverdue] = useState(iq.poTerminie === "1");
  const [noStep, setNoStep] = useState(iq.bezKroku === "1");
  const [gap, setGap] = useState<Gap | "">(iq.brakTelefonu === "1" ? "phone" : iq.braki && iq.braki in GAP_LABEL ? (iq.braki as Gap) : "");
  const [trained, setTrained] = useState(iq.szkolenie === "1");
  const [special, setSpecial] = useState<Special>(iq.widok && iq.widok in SPECIAL_LABEL ? (iq.widok as Special) : null);
  const [sort, setSort] = useState<SortKey>(iq.sort && iq.sort in SORT_LABEL ? (iq.sort as SortKey) : "next");
  // Widok zakładki Klienci: lista albo „Rytm (plan obłożenia)”; Mapa — później.
  const [mode, setMode] = useState<"lista" | "rytm" | "mapa">(iq.tryb === "rytm" || iq.tryb === "mapa" ? iq.tryb : "lista");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [card, setCard] = useState<{ id: string; intent: CardIntent } | null>(iq.klient ? { id: iq.klient, intent: null } : null);
  const [showNew, setShowNew] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [note, setNote] = useState<ReactNode>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Stan listy → adres (bez przeładowania) i pamięć karty przeglądarki, z
  // której pełna karta klienta bierze link „← Klienci”.
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab === "POTENCJALNI") p.set("zakladka", "potencjalni");
    if (debounced.trim()) p.set("q", debounced.trim());
    if (status) p.set("status", status);
    if (stage) p.set("etap", stage);
    if (leadStage) p.set("sygnal", leadStage);
    if (region) p.set("region", region);
    if (device) p.set("urzadzenie", device);
    if (clinicType) p.set("rodzaj", clinicType);
    if (source) p.set("zrodlo", source);
    if (risk) p.set("ryzyko", risk);
    if (overdue) p.set("poTerminie", "1");
    if (noStep) p.set("bezKroku", "1");
    if (gap) p.set("braki", gap);
    if (trained) p.set("szkolenie", "1");
    if (special) p.set("widok", special);
    if (sort !== "next") p.set("sort", sort);
    if (mode !== "lista") p.set("tryb", mode);
    const listSearch = p.toString() ? `?${p.toString()}` : "";
    window.history.replaceState(null, "", `${BASE_PATH}/klienci${listSearch}`);
    try {
      sessionStorage.setItem(LIST_URL_KEY, listSearch);
    } catch {
      // brak sessionStorage — powrót z karty wróci do czystej listy
    }
  }, [tab, debounced, status, stage, leadStage, region, device, clinicType, source, risk, overdue, noStep, gap, trained, special, sort, mode]);

  const clientsRows = useMemo(() => allRows.filter((r) => r.status !== "POTENCJALNY"), [allRows]);
  // Lejek v2: Potencjalni = tylko osoby z interakcją (rozmowa, mail, SMS);
  // nietknięte kontakty z zapytań zostają w Sygnałach („Kontakt”).
  const potentialAll = useMemo(() => allRows.filter((r) => r.status === "POTENCJALNY"), [allRows]);
  const potentialRows = useMemo(() => potentialAll.filter((r) => r.qualified), [potentialAll]);
  const untouchedContacts = potentialAll.length - potentialRows.length;
  const tabRows = tab === "KLIENCI" ? clientsRows : potentialRows;

  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(TAB_STATUSES.map((s) => [s, 0])) as Record<ClientStatus, number>;
    for (const r of clientsRows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [clientsRows]);
  const pCounts = useMemo(() => potentialCounts(potentialRows), [potentialRows]);

  // Przed sezonem: najpierw po terminie wg rytmu, potem liczba wynajmów.
  const seasonRows = useMemo(
    () =>
      clientsRows
        .filter((r) => r.beforeSeason)
        .sort((a, b) => (b.overdueRatio ?? 0) - (a.overdueRatio ?? 0) || b.rentalsTotal - a.rentalsTotal),
    [clientsRows],
  );
  const seasonTop = useMemo(() => [...seasonRows].sort((a, b) => b.rentalsTotal - a.rentalsTotal).slice(0, 7), [seasonRows]);
  const noPhone = useMemo(() => allRows.filter((r) => !r.hasPhone), [allRows]);
  const noPhoneClients = noPhone.filter((r) => r.status !== "POTENCJALNY").length;

  const afterRental = useMemo(() => clientsRows.filter((r) => r.pickupAt).sort((a, b) => (b.pickupAt ?? "").localeCompare(a.pickupAt ?? "")), [clientsRows]);
  const soon = useMemo(() => {
    const limitDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8).toISOString();
    return clientsRows.filter((r) => r.nextStep?.dueAt && r.nextStep.dueAt < limitDay).sort((a, b) => (a.nextStep!.dueAt ?? "").localeCompare(b.nextStep!.dueAt ?? ""));
  }, [clientsRows, today]);
  const checks = useMemo(() => allRows.filter((r) => r.check), [allRows]);
  const resignedRows = useMemo(() => allRows.filter((r) => r.resigned), [allRows]);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^48(?=\d{3,})/, "");
    const specialSet =
      special === "season" ? new Set(seasonRows.map((r) => r.id)) : special === "afterRental" ? new Set(afterRental.map((r) => r.id)) : special === "stepSoon" ? new Set(soon.map((r) => r.id)) : special === "check" ? new Set(checks.map((r) => r.id)) : special === "resigned" ? new Set(resignedRows.map((r) => r.id)) : null;
    const base = special === "check" ? checks : special === "resigned" ? resignedRows : tabRows;
    const list = base.filter((r) => {
      if (q.length >= 2) {
        const textHit = r.search.includes(q);
        const phoneHit = qDigits.length >= 3 && r.phoneDigits.includes(qDigits);
        if (!textHit && !phoneHit) return false;
      }
      if (specialSet && !specialSet.has(r.id)) return false;
      if (tab === "KLIENCI" && status && r.status !== status) return false;
      if (tab === "POTENCJALNI" && stage && r.funnel !== stage) return false;
      if (tab === "POTENCJALNI" && leadStage && (r.funnel !== "IN" || r.lead?.stage !== leadStage)) return false;
      if (region && r.region !== region) return false;
      if (device && !r.devices.includes(device)) return false;
      if (clinicType && r.clinicType !== clinicType) return false;
      if (source && r.source !== source) return false;
      if (risk && (r.rhythm.risk ?? "brak") !== risk) return false;
      if (overdue && !(r.overdueRatio != null && r.overdueRatio >= 1)) return false;
      if (noStep && r.nextStep) return false;
      if (gap && !gapOf(r, gap)) return false;
      if (trained && !r.trained) return false;
      return true;
    });
    if (special === "season") {
      const order = new Map(seasonRows.map((r, i) => [r.id, i]));
      return list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    const byName = (a: ClientListRow, b: ClientListRow) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name, "pl");
    const sorters: Record<SortKey, (a: ClientListRow, b: ClientListRow) => number> = {
      next: (a, b) => nextKey(a).localeCompare(nextKey(b)) || byName(a, b),
      last: (a, b) => (b.lastRentalAt ?? "").localeCompare(a.lastRentalAt ?? "") || byName(a, b),
      name: byName,
      risk: (a, b) => (b.overdueRatio ?? b.rhythm.ratio ?? -1) - (a.overdueRatio ?? a.rhythm.ratio ?? -1) || byName(a, b),
      rentals: (a, b) => b.rentals12m - a.rentals12m || byName(a, b),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return list.sort(sorters[sort]);
  }, [tabRows, tab, debounced, special, seasonRows, afterRental, soon, checks, resignedRows, status, stage, leadStage, region, device, clinicType, source, risk, overdue, noStep, gap, trained, sort]);

  const page = visible.slice(0, limit);
  const selectedRows = allRows.filter((r) => selected.has(r.id));

  const resetPage = useCallback(() => {
    setLimit(PAGE);
  }, []);

  function clearFilters() {
    setStatus("");
    setStage("");
    setLeadStage("");
    setRegion("");
    setDevice("");
    setClinicType("");
    setSource("");
    setRisk("");
    setOverdue(false);
    setNoStep(false);
    setGap("");
    setTrained(false);
    setSpecial(null);
    setQuery("");
    resetPage();
  }

  function applyView(v: "seasonLs" | "almaTrained" | "noNip" | "resigned") {
    clearFilters();
    setTab("KLIENCI");
    if (v === "resigned") setSpecial("resigned");
    if (v === "seasonLs") {
      setSpecial("season");
      setDevice("LIGHTSHEER");
    }
    if (v === "almaTrained") {
      setDevice("ALMA_HARMONY");
      setTrained(true);
    }
    if (v === "noNip") setGap("nip");
  }

  function showSpecial(s: Exclude<Special, null>) {
    clearFilters();
    setTab("KLIENCI");
    setSpecial(s);
    document.getElementById("lista")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function switchTab(t: Tab) {
    setTab(t);
    setStatus("");
    setStage("");
    setLeadStage("");
    setSpecial(null);
    setSelected(new Set());
    resetPage();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function exportRows(rows: ClientListRow[], name: string) {
    downloadCsv(
      name,
      ["Nazwa", "Nazwa robocza", "Osoba", "Telefon", "E-mail", "Miasto", "Region", "Status", "Wynajmy 12 mies.", "Ostatni wynajem", "Następny wynajem", "Następny krok", "Urządzenia"],
      rows.map((r) => [
        r.name,
        r.shortName,
        r.primaryName,
        r.primaryPhone,
        r.primaryEmail,
        r.city,
        REGION_LABEL[r.region],
        STATUS_LABEL[r.status],
        r.rentals12m,
        r.lastRentalAt ? dmSmart(r.lastRentalAt, today) : "",
        r.nextRental ? dmSmart(r.nextRental.at, today) : "",
        r.nextStep?.text ?? "",
        r.deviceChips.join(", "),
      ]),
    );
  }

  async function bulkSms() {
    const lines = selectedRows.filter((r) => r.primaryPhone).map((r) => `${r.shortName ?? r.name}\t${r.primaryPhone}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNote(
        <>
          Skopiowano {lines.length} {lines.length === 1 ? "numer" : "numerów"} do schowka ({selectedRows.length - lines.length} bez telefonu).{" "}
          <Link href="/wysylka-sms" className="underline underline-offset-[3px]">
            Otwórz Wysyłkę SMS →
          </Link>
        </>,
      );
    } catch {
      setNote(<>Nie udało się skopiować numerów — przeglądarka zablokowała schowek.</>);
    }
  }

  function bulkMail() {
    const emails = [...new Set(selectedRows.map((r) => r.primaryEmail).filter((e): e is string => !!e))];
    if (!emails.length) return setNote(<>Zaznaczeni klienci nie mają adresów e-mail.</>);
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}`;
  }

  const { past: pastLabel, future: futureLabel, months: monthLabels } = useMemo(() => stripLabels(today), [today]);
  const anyFilter = Boolean(status || stage || leadStage || region || device || clinicType || source || risk || overdue || noStep || gap || trained || special || debounced.trim().length >= 2);
  const seasonOpen = useSyncExternalStore(subscribeSeason, readSeasonOpen, () => false);
  const [todayOpen, setTodayOpen] = useState<TodayKey | null>(null);

  const todayTiles: { key: TodayKey; label: string; n: number; sub: string; items: string[]; action: { label: string; href?: string; onClick?: () => void } | null }[] = [
    {
      key: "afterRental",
      label: "Kontakt po wynajmie",
      n: afterRental.length,
      sub: afterRental.length ? `odbiór ${rangeLabel(afterRental.map((r) => r.pickupAt!))}` : "nic do zrobienia",
      items: afterRental.map((r) => `${r.shortName ?? r.name}${r.city ? ` (${r.city.split(/[,/]/)[0].trim()})` : ""}`),
      action: afterRental.length ? { label: "Pokaż na liście →", onClick: () => showSpecial("afterRental") } : null,
    },
    {
      key: "stepSoon",
      label: "Następny krok",
      n: soon.length,
      sub: soon[0]?.nextStep?.dueAt ? `termin ${dm(soon[0].nextStep.dueAt)}` : "w ciągu 7 dni",
      items: soon.map((r) => `${r.shortName ?? r.name}: ${r.nextStep!.text}${r.nextStep!.dueAt ? ` (${dm(r.nextStep!.dueAt)})` : ""}`),
      action: soon.length ? { label: "Pokaż na liście →", onClick: () => showSpecial("stepSoon") } : null,
    },
    {
      key: "unassigned",
      label: "Rezerwacje bez klienta",
      n: unassigned.count,
      sub: unassigned.months || "—",
      items: unassigned.examples.length ? unassigned.examples.map((e) => `${e.name} ${dm(e.at)}`) : unassigned.count ? ["brak klienta w bazie — dodaj klienta"] : [],
      action: unassigned.count ? { label: "Przypisz w dopasowaniach →", href: "/klienci/dopasowania#rezerwacje" } : null,
    },
    {
      key: "check",
      label: "Do sprawdzenia",
      n: checks.length,
      sub: "status",
      items: checks.map((r) => `${r.shortName ?? r.name}: ${r.check}`),
      action: checks.length ? { label: "Pokaż na liście →", onClick: () => showSpecial("check") } : null,
    },
  ];
  const openTile = todayTiles.find((t) => t.key === todayOpen) ?? null;

  return (
    <div style={CARD_CSS_VARS} className="-mx-4 -mt-6 flex flex-col bg-[#FDFBF8] pb-10 text-[13px] leading-[1.45] tabular-nums text-[#3A3A3A] md:-mx-[30px] md:-mt-[26px]">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-6 md:px-7">
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[26px] font-semibold leading-[1.15] text-[#0C3450]">Klienci</h1>
          <div className="mt-0.5 text-[13px] text-[#5C6166]">
            {clientsRows.length} gabinetów z historią wynajmów <span className="text-[#C3C4C7]">|</span> {potentialRows.length} kontaktów z zapytań w zakładce „Potencjalni”
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => exportRows(visible, `klienci-${todayIso.slice(0, 10)}.csv`)} disabled={visible.length === 0} className={BTN}>
            Eksport CSV
          </button>
          <Link href="/klienci/warunki" className={BTN} title="Przyszłe rezerwacje bez kwoty i kwoty inne niż w warunkach handlowych">
            Kwoty wg warunków
          </Link>
          <Link href="/klienci/dopasowania" className={BTN}>
            Dopasowania historii
            {pendingHistory > 0 && <span className="ml-1.5 rounded-[4px] bg-[#FBF0E7] px-1.5 font-semibold text-[#B8612F]">{pendingHistory}</span>}
          </Link>
          {!agent && (
            <button type="button" onClick={() => setShowNew(true)} className={BTN_PRIMARY}>
              + Nowy klient
            </button>
          )}
        </div>
      </div>

      {/* Zakładki + przełącznik widoku */}
      <div className="mx-4 mt-4 flex flex-wrap items-end justify-between gap-3 border-b border-[#E4E7EA] md:mx-7" role="tablist">
        <div className="flex gap-7">
          {(
            [
              ["KLIENCI", "Klienci", clientsRows.length],
              ["POTENCJALNI", "Potencjalni", potentialRows.length],
            ] as const
          ).map(([key, label, n]) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => switchTab(key)}
                className={`-mb-px pb-2 text-[15px] ${on ? "border-b-[3px] border-[#E08A5C] font-semibold text-[#0C3450]" : "font-normal text-[#5C6166] hover:text-[#0C3450]"}`}
              >
                {label} <span className={`text-[13px] ${on ? "text-[#1B6FA8]" : ""}`}>{n}</span>
              </button>
            );
          })}
          <Link href="/archiwum" className="pb-2 text-[15px] text-[#5C6166] hover:text-[#0C3450]">
            Archiwum
          </Link>
        </div>
        <div className="mb-1.5 flex overflow-hidden rounded-[6px] border border-[#D6DADE] text-[12.5px]" aria-label="Widok">
          {(
            [
              ["lista", "Lista"],
              ["rytm", "Rytm (plan obłożenia)"],
              ["mapa", "Mapa"],
            ] as const
          ).map(([k, label], i) => {
            const on = tab === "KLIENCI" ? mode === k : k === "lista";
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                disabled={tab !== "KLIENCI" && k !== "lista"}
                title={tab !== "KLIENCI" && k !== "lista" ? "Tylko dla zakładki Klienci" : undefined}
                onClick={() => setMode(k)}
                className={`px-3 py-[5px] disabled:cursor-not-allowed disabled:text-[#9AA1A8] ${i > 0 ? "border-l border-[#D6DADE]" : ""} ${on ? "bg-[#0C3450] text-white" : "bg-white text-[#5C6166] hover:text-[#0C3450]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pas statusów (Klienci) — jeden rząd; opis kafla w dymku */}
      {tab === "KLIENCI" ? (
      <div className="mt-4 grid grid-cols-2 gap-2 bg-[#EAF4FB] px-4 py-2 sm:grid-cols-3 md:px-7 xl:grid-cols-6">
        {[
              { key: "", title: "Wszyscy", n: clientsRows.length, hint: "z historią wynajmów", marker: "bg-[#0C3450]" },
              ...TAB_STATUSES.map((s) => ({ key: s, title: STATUS_TILE[s].title, n: statusCounts[s] ?? 0, hint: STATUS_TILE[s].hint, marker: STATUS_TILE[s].marker })),
        ].map((t) => {
          const on = status === t.key && !special;
          return (
            <button
              key={t.key || "all"}
              type="button"
              aria-pressed={on}
              title={t.hint}
              onClick={() => {
                setSpecial(null);
                setStatus(t.key as ClientStatus | "");
                resetPage();
              }}
              className={`flex h-12 items-center justify-between gap-2 px-3 text-left ${on ? "border-2 border-[#1B6FA8] bg-white" : "border-2 border-transparent bg-white/55 hover:bg-white"}`}
            >
              <span className={`flex min-w-0 items-center gap-2 ${LABEL_WIDE} text-[#5C6166]`}>
                <span className={`box-border h-2 w-2 flex-none ${t.marker}`} />
                <span className="truncate">{t.title}</span>
              </span>
              <span className="text-[20px] font-semibold leading-none text-[#1B6FA8]">{t.n}</span>
            </button>
          );
        })}
      </div>
      ) : (
        <>
          {/* Potencjalni (lejek, wzór s4): bez własnych etapów — grupy lejka i braki danych */}
          <div className="mx-4 mt-4 grid grid-cols-2 bg-[#EAF4FB] sm:grid-cols-4 md:mx-7 xl:grid-cols-7">
            {[
              { key: "ALL", label: "Potencjalni", n: potentialRows.length, sub: "osoby z interakcją", on: stage === "" && !gap, click: () => { setStage(""); setGap(""); } },
              { key: "IN", label: "W lejku teraz", n: pCounts.inFunnel, sub: "otwarty sygnał", on: stage === "IN", click: () => setStage(stage === "IN" ? "" : "IN") },
              { key: "postponed", label: "Odłożeni", n: potentialRows.filter((r) => r.lead?.stage === "ODLOZONE").length, sub: "z datą powrotu", on: false, click: () => setStage("IN") },
              { key: "OUT", label: "Poza lejkiem", n: pCounts.out, sub: `bez sygnału · ${pCounts.outWithPhone} z telefonem`, warn: true, on: stage === "OUT", click: () => setStage(stage === "OUT" ? "" : "OUT") },
              { key: "ARCHIVE", label: "Archiwum 2025", n: pCounts.archive, sub: "do kampanii przed sezonem", on: stage === "ARCHIVE", click: () => setStage(stage === "ARCHIVE" ? "" : "ARCHIVE") },
              { key: "emailName", label: "Nazwa = e-mail", n: pCounts.emailName, sub: "do uzupełnienia (agent)", warn: true, on: gap === "emailName", click: () => setGap(gap === "emailName" ? "" : "emailName") },
              { key: "contacts", label: "Kontakty bez interakcji", n: untouchedContacts, sub: "tylko w Sygnałach → Nowe / archiwum", on: false, click: () => router.push("/sygnaly") },
            ].map((k) => (
              <button
                key={k.key}
                type="button"
                aria-pressed={k.on}
                onClick={() => {
                  k.click();
                  resetPage();
                }}
                className={`border-r border-[#D4E6F3] px-3.5 py-2.5 text-left last:border-0 ${k.on ? "outline outline-2 -outline-offset-2 outline-[#1B6FA8]" : "hover:bg-white/50"}`}
              >
                <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">{k.label}</span>
                <div className={`text-[20px] font-medium leading-[1.2] tabular-nums ${k.warn ? "text-[#B8612F]" : "text-[#0C3450]"}`}>{k.n}</div>
                <small className="block text-[11.5px] text-[#5C6166]">{k.sub}</small>
              </button>
            ))}
          </div>
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 md:mx-7">
            {[
              [[["", "Wszyscy"], ...FUNNELS.map((f) => [f.key, f.label])] as [string, string][], stage, (v: string) => setStage(v as Funnel | "")] as const,
              [[["", "Każdy etap"], ...LEAD_STAGES.map((k) => [k, k === "OFERTA" ? "Oferta" : LEAD_STAGE_LABEL[k]])] as [string, string][], leadStage, (v: string) => setLeadStage(v as LeadStageKey | "")] as const,
              [[["emailName", "nazwa = e-mail"], ["phone", "bez telefonu"], ["city", "bez miasta"]] as [string, string][], gap, (v: string) => setGap((gap === v ? "" : v) as Gap | "")] as const,
            ].map(([opts, value, set], i) => (
              <span key={i} className="inline-flex overflow-hidden rounded-[6px] border border-[#C9D3DC] bg-white text-[12px]">
                {opts.map(([k, label]) => (
                  <button
                    key={k || "all"}
                    type="button"
                    onClick={() => {
                      set(k);
                      resetPage();
                    }}
                    className={`border-r border-[#E3E6E9] px-2.5 py-1 last:border-0 ${value === k ? "bg-[#0C3450] text-white" : "text-[#2A3540] hover:bg-[#F4F6F8]"}`}
                  >
                    {label}
                  </button>
                ))}
              </span>
            ))}
          </div>
        </>
      )}

      {tab === "KLIENCI" && (
        <>
          {/* Przed sezonem — jeden rząd; szczegóły pętli po rozwinięciu */}
          <div className="mx-4 mt-4 grid gap-3 md:mx-7 xl:grid-cols-[minmax(0,1fr)_250px]">
            <div className="flex min-w-0 flex-col justify-center gap-2 bg-[#FBF0E7] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 xl:flex-nowrap">
                <div className="flex flex-none flex-col">
                  <span className={`${LABEL_WIDE} text-[#B8612F]`}>Przed sezonem · {season.label}</span>
                  <span className="text-[20px] font-semibold leading-tight text-[#B8612F]" title={`wynajmowały w ${season.baseLabel}, a na ${season.seasonLabel} nie mają wynajmu ani rezerwacji`}>
                    {seasonRows.length} {seasonRows.length === 1 ? "klientka" : "klientek"}
                  </span>
                </div>
                <div className="flex flex-none gap-[2px]" aria-hidden title={`${season.baseLabel.split(" ")[0]} wynajmowały · ${season.seasonLabel} nic w kalendarzu`}>
                  {["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"].map((m, i) => (
                    <div key={m} className="flex flex-col items-center gap-px">
                      <span className={`box-border block h-3 w-[14px] ${season.baseMonths.includes(i + 1) ? "bg-[#BFD8EC]" : "border-[1.5px] border-dashed border-[#E08A5C] bg-white"}`} />
                      <span className="text-[9px] leading-none text-[#5C6166]">{m}</span>
                    </div>
                  ))}
                </div>
                {/* Jeden rząd chipów; te, które się nie mieszczą, chowają się w całości. */}
                <div className="flex h-[22px] min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden" title={seasonTop.map((r) => `${r.shortName ?? r.name} (${r.rentalsTotal})`).join(" · ")}>
                  {seasonTop.slice(0, 5).map((r) => (
                    <Link key={r.id} href={`/klienci/${r.id}`} className="max-w-[150px] flex-none truncate rounded-[4px] bg-white/75 px-2 py-0.5 text-[12px] text-[#3A3A3A] hover:text-[#1B6FA8]" title={`${r.name} · ${r.rentalsTotal} wynajmów`}>
                      {r.shortName ?? r.name} <span className="text-[#5C6166]">({r.rentalsTotal})</span>
                    </Link>
                  ))}
                </div>
                <div className="flex flex-none items-center gap-3">
                  <button type="button" onClick={() => writeSeasonOpen(!seasonOpen)} aria-expanded={seasonOpen} className="whitespace-nowrap text-[12px] text-[#B8612F] hover:underline">
                    {seasonOpen ? "▴ zwiń" : "▾ szczegóły"}
                  </button>
                  <button type="button" onClick={() => showSpecial("season")} disabled={seasonRows.length === 0} className="h-[30px] whitespace-nowrap rounded-[6px] bg-[#B8612F] px-3 text-[12.5px] font-semibold text-white hover:bg-[#9C4F24] disabled:opacity-50">
                    Pokaż listę ({seasonRows.length})
                  </button>
                </div>
              </div>
              {seasonOpen && (
                <div className="flex flex-col gap-0.5 border-t border-[#EBD3C1] pt-2 text-[12px] leading-[1.45] text-[#4A4A4A]">
                  <span>
                    Wynajmowały w <span className="font-semibold text-[#1B6FA8]">{season.baseLabel}</span>, a na <span className="font-semibold text-[#B8612F]">{season.seasonLabel}</span> nie mają ani wynajmu, ani rezerwacji.
                  </span>
                  <span>↻ {season.flip}</span>
                  <span className="text-[#5C6166]">Kolejność na liście: najpierw te, którym wg rytmu minął już termin; pomijane miesiące przerwy klientki (np. VII–VIII).</span>
                </div>
              )}
            </div>
            <div className="flex flex-col justify-center gap-0.5 border border-[#E4E7EA] bg-white px-4 py-3" title={`${noPhoneClients} wśród klientów, ${noPhone.length - noPhoneClients} wśród kontaktów z zapytań`}>
              <span className={`${LABEL_WIDE} text-[#5C6166]`}>Braki danych</span>
              <div className="flex items-baseline justify-between gap-2">
                <span>
                  <span className="text-[20px] font-semibold leading-tight text-[#B8612F]">{noPhone.length}</span> <span className="text-[13px]">bez telefonu</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearFilters();
                    if (noPhoneClients === 0) setTab("POTENCJALNI");
                    setGap("phone");
                    document.getElementById("lista")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="text-[13px] font-semibold text-[#1B6FA8] hover:text-[#0C3450]"
                >
                  Uzupełnij →
                </button>
              </div>
            </div>
          </div>

          {/* Do zrobienia dziś — jeden rząd kafli; lista pozycji po kliknięciu */}
          <TodayBar
            title="Do zrobienia dziś"
            dateLabel={`${wdLong(today)} ${dm(todayIso)}`}
            tiles={todayTiles.map((t) => ({ key: t.key, label: t.label, n: t.n, sub: t.sub }))}
            active={todayOpen}
            onToggle={(k) => setTodayOpen(k as TodayKey | null)}
          >
            {openTile && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/20 pt-2 text-[13px] text-white">
                <span className="min-w-0 flex-1">{openTile.items.slice(0, 8).join(" · ")}{openTile.items.length > 8 ? ` · i ${openTile.items.length - 8} więcej` : ""}</span>
                {openTile.action &&
                  (openTile.action.href ? (
                    <Link href={openTile.action.href} className="whitespace-nowrap underline underline-offset-[3px] hover:text-[#BFD6EA]">
                      {openTile.action.label}
                    </Link>
                  ) : (
                    <button type="button" onClick={openTile.action.onClick} className="whitespace-nowrap underline underline-offset-[3px] hover:text-[#BFD6EA]">
                      {openTile.action.label}
                    </button>
                  ))}
              </div>
            )}
          </TodayBar>
        </>
      )}

      {/* Wyszukiwarka + region + sortowanie; filtry i zapisane widoki */}
      <div id="lista" className="mx-4 mt-4 flex scroll-mt-4 flex-col gap-2 md:mx-7">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-[34px] min-w-[220px] flex-1 items-center rounded-[6px] border border-[#D6DADE] bg-white px-3 focus-within:border-[#1B6FA8]">
            <span className="sr-only">Szukaj klienta</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
              placeholder="Szukaj: gabinet, nazwa robocza (np. MiWiNi), osoba, telefon, NIP, e-mail…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#3A3A3A] outline-none placeholder:text-[#8A9096]"
            />
          </label>
          <div className="flex overflow-hidden rounded-[6px] border border-[#D6DADE]" role="group" aria-label="Region">
            {(["", ...REGIONS] as (RegionKey | "")[]).map((k, i) => {
              const on = region === k;
              return (
                <button
                  key={k || "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setRegion(k);
                    resetPage();
                  }}
                  className={`h-[32px] whitespace-nowrap px-2.5 text-[12.5px] ${i > 0 ? "border-l border-[#D6DADE]" : ""} ${on ? "bg-[#0C3450] text-white" : "bg-white text-[#3A3A3A] hover:text-[#1B6FA8]"}`}
                >
                  {k ? REGION_LABEL[k] : "Wszystkie regiony"}
                </button>
              );
            })}
          </div>
          <label className="relative flex h-[34px] items-center gap-1.5 rounded-[6px] border border-[#D6DADE] bg-white px-3 text-[13px] text-[#3A3A3A]">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">Sortuj</span> {SORT_LABEL[sort]} ▾
            <select aria-label="Sortuj" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="absolute inset-0 cursor-pointer opacity-0">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SelectChip label="Urządzenie" value={device} onChange={(v) => (setDevice(v), resetPage())} options={DEVICE_INTEREST_KEYS.map((k) => ({ value: k, label: DEVICE_INTEREST_LABEL[k] }))} />
          <SelectChip label="Rodzaj gabinetu" value={clinicType} onChange={(v) => (setClinicType(v), resetPage())} options={(Object.keys(CLINIC_TYPE_LABEL) as ClinicTypeKey[]).map((k) => ({ value: k, label: CLINIC_TYPE_LABEL[k] }))} />
          <SelectChip label="Źródło" value={source} onChange={(v) => (setSource(v), resetPage())} options={(Object.keys(SOURCE_LABEL) as SourceKey[]).map((k) => ({ value: k, label: SOURCE_LABEL[k] }))} />
          {tab === "KLIENCI" && (
            <>
              <SelectChip
                label="Ryzyko odejścia"
                value={risk}
                onChange={(v) => (setRisk(v), resetPage())}
                options={[
                  { value: "niskie", label: "niskie" },
                  { value: "średnie", label: "spóźnia się" },
                  { value: "wysokie", label: "wysokie" },
                  { value: "brak", label: "za mało danych" },
                ]}
              />
              <Chip active={overdue} onClick={() => (setOverdue(!overdue), resetPage())} title="Minął typowy odstęp od ostatniego wynajmu, a nie ma rezerwacji">
                Po terminie rytmu
              </Chip>
              <Chip active={noStep} onClick={() => (setNoStep(!noStep), resetPage())}>
                Bez następnego kroku
              </Chip>
            </>
          )}
          <SelectChip label="Braki danych" value={gap} onChange={(v) => (setGap(v), resetPage())} options={(Object.keys(GAP_LABEL) as Gap[]).map((k) => ({ value: k, label: GAP_LABEL[k] }))} />
          {trained && (
            <Chip active onClick={() => setTrained(false)}>
              po szkoleniu ✕
            </Chip>
          )}
          {special && (
            <Chip active onClick={() => setSpecial(null)}>
              {SPECIAL_LABEL[special]} ✕
            </Chip>
          )}
          {anyFilter && (
            <button type="button" onClick={clearFilters} className="px-1.5 text-[12.5px] text-[#1B6FA8] hover:text-[#0C3450]">
              wyczyść
            </button>
          )}
          <label className="relative ml-auto flex h-[30px] cursor-pointer items-center rounded-[6px] border border-dashed border-[#A9D2EC] bg-white px-2.5 text-[12.5px] text-[#1B6FA8] hover:border-[#1B6FA8]">
            Zapisane widoki ▾
            <select
              aria-label="Zapisane widoki"
              value=""
              onChange={(e) => e.target.value && applyView(e.target.value as "seasonLs" | "almaTrained" | "noNip" | "resigned")}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="">Zapisane widoki</option>
              <option value="seasonLs">Przed sezonem · LightSheer</option>
              <option value="almaTrained">Alma po szkoleniu ITP</option>
              <option value="noNip">Bez NIP</option>
              <option value="resigned">Zrezygnowali ({resignedRows.length})</option>
            </select>
          </label>
        </div>
      </div>

      {tab === "KLIENCI" && mode === "mapa" ? (
        <MapView rows={visible} canEdit={!agent} todayIso={todayIso} />
      ) : tab === "KLIENCI" && mode === "rytm" ? (
        <RhythmView rows={visible} monthLabels={monthLabels} currentMonth={11} />
      ) : tab === "POTENCJALNI" ? (
        <div className="mt-3">
          <PotentialTable rows={page} total={visible.length} onMore={() => setLimit((l) => l + PAGE)} today={today} canEdit={!agent} onChanged={() => router.refresh()} />
        </div>
      ) : (
        <>
          {/* Pasek akcji zbiorczych — tylko po zaznaczeniu */}
          {selected.size > 0 && (
            <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 bg-[#0C3450] px-3.5 py-2 text-[13px] text-white md:mx-7">
              <span className="font-semibold">Zaznaczono {selected.size}</span>
              <span className="text-[#BFD6EA]">|</span>
              <button type="button" onClick={() => setShowTask(true)} className="underline underline-offset-[3px] hover:text-[#BFD6EA]">
                Zadanie dla Ani
              </button>
              {!agent && (
                <button type="button" onClick={() => void bulkSms()} className="underline underline-offset-[3px] hover:text-[#BFD6EA]">
                  SMS (Wysyłka SMS)
                </button>
              )}
              <button type="button" onClick={bulkMail} className="underline underline-offset-[3px] hover:text-[#BFD6EA]">
                Szkic maila
              </button>
              <button type="button" onClick={() => exportRows(selectedRows, `klienci-zaznaczeni-${todayIso.slice(0, 10)}.csv`)} className="underline underline-offset-[3px] hover:text-[#BFD6EA]">
                Eksport
              </button>
              <button type="button" onClick={() => (setSelected(new Set()), setNote(null))} className="ml-auto text-[#BFD6EA] hover:text-white">
                Odznacz
              </button>
              {note && <div className="basis-full text-[12px] text-[#DCE8F2]">{note}</div>}
            </div>
          )}

          {/* Tabela */}
          <div className={`mx-4 overflow-x-auto border border-[#E4E7EA] bg-white md:mx-7 ${selected.size > 0 ? "border-t-0" : "mt-3"}`}>
            <div className="min-w-[1000px]">
              <div className={`${ROW_GRID} items-end border-b border-[#E4E7EA] px-3.5 pb-2 pt-2.5 text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]`}>
                <Check
                  on={page.length > 0 && page.every((r) => selected.has(r.id))}
                  label="Zaznacz wszystkich na stronie"
                  onChange={() =>
                    setSelected((prev) => {
                      const all = page.every((r) => prev.has(r.id));
                      const n = new Set(prev);
                      for (const r of page) {
                        if (all) n.delete(r.id);
                        else n.add(r.id);
                      }
                      return n;
                    })
                  }
                />
                <span>Klient · status</span>
                <RhythmHelp rows={visible} pastLabel={pastLabel} futureLabel={futureLabel} />
                <span>Urządzenie</span>
                <span>Ostatni → następny</span>
                <span>Następny krok</span>
                <span className="text-right">Akcje</span>
              </div>

              {allRows.length === 0 ? (
                <div className="px-6 py-10 text-center text-[13px] text-[#5C6166]">
                  Baza klientów jest pusta. Zaimportuj klientów z HubSpota w{" "}
                  <Link href="/ustawienia/integracje/hubspot" className="text-[#1B6FA8]">
                    Ustawienia → Integracje → HubSpot
                  </Link>{" "}
                  albo dodaj pierwszego klienta.
                </div>
              ) : page.length === 0 ? (
                <div className="px-6 py-10 text-center text-[13px] text-[#5C6166]">
                  Nikt nie pasuje do tych filtrów.{" "}
                  <button type="button" onClick={clearFilters} className="text-[#1B6FA8]">
                    Wyczyść filtry
                  </button>
                </div>
              ) : (
                page.map((r) => (
                  <ClientRow
                    key={r.id}
                    r={r}
                    today={today}
                    monthLabels={monthLabels}
                    selected={selected.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    onOpen={() => router.push(`/klienci/${r.id}`)}
                    onSms={agent ? null : () => setCard({ id: r.id, intent: "sms" })}
                  />
                ))
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3 text-[12.5px] text-[#5C6166]">
                <span>
                  Pokazano {page.length} z {visible.length}
                  {page.length < visible.length && (
                    <>
                      {" "}
                      <span className="text-[#C3C4C7]">·</span>{" "}
                      <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-[#1B6FA8] hover:text-[#0C3450]">
                        Załaduj kolejne 50
                      </button>
                    </>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {(
                    [
                      ["R", "wynajem"],
                      ["P", "rezerwacja"],
                      ["F", "wg rytmu, bez rezerwacji"],
                      ["E", "brak"],
                    ] as const
                  ).map(([k, l]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <StripCellBox kind={k} />
                      {l}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {card && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Karta klienta">
          <button type="button" aria-label="Zamknij kartę" className="absolute inset-0 bg-black/25" onClick={() => setCard(null)} />
          <div className="relative h-full w-full max-w-[420px] overflow-hidden bg-white shadow-[-8px_0_28px_rgba(0,0,0,0.15)]">
            <ClientCard key={card.id} clientId={card.id} intent={card.intent} onClose={() => setCard(null)} onChanged={() => router.refresh()} />
          </div>
        </div>
      )}
      {showNew && (
        <NewClientDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.push(`/klienci/${id}`);
          }}
        />
      )}
      {showTask && (
        <BulkTaskDialog
          clients={selectedRows.map((r) => ({ id: r.id, name: r.shortName ?? r.name }))}
          onClose={() => setShowTask(false)}
          onDone={(n) => {
            setShowTask(false);
            setNote(<>Utworzono {n} {n === 1 ? "zadanie" : "zadań"}.</>);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

type TodayKey = "afterRental" | "stepSoon" | "unassigned" | "check";

// „▾ szczegóły” przy „Przed sezonem” — stan w localStorage (per przeglądarka).
const SEASON_KEY = "wl_clients_season_details";
const SEASON_EVENT = "wl-season-details";
function readSeasonOpen(): boolean {
  try {
    return localStorage.getItem(SEASON_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSeasonOpen(open: boolean) {
  try {
    localStorage.setItem(SEASON_KEY, open ? "1" : "0");
  } catch {
    // brak localStorage — stan tylko do przeładowania
  }
  window.dispatchEvent(new Event(SEASON_EVENT));
}
function subscribeSeason(cb: () => void) {
  window.addEventListener(SEASON_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SEASON_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
function stripLabels(today: Date) {
  const months = Array.from({ length: 15 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 11 + i, 1));
  const lbl = (d: Date) => `${ROMAN[d.getMonth()]}.${String(d.getFullYear()).slice(2)}`;
  return {
    past: `${lbl(months[0])}–${lbl(months[11])}`,
    future: `${ROMAN[months[12].getMonth()]}–${ROMAN[months[14].getMonth()]}`,
    months: months.map((d) => `${ROMAN[d.getMonth()]}.${d.getFullYear()}`),
  };
}

function rangeLabel(isos: string[]): string {
  const days = isos.map((x) => new Date(x)).sort((a, b) => a.getTime() - b.getTime());
  const a = dm(days[0].toISOString());
  const b = dm(days[days.length - 1].toISOString());
  if (a === b) return a;
  return a.slice(3) === b.slice(3) ? `${a.slice(0, 2)}–${b}` : `${a}–${b}`;
}

function ClientRow({
  r,
  today,
  monthLabels,
  selected,
  onToggle,
  onOpen,
  onSms,
}: {
  r: ClientListRow;
  today: Date;
  monthLabels: string[];
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onSms: (() => void) | null;
}) {
  const name = r.shortName ?? r.name;
  const since =
    r.status === "BYLY" && r.firstSeenAt && r.lastRentalAt
      ? `${new Date(r.firstSeenAt).getFullYear()}–${new Date(r.lastRentalAt).getFullYear()}`
      : r.firstSeenAt
        ? `od ${mY(r.firstSeenAt)}`
        : null;
  const meta = [r.primaryName && r.primaryName !== r.name && r.primaryName !== name ? r.primaryName : null, r.city, since].filter(Boolean).join(" · ");

  // Rytm — podpis pod paskiem.
  const rh = r.rhythm;
  const monthsAgo = r.lastRentalAt ? Math.floor(daysBetween(new Date(r.lastRentalAt), today) / 30.4) : null;
  const rhythmText = rh.days
    ? [`co ${rh.days} dni`, rh.weekday, rh.breakLabel ? `przerwa ${rh.breakLabel}` : null, r.distanceKm && r.distanceKm >= 60 ? `${Math.round(r.distanceKm)} km` : null].filter(Boolean).join(" · ")
    : r.status === "BYLY" && monthsAgo != null
      ? `ostatni wynajem ${monthsAgo} mies. temu`
      : r.rentalsTotal === 1
        ? "1 wynajem"
        : "za mało wynajmów na rytm";
  const dotRisk = rh.days ? rh.risk : r.status === "BYLY" ? "wysokie" : null;

  // Ostatni → następny.
  const nr = r.nextRental;
  const more = r.moreReservations;
  const moreText = more.count
    ? more.count > 3
      ? `+${more.count} do ${dm(more.lastAt!)}${r.deviceChips.length > 1 ? ` (${r.deviceChips.join(", ")})` : ""}`
      : `+${more.count} (${more.dates.map(dm).join(", ")})`
    : null;
  const devicePrefix = nr && !nr.unassigned && r.deviceChips.length > 1 ? nr.device.split(/\s+/)[0] : null;

  // Następny krok.
  const step = r.nextStep;
  const stepDue = step?.dueAt ? new Date(step.dueAt) : null;
  const stepOverdue = stepDue ? daysBetween(stepDue, today) > 0 : false;

  return (
    <div
      onClick={onOpen}
      className={`${ROW_GRID} cursor-pointer items-center border-b border-[#EEF0F2] px-3.5 py-2.5 ${selected ? "bg-[#F3F8FC] shadow-[inset_3px_0_0_#1B6FA8]" : "hover:bg-[#FAFBFC]"}`}
    >
      <Check on={selected} onChange={onToggle} label={`Zaznacz ${name}`} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <Link href={`/klienci/${r.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-[15px] font-semibold leading-[1.25] text-[#0C3450] hover:text-[#1B6FA8]" title={r.name}>
          {name}
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Badge status={r.status} />
          {r.resigned && (
            <span className="flex-none whitespace-nowrap bg-[#FBF0E7] px-[7px] py-px text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B8612F]" title={`Zrezygnował (${RESIGN_REASON_LABEL[r.resigned.reason as ResignReasonKey] ?? r.resigned.reason})${r.resigned.recontactAt ? ` · ponowny kontakt ${new Date(r.resigned.recontactAt).toLocaleDateString("pl-PL")}` : ""}`}>
              zrezygnował
            </span>
          )}
          {r.rhythmHint && r.status !== "POTENCJALNY" && r.status !== "NIE_KONTAKTOWAC" && <span className="flex-none text-[12px] text-[#5C6166]">{r.rhythmHint}</span>}
          <span className="truncate text-[12px] text-[#5C6166]">{meta}</span>
        </div>
        {r.check && (
          <span className="truncate text-[12px] text-[#B8612F]" title={r.check}>
            do sprawdzenia: {r.check}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Strip cells={rh.cells} labels={monthLabels} />
        <div className="flex items-center gap-1.5 truncate text-[12px] text-[#4A4A4A]">
          <RiskDot risk={dotRisk} />
          <span className="truncate">{rhythmText}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {r.deviceChips.length ? (
          r.deviceChips.map((c) => (
            <span key={c} className="bg-[#EAF4FB] px-1.5 py-px text-[12px] text-[#1B6FA8]">
              {c}
            </span>
          ))
        ) : (
          <span className="text-[12px] text-[#767C82]">—</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <span className="truncate leading-tight">
          <span className="text-[12px] text-[#5C6166]">{r.lastRentalAt ? dmSmart(r.lastRentalAt, today) : "—"} → </span>
          {nr ? (
            <span className="text-[13px] font-semibold text-[#1B6FA8]">
              {wd(nr.at)} {dm(nr.at)}
              {nr.time ? ` · ${nr.time}` : ""}
            </span>
          ) : (
            <span className="text-[13px] text-[#767C82]">{r.status === "BYLY" ? "—" : "brak rezerwacji"}</span>
          )}
        </span>
        {nr?.unassigned ? (
          <Link href="/klienci/dopasowania#rezerwacje" onClick={(e) => e.stopPropagation()} className="truncate text-[12px] text-[#B8612F] hover:underline">
            bez klienta – przypisać
          </Link>
        ) : nr ? (
          nr.smsAt || moreText || devicePrefix ? (
            <span className={`truncate text-[12px] ${nr.smsAt ? "font-medium text-[#2F7A68]" : "text-[#767C82]"}`} title={[devicePrefix, nr.smsAt ? `SMS ${dm(nr.smsAt)} ✓` : null, moreText].filter(Boolean).join(" · ")}>
              {[devicePrefix, nr.smsAt ? `SMS ${dm(nr.smsAt)} ✓` : null, moreText].filter(Boolean).join(" · ")}
            </span>
          ) : null
        ) : r.forecastAt && r.status !== "BYLY" ? (
          <span className="text-[12px] text-[#B8612F]">wg rytmu: ok. {dm(r.forecastAt)}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        {step ? (
          <>
            <span className={`truncate text-[13px] leading-tight text-[#2B2B2B] ${step.agent ? "italic" : ""}`} title={step.text}>
              {step.text}
            </span>
            <span className={`truncate text-[12px] ${stepOverdue ? "text-[#B8612F]" : "text-[#5C6166]"}`}>
              {[stepDue ? dm(step.dueAt!) : null, step.person, step.agent ? "propozycja agenta" : null].filter(Boolean).join(" · ")}
            </span>
          </>
        ) : r.status === "NOWY" ? (
          <>
            <Link href={`/klienci/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] font-medium text-[#B8612F] hover:underline">
              nowa klientka bez kolejnego kroku
            </Link>
            {r.lastRentalAt && <span className="text-[12px] text-[#5C6166]">minęło {Math.max(0, daysBetween(new Date(r.lastRentalAt), today))} dni</span>}
          </>
        ) : (
          <Link href={`/klienci/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] text-[#1B6FA8] hover:text-[#0C3450]">
            + ustaw następny krok
          </Link>
        )}
      </div>
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {r.primaryPhone ? (
          <>
            <a
              href={`tel:${r.primaryPhone}`}
              aria-label={`Zadzwoń do ${name}`}
              title={r.primaryPhone}
              className="box-border flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#A9D2EC] text-[10.5px] text-[#1B6FA8] hover:border-[#1B6FA8] hover:bg-[#EAF4FB]"
            >
              tel
            </a>
            {onSms && (
              <button
                type="button"
                aria-label={`Wyślij SMS do ${name}`}
                onClick={onSms}
                className="box-border flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#A9D2EC] bg-white text-[10.5px] text-[#1B6FA8] hover:border-[#1B6FA8] hover:bg-[#EAF4FB]"
              >
                sms
              </button>
            )}
          </>
        ) : (
          <span className="text-[11px] text-[#767C82]">brak tel.</span>
        )}
      </div>
    </div>
  );
}
