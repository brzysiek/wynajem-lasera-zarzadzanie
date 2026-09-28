"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeadRow } from "@/lib/leads/load";
import { LOST_REASON_LABEL, POSTPONE_REASON_LABEL, TYPE_LABEL, type PostponeReasonKey } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadTypeKey } from "@/lib/leads/parse-deal";
import { STATUS_LABEL, type DeviceInterestKey } from "@/lib/clients/labels";
import { FUNNEL_FROM, NEXT_STEP_LABEL, OPEN_STAGES, funnelFromRow, rotInfo, type FunnelLead, type NextStepType } from "@/lib/leads/funnel";
import { Avatar, Seg } from "./funnel-views";
import { StageChip } from "./lead-ui";
import { StageLegend } from "./inbox-view";

// Sygnały → Lista (lejek v2, wzór lejek-v2-wzor.html s3): te same sygnały co
// Tablica, w tabeli — kiedy wpłynęło, etap, ile stoi, następny krok, kim jest
// osoba (Kontakt / Potencjalny / Nowy / Stały…). Filtry zapamiętują się w
// przeglądarce (wygoda użytkownika, bez znaczenia dla danych).

type Period = "30" | "month" | "2026" | "archive";
type Owner = "all" | "ania" | "tomek";
type State = "active" | "all" | "lost" | "postponed";
type Source = "all" | "www" | "phone" | "email";
type Device = "all" | DeviceInterestKey;
type Filters = { period: Period; owner: Owner; state: State; source: Source; device: Device };

const KEY = "wl_leads_list_v2";
const DEFAULTS: Filters = { period: "30", owner: "all", state: "active", source: "all", device: "all" };
const WWW: LeadTypeKey[] = ["POBRANIE_CENNIKA", "KONTAKT", "REZERWACJA_WWW", "SZKOLENIE_WWW"];
const SOURCE_SHORT: Record<LeadTypeKey, string> = {
  POBRANIE_CENNIKA: "WWW cennik",
  KONTAKT: "WWW kontakt",
  REZERWACJA_WWW: "WWW rezerwacja",
  SZKOLENIE_WWW: "WWW szkolenie",
  TELEFON: "Telefon",
  EMAIL: "E-mail",
  OLX: "OLX",
  POLECENIE: "Polecenie",
  INNE: TYPE_LABEL.INNE,
};
const GRID = "70px minmax(0,1.5fr) 100px minmax(0,1fr) 124px 70px minmax(0,1.4fr) 44px 96px";
const dayMs = 86_400_000;
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;

// Oś „kim jest osoba” (lejek v2, 3.1): bez interakcji = Kontakt.
function person(r: LeadRow): { label: string; cls: string } {
  if (!r.clientId || !r.clientQualified) return { label: "Kontakt", cls: "border-[#C9D3DC] text-[#5C6166]" };
  const s = r.clientStatus ?? "POTENCJALNY";
  const cls = s === "POTENCJALNY" ? "border-[#2B5B82] text-[#2B5B82]" : s === "NOWY" || s === "STALY" ? "border-[#2F7A68] text-[#2F7A68]" : "border-[#C9D3DC] text-[#5C6166]";
  return { label: s === "POTENCJALNY" ? "Potencjalny" : STATUS_LABEL[s], cls };
}

