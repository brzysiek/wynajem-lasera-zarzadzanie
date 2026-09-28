"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { LeadRow } from "@/lib/leads/load";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL } from "@/lib/leads/parse-deal";
import { formatPhone, type DeviceInterestKey } from "@/lib/clients/labels";
import { REGION_LABEL, computeRegion, type RegionKey } from "@/lib/clients/region";
import { workHoursBetween } from "@/lib/leads/work-time";
import {
  FIRST_CONTACT_SLA_HOURS,
  NEXT_STEP_LABEL,
  NO_ANSWER_LIMIT,
  buildNaDzis,
  callQueue,
  isOverdue,
  naDzisKpis,
  workDurationLabel,
  type FunnelLead,
  type NextStepType,
} from "@/lib/leads/funnel";
import type { CardIntent } from "./lead-card";

// Sygnały → Na dziś (wzór lejek-wzor.html, s1) i Do obdzwonienia (s3).
// Reguły: src/lib/leads/funnel.ts. Skala i tokeny jak na karcie klienta.

export type LinkSuggestion = { id: string; startsAt: string; title: string; deviceName: string; clientId: string | null };
type Row = LeadRow & FunnelLead;

const LBL = "text-[10px] uppercase tracking-[0.12em] text-[#5C6166]";
const BTN_SM = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]";
const BTN_SM_PRI = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#1B6FA8] bg-[#1B6FA8] px-[9px] text-[12px] text-white hover:bg-[#0C3450]";

export function toFunnel(rows: LeadRow[]): Row[] {
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
    firstContactAt: r.firstContactAt ? new Date(r.firstContactAt) : null,
    lastContactAt: r.lastContactAt ? new Date(r.lastContactAt) : null,
    stageChangedAt: new Date(r.stageChangedAt),
    nextActionAt: r.nextActionAt ? new Date(r.nextActionAt) : null,
    lastWorkAt: r.lastWorkAt ? new Date(r.lastWorkAt) : null,
    returnAt: r.returnAt ? new Date(r.returnAt) : null,
  })) as unknown as Row[];
}

// Wiersze trzymają daty jako Date (funnel), a komponenty — ISO z LeadRow;
// tu tylko pomocnicze formatowanie.
const dayMs = 86_400_000;
const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const hm = (d: Date) => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

function dueLabel(at: Date | null, now: Date): { text: string; tone: "late" | "today" | "" } {
  if (!at) return { text: "—", tone: "" };
  if (at < now) {
    const days = Math.floor((now.getTime() - at.getTime()) / dayMs);
    return { text: days >= 1 ? `zaległe ${days} ${days === 1 ? "dzień" : "dni"}` : `zaległe od ${hm(at)}`, tone: "late" };
  }
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? { text: at.getHours() > 10 || at.getMinutes() ? `dziś ${hm(at)}` : "dziś", tone: "today" } : { text: `${d2(at)} ${hm(at)}`, tone: "" };
}

function Due({ at, now }: { at: Date | null; now: Date }) {
  const d = dueLabel(at, now);
  return <span className={`text-[12px] tabular-nums ${d.tone === "late" ? "font-semibold text-[#B8612F]" : d.tone === "today" ? "font-semibold text-[#1B6FA8]" : "text-[#5C6166]"}`}>{d.text}</span>;
}

export function Avatar({ name }: { name: string | null }) {
  return (
    <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#2B5B82] text-[10.5px] font-semibold text-white" title={name ?? "bez prowadzącej"}>
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Dots({ attempts }: { attempts: number }) {
  return (
    <span className="tracking-[2px] text-[#E08A5C]" title={`${attempts} ${attempts === 1 ? "próba" : "próby"} bez odebrania`}>
      {Array.from({ length: NO_ANSWER_LIMIT }, (_, i) => (i < attempts ? "●" : "○")).join("")}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block bg-[#EAF4FB] px-[7px] py-px text-[11.5px] text-[#0C3450]">{children}</span>;
}

const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;

function devicesLabel(r: LeadRow): string | null {
  if (!r.devices.length) return null;
  return `${r.devices.map((d) => LEAD_DEVICE_LABEL[d]).join(" + ")}${r.requestedDays ? ` ${r.requestedDays} ${r.requestedDays === 1 ? "dzień" : "dni"}` : ""}`;
}

function H2({ children, tag }: { children: ReactNode; tag?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="m-0 inline-block border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold text-[#0C3450]">{children}</h2>
      {tag}
    </div>
  );
}

function Tag({ tone, children }: { tone: "warn" | "grey" | "ok"; children: ReactNode }) {
  const cls = tone === "warn" ? "border border-[#E6CDB8] bg-[#FBF0E7] text-[#B8612F]" : tone === "ok" ? "bg-[#EEF6F2] text-[#2F7A68]" : "bg-[#EEF0F2] text-[#5C6166]";
  return <span className={`inline-block px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] ${cls}`}>{children}</span>;
}

export function KpiBand({ items }: { items: { label: string; value: string; sub: string; warn?: boolean }[] }) {
  return (
    <div className="grid bg-[#EAF4FB]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((k) => (
        <div key={k.label} className="border-r border-[#D4E6F3] px-3.5 py-2.5 last:border-0">
          <span className={LBL}>{k.label}</span>
          <div className={`text-[20px] font-medium leading-[1.2] tabular-nums ${k.warn ? "text-[#B8612F]" : "text-[#0C3450]"}`}>{k.value}</div>
          <small className="block text-[11.5px] text-[#5C6166]">{k.sub}</small>
        </div>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="inline-flex overflow-hidden rounded-[6px] border border-[#C9D3DC] bg-white text-[12px]">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={`border-r border-[#E3E6E9] px-2.5 py-1 last:border-0 ${value === k ? "bg-[#0C3450] text-white" : "text-[#2A3540] hover:bg-[#F4F6F8]"}`}>
          {label}
        </button>
      ))}
    </span>
  );
}

function Actions({ r, readOnly, onOpen }: { r: LeadRow; readOnly: boolean; onOpen: (id: string, intent?: CardIntent) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {!readOnly && r.phone && (
        <a href={`tel:${r.phone}`} onClick={() => onOpen(r.id, "call")} className={BTN_SM}>
          Zadzwoń
        </a>
      )}
      {!readOnly && r.phone && (
        <button type="button" onClick={() => onOpen(r.id, "sms")} className={BTN_SM}>
          SMS
        </button>
      )}
      <button type="button" onClick={() => onOpen(r.id)} className={BTN_SM}>
        Otwórz
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Na dziś

type Owner = "me" | "ania" | "tomek" | "all";

export function NaDzisView({
  rows,
  now,
  users,
  currentUserId,
  selectedId,
  readOnly,
  suggestions,
  onOpen,
  onLink,
}: {
  rows: LeadRow[];
  now: Date;
  users: { id: string; name: string }[];
  currentUserId: string;
  selectedId: string | null;
  readOnly: boolean;
  suggestions: Record<string, LinkSuggestion>;
  onOpen: (id: string, intent?: CardIntent) => void;
  onLink: (leadId: string, rentalId: string) => void;
}) {
  const [owner, setOwner] = useState<Owner>("me");
  const byName = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ownerId = owner === "me" ? currentUserId : owner === "ania" ? byName("Ania") : owner === "tomek" ? byName("Tomek") : null;
  const all = useMemo(() => toFunnel(rows), [rows]);
  const mine = owner === "all" ? all : all.filter((r) => r.ownerId === ownerId);
  const d = buildNaDzis(mine, now);
  const k = naDzisKpis(mine, now);
  const row = (id: string) => rows.find((x) => x.id === id)!;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Owner>
          value={owner}
          onChange={setOwner}
          options={[
            ["me", "Moje"],
            ...(byName("Ania") ? ([["ania", "Ania"]] as [Owner, string][]) : []),
            ...(byName("Tomek") ? ([["tomek", "Tomek"]] as [Owner, string][]) : []),
            ["all", "Wszyscy"],
          ]}
        />
      </div>
      <KpiBand
        items={[
          { label: "Zaległe", value: String(k.overdue), sub: "następny krok po terminie", warn: k.overdue > 0 },
          { label: "Na dziś", value: String(k.today), sub: "telefony i follow-upy" },
          { label: "Nowe · 30 dni", value: String(k.new30), sub: `${k.new30NoContact} bez kontaktu` },
          { label: "Czas do 1. kontaktu", value: workDurationLabel(k.medianFirstContact), sub: `mediana z czekającymi · cel ${FIRST_CONTACT_SLA_HOURS} h rob.`, warn: (k.medianFirstContact ?? 0) > FIRST_CONTACT_SLA_HOURS },
          { label: "Oferty bez odpowiedzi", value: String(k.offersNoAnswer), sub: "> 3 dni rob. od wysłania" },
          { label: "Konwersja · 90 dni", value: k.conversion90 == null ? "—" : `${Math.round(k.conversion90 * 100)}%`, sub: "sygnał → rezerwacja" },
        ]}
      />

      <section>
        <H2 tag={k.overdue > 0 ? <Tag tone="warn">{k.overdue} zaległych</Tag> : undefined}>Zaległe i na dziś</H2>
        {d.due.length === 0 ? (
          <p className="border border-[#E3E6E9] bg-white px-4 py-3 text-[13px] text-[#5C6166]">Brak kroków na dziś — wszystko w terminie.</p>
        ) : (
          <div className="border border-[#E3E6E9] bg-white">
            {d.due.map((f) => {
              const r = row(f.id);
              const inStage = Math.max(0, Math.floor((now.getTime() - f.stageChangedAt.getTime()) / dayMs));
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                  className={`grid cursor-pointer items-center gap-3 border-b border-[#F0F1F2] px-3.5 py-[9px] last:border-0 hover:bg-[#F7F9FB] ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
                  style={{ gridTemplateColumns: "22px minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.1fr) 130px auto" }}
                >
                  <Avatar name={r.ownerName} />
                  <div className="min-w-0">
                    <span className="font-semibold text-[#0C3450]">{who(r)}</span> {devicesLabel(r) && <Chip>{devicesLabel(r)}</Chip>}
                    <div className="truncate text-[12px] text-[#5C6166]">
                      {STAGE_LABEL[r.stage]} {d2(f.stageChangedAt)}
                      {r.followUpNo ? ` · follow-up ${r.followUpNo} z 2` : ""}
                      {r.attempts ? ` · nie odebrała ${r.attempts}×` : ""}
                    </div>
                  </div>
                  <div className="truncate text-[12px] text-[#5C6166]" title={r.nextStepNote ?? undefined}>
                    {r.nextStepNote ?? NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"]}
                  </div>
                  <div className="text-[12px] text-[#5C6166]">
                    {STAGE_LABEL[r.stage]} · {inStage} {inStage === 1 ? "dzień" : "dni"} w etapie
                  </div>
                  <Due at={f.nextActionAt} now={now} />
                  <Actions r={r} readOnly={readOnly} onOpen={onOpen} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <section>
          <H2 tag={<Tag tone="grey">cel {FIRST_CONTACT_SLA_HOURS} h rob.</Tag>}>Nowe – czekają na pierwszy kontakt</H2>
          {d.fresh.length === 0 ? (
            <p className="border border-[#E3E6E9] bg-white px-4 py-3 text-[13px] text-[#5C6166]">Brak nowych sygnałów bez kontaktu z ostatnich 30 dni.</p>
          ) : (
            <div className="border border-[#E3E6E9] bg-white">
              {d.fresh.map((f) => {
                const r = row(f.id);
                const waited = workHoursBetween(f.createdAt, now);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                    className={`grid cursor-pointer items-center gap-3 border-b border-[#F0F1F2] px-3.5 py-[9px] last:border-0 hover:bg-[#F7F9FB] ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
                    style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) 90px auto" }}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[#0C3450]">{who(r)}</span>
                      <div className="truncate text-[12px] text-[#5C6166]">
                        {TYPE_LABEL[r.type]}
                        {r.phone ? ` · ${formatPhone(r.phone)}` : " · brak telefonu"}
                      </div>
                    </div>
                    <div className="truncate text-[12px] text-[#5C6166]">{r.city ?? (r.clientQualified ? "w bazie klientów" : "nowa w bazie")}</div>
                    <span className={`text-[12px] font-semibold tabular-nums ${waited > FIRST_CONTACT_SLA_HOURS ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{workDurationLabel(waited)}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      {!readOnly && r.phone ? (
                        <a href={`tel:${r.phone}`} onClick={() => onOpen(r.id, "call")} className={BTN_SM_PRI}>
                          Zadzwoń
                        </a>
                      ) : (
                        <button type="button" onClick={() => onOpen(r.id)} className={BTN_SM}>
                          Otwórz
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <H2 tag={d.toLink.length ? <Tag tone="warn">bez wynajmu</Tag> : undefined}>Rezerwacje i wygrane do spięcia z kalendarzem</H2>
          {d.toLink.length === 0 ? (
            <p className="border border-[#E3E6E9] bg-white px-4 py-3 text-[13px] text-[#5C6166]">Każda rezerwacja i wygrana ma wynajem w kalendarzu.</p>
          ) : (
            <div className="border border-[#E3E6E9] bg-white">
              {d.toLink.map((f) => {
                const r = row(f.id);
                const s = suggestions[r.id];
                return (
                  <div
                    key={r.id}
                    className="grid items-center gap-3 border-b border-[#F0F1F2] px-3.5 py-[9px] last:border-0"
                    style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) auto" }}
                  >
                    <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 text-left">
                      <span className="font-semibold text-[#0C3450] hover:underline">{who(r)}</span>
                      {r.stage === "WYGRANA" && <span className="ml-2 text-[11px] text-[#2F7A68]">wygrana</span>}
                      <div className="truncate text-[12px] text-[#5C6166]">
                        {[devicesLabel(r), r.requestedFrom ? d2(new Date(r.requestedFrom)) : null, r.city].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                    <div className="text-[12px] text-[#5C6166]">
                      {s ? `w kalendarzu: „${s.title}” ${d2(new Date(s.startsAt))} · ${s.deviceName}${s.clientId ? "" : " (bez klienta)"}` : "brak wynajmu"}
                    </div>
                    {readOnly ? null : s ? (
                      <button type="button" className={BTN_SM} onClick={() => onLink(r.id, s.id)}>
                        Powiąż z wynajmem
                      </button>
                    ) : (
                      <Link
                        href={`/kalendarz/wynajem/nowy?${new URLSearchParams({ ...(r.requestedFrom ? { date: r.requestedFrom.slice(0, 10) } : {}), sygnal: r.id }).toString()}`}
                        className={BTN_SM}
                      >
                        Utwórz rezerwację
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Do obdzwonienia

const CALL_DEVICES: (DeviceInterestKey | "")[] = ["", "LIGHTSHEER", "ALMA_HARMONY", "COOLTECH", "RESURFX", "OBSERV"];

export function CallsView({
  rows,
  now,
  selectedId,
  readOnly,
  callStats,
  onOpen,
}: {
  rows: LeadRow[];
  now: Date;
  selectedId: string | null;
  readOnly: boolean;
  callStats: { talked: number; noAnswer: number };
  onOpen: (id: string, intent?: CardIntent) => void;
}) {
  const [device, setDevice] = useState<DeviceInterestKey | "">("");
  const [region, setRegion] = useState<RegionKey | "">("");
  const all = useMemo(() => toFunnel(rows), [rows]);
  const queue = useMemo(() => callQueue(all, now), [all, now]);
  const regionOf = (r: LeadRow) => computeRegion(null, r.city);
  const visible = queue.filter((r) => (!device || r.devices.includes(device)) && (!region || regionOf(r) === region));
  const regions = [...new Set(queue.map(regionOf))].sort();

  return (
    <div className="flex flex-col gap-3">
      <KpiBand
        items={[
          { label: "W kolejce", value: String(queue.length), sub: "2026, bez kontaktu lub krok ≤ dziś" },
          { label: "Dziś obdzwoniono", value: String(callStats.talked + callStats.noAnswer), sub: `${callStats.talked} rozmów · ${callStats.noAnswer} nie odebrało` },
          { label: "Po 3 próbach", value: String(queue.filter((r) => r.attempts >= NO_ANSWER_LIMIT).length), sub: "SMS + propozycja przegranej", warn: queue.some((r) => r.attempts >= NO_ANSWER_LIMIT) },
          { label: "Bez telefonu", value: String(queue.filter((r) => !r.phone).length), sub: "tylko e-mail → szkic" },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Seg<DeviceInterestKey | ""> value={device} onChange={setDevice} options={CALL_DEVICES.map((k) => [k, k ? LEAD_DEVICE_LABEL[k] : "Każde urządzenie"])} />
        <Seg<RegionKey | ""> value={region} onChange={setRegion} options={[["", "Każdy region"], ...regions.map((k): [RegionKey, string] => [k, REGION_LABEL[k]])]} />
        <span className="text-[12px] text-[#5C6166]">{visible.length} do obdzwonienia</span>
      </div>
      {visible.length === 0 ? (
        <div className="border border-[#E3E6E9] bg-white px-6 py-8 text-center text-[13px] text-[#5C6166]">Kolejka pusta — wszystko obdzwonione.</div>
      ) : (
        <div className="border border-[#E3E6E9] bg-white">
          {visible.map((f, i) => {
            const r = f as unknown as LeadRow & FunnelLead;
            const overdue = isOverdue(f, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                className={`grid cursor-pointer items-center gap-3 border-b border-[#F0F1F2] px-3.5 py-[9px] last:border-0 hover:bg-[#F7F9FB] ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
                style={{ gridTemplateColumns: "28px minmax(0,1.5fr) minmax(0,1fr) 64px 120px auto" }}
              >
                <b className="text-[#5C6166] tabular-nums">{i + 1}</b>
                <div className="min-w-0">
                  <span className="font-semibold text-[#0C3450]">{who(r)}</span> {devicesLabel(r) && <Chip>{devicesLabel(r)}</Chip>}
                  <div className="truncate text-[12px] text-[#5C6166]">
                    {TYPE_LABEL[r.type]} {d2(f.createdAt)}
                    {r.phone ? ` · ${formatPhone(r.phone)}` : " · brak telefonu"}
                    {r.city ? ` · ${r.city}` : ""}
                  </div>
                </div>
                <div className="truncate text-[12px] text-[#5C6166]">{f.firstContactAt ? (r.nextStepNote ?? NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"]) : "brak kontaktu"}</div>
                <Dots attempts={r.attempts} />
                <span className={`text-[12px] font-semibold tabular-nums ${overdue ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>
                  {r.attempts >= NO_ANSWER_LIMIT - 1 && r.attempts > 0 ? `${r.attempts + 1}. próba ` : ""}
                  {overdue ? "zaległe" : "dziś"}
                </span>
                <span onClick={(e) => e.stopPropagation()}>
                  {!readOnly && r.phone ? (
                    <a href={`tel:${r.phone}`} onClick={() => onOpen(r.id, "call")} className={BTN_SM_PRI}>
                      Zadzwoń
                    </a>
                  ) : (
                    <button type="button" onClick={() => onOpen(r.id)} className={BTN_SM}>
                      Otwórz
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11.5px] text-[#5C6166]">
        Kropki = próby kontaktu (maks. {NO_ANSWER_LIMIT}). Kolejność: zaległe → rezerwacje WWW → formularze → pobrania cennika; w grupie od najnowszych.
      </p>
    </div>
  );
}