function nextStep(r: LeadRow, now: Date): { text: string; late: boolean } {
  if (r.stage === "PRZEGRANA") return { text: r.lostReason ? LOST_REASON_LABEL[r.lostReason].toLowerCase() : "przegrana", late: false };
  if (r.stage === "WYGRANA") return { text: r.rentalStartsAt ? `wynajem ${d2(r.rentalStartsAt)}` : "wygrana", late: false };
  if (r.stage === "ODLOZONE") return { text: `wraca ${r.returnAt ? d2(r.returnAt) : "—"}${r.postponeReason ? ` · ${POSTPONE_REASON_LABEL[r.postponeReason as PostponeReasonKey] ?? r.postponeReason}` : ""}`, late: false };
  if (r.stage === "REZERWACJA") return r.rentalStartsAt ? { text: `wynajem ${d2(r.rentalStartsAt)}`, late: false } : { text: "brak wpisu w kalendarzu", late: true };
  const rot = rotInfo(funnelFromRow(r) as unknown as FunnelLead, now);
  const step = r.nextStepType === "FOLLOW_UP_OFERTY" && r.followUpNo ? `follow-up ${r.followUpNo}` : NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"];
  if (!r.nextActionAt) return { text: "brak kroku", late: true };
  const at = new Date(r.nextActionAt);
  const when = at.toDateString() === now.toDateString() ? `dziś${at.getHours() >= 11 ? ` ${at.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : ""}` : at < now ? "zaległy" : d2(r.nextActionAt);
  if (r.stage === "SYGNAL" && !r.firstContactAt && rot.rotting) return { text: `${step} · po SLA`, late: true };
  return { text: `${step} · ${when}`, late: at < now && at.toDateString() !== now.toDateString() };
}

export function ListView({
  rows,
  archived,
  users,
  now,
  selectedId,
  onOpen,
  onExport,
}: {
  rows: LeadRow[];
  archived: LeadRow[];
  users: { id: string; name: string }[];
  now: Date;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onExport: (rows: LeadRow[]) => void;
}) {
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(80);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Filters>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage dostępny dopiero w przeglądarce
      setF((x) => ({ ...x, ...saved }));
    } catch {
      // brak localStorage — domyślne filtry
    }
  }, []);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setF((x) => {
      const n = { ...x, [k]: v };
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        // filtry tylko do odświeżenia strony
      }
      return n;
    });
  const byName = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ownerId = f.owner === "ania" ? byName("Ania") : f.owner === "tomek" ? byName("Tomek") : null;
  const from = f.period === "30" ? now.getTime() - 30 * dayMs : f.period === "month" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : FUNNEL_FROM.getTime();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const touched = (r: LeadRow) => Math.max(new Date(r.createdAt).getTime(), new Date(r.stageChangedAt).getTime(), r.lastWorkAt ? new Date(r.lastWorkAt).getTime() : 0) >= from;
    const base = f.period === "archive" ? archived : rows.filter((r) => new Date(r.createdAt) >= FUNNEL_FROM && touched(r));
    return base
      .filter((r) => (ownerId ? r.ownerId === ownerId : true))
      .filter((r) =>
        f.state === "active" ? OPEN_STAGES.includes(r.stage) : f.state === "lost" ? r.stage === "PRZEGRANA" : f.state === "postponed" ? r.stage === "ODLOZONE" : true,
      )
      .filter((r) => (f.source === "all" ? true : f.source === "www" ? WWW.includes(r.type) : f.source === "phone" ? r.type === "TELEFON" : r.type === "EMAIL"))
      .filter((r) => (f.device === "all" ? true : r.devices.includes(f.device)))
      .filter((r) => (q.length < 2 ? true : r.search.includes(q) || (digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [rows, archived, f, from, ownerId, query]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Period>
          value={f.period}
          onChange={(v) => set("period", v)}
          options={[
            ["30", "30 dni"],
            ["month", "Ten miesiąc"],
            ["2026", "2026"],
            ["archive", `Archiwum (${archived.length})`],
          ]}
        />
        <Seg<Owner>
          value={f.owner}
          onChange={(v) => set("owner", v)}
          options={[
            ["all", "Wszyscy"],
            ...(byName("Ania") ? ([["ania", "Ania"]] as [Owner, string][]) : []),
            ...(byName("Tomek") ? ([["tomek", "Tomek"]] as [Owner, string][]) : []),
          ]}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj: nazwa, osoba, telefon, e-mail…"
          className="h-[28px] min-w-[200px] flex-grow rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 text-[12.5px] outline-none focus:border-[#1B6FA8] sm:max-w-[300px]"
        />
        <button type="button" onClick={() => onExport(list)} disabled={!list.length} className="ml-auto h-[28px] rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 text-[12px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40">
          CSV
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Seg<State>
          value={f.state}
          onChange={(v) => set("state", v)}
          options={[
            ["active", "Aktywne"],
            ["all", "Wszystkie"],
            ["lost", "Przegrane"],
            ["postponed", "Odłożone"],
          ]}
        />
        <Seg<Source>
          value={f.source}
          onChange={(v) => set("source", v)}
          options={[
            ["all", "Każde źródło"],
            ["www", "WWW"],
            ["phone", "Telefon"],
            ["email", "E-mail"],
          ]}
        />
        <Seg<Device>
          value={f.device}
          onChange={(v) => set("device", v)}
          options={[
            ["all", "Każde urządzenie"],
            ["LIGHTSHEER", "LightSheer"],
            ["ALMA_HARMONY", "Alma"],
            ["OBSERV", "Observ"],
            ["COOLTECH", "Cooltech"],
          ]}
        />
        <span className="ml-auto text-[12px] text-[#5C6166]">
          {list.length} sygnałów · te same co na Tablicy · sort: wpłynęło ↓
        </span>
      </div>

      <div className="overflow-x-auto border border-[#E3E6E9] bg-white">
        <div className="min-w-[1000px]">
          <div className="grid gap-2.5 border-b-[1.5px] border-[#0C3450] px-3.5 py-[7px] text-[10px] uppercase tracking-[0.1em] text-[#5C6166]" style={{ gridTemplateColumns: GRID }}>
            <span>Wpłynęło</span>
            <span>Kontakt</span>
            <span>Źródło</span>
            <span>Pyta o</span>
            <span>Etap</span>
            <span>W etapie</span>
            <span>Następny krok</span>
            <span>Prow.</span>
            <span>Osoba</span>
          </div>
          {list.length === 0 && <div className="px-3.5 py-8 text-center text-[13px] text-[#5C6166]">Nic nie pasuje do filtrów.</div>}
          {list.slice(0, limit).map((r) => {
            const open = OPEN_STAGES.includes(r.stage);
            const rot = open ? rotInfo(funnelFromRow(r) as unknown as FunnelLead, now) : null;
            const inStage = Math.floor((now.getTime() - new Date(r.stageChangedAt).getTime()) / dayMs);
            const step = nextStep(r, now);
            const p = person(r);
            const asks = r.devices.length ? r.devices.map((d) => LEAD_DEVICE_LABEL[d]).join(", ") : (r.message?.slice(0, 40) ?? "–");
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                className={`grid cursor-pointer items-center gap-2.5 border-b border-[#F0F1F2] px-3.5 py-[7px] text-[13px] last:border-0 hover:bg-[#F7F9FB] ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
                style={{ gridTemplateColumns: GRID }}
              >
                <span className="tabular-nums">{d2(r.createdAt)}</span>
                <span className="truncate font-semibold text-[#0C3450]" title={r.title}>
                  {who(r)}
                </span>
                <span className="text-[12.5px]">{SOURCE_SHORT[r.type]}</span>
                <span className="truncate text-[12.5px]" title={asks}>
                  {asks}
                </span>
                <span>
                  <StageChip stage={r.stage} />
                </span>
                <span className={`tabular-nums ${rot?.rotting ? "font-semibold text-[#B8612F]" : ""}`}>{open ? `${inStage} d` : "–"}</span>
                <span className={`truncate text-[12.5px] ${step.late || rot?.rotting ? "font-semibold text-[#B8612F]" : ""}`} title={r.nextStepNote ?? undefined}>
                  {step.text}
                </span>
                <span>
                  <Avatar name={r.ownerName} />
                </span>
                <span>
                  <span className={`inline-block border px-1.5 py-px text-[11px] ${p.cls}`}>{p.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {list.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 80)} className="self-center text-[12.5px] text-[#1B6FA8] hover:underline">
          Pokaż więcej ({list.length - limit})
        </button>
      )}
      <p className="text-[11.5px] text-[#5C6166]">
        „Osoba”: Kontakt = jeszcze bez interakcji (nie ma go w Klientach) · Potencjalny = była rozmowa / mail · Nowy / Stały = po wynajmie. Filtry zapamiętują się w tej przeglądarce.
      </p>
      <StageLegend />
    </div>
  );
}
