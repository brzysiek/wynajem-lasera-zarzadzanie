"use client";

import { useContext, useMemo, useState, type ReactNode } from "react";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { cardQuality } from "@/lib/clients/card-quality";
import { AgentModeContext, INPUT, api } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY, FilterLink, LABEL, LINK, Missing, Quote, Section, dm, dmy, money, num } from "./kit";
import { agreedTotal } from "./card-terms";

// Prawa kolumna karty wg projektu Main.dc.html: Następny krok (blok na górze),
// Rytm współpracy, Szanse sprzedaży (kafle), Oś zdarzeń. Pod spodem, w
// osobnym rzędzie karty: Faktury i płatności (sekcja kremowa, na równi z
// Warunkami handlowymi po lewej) i Jakość danych.

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const GRID = { gridTemplateColumns: "56px repeat(12, minmax(0, 1fr))" };

// ------------------------------------------------------------------ Rytm współpracy

function RhythmSection({ d }: { d: ClientDetail }) {
  const r = d.rhythm;
  const dc = r.deviceConfig;
  const risk = r.churnRisk;
  const price = agreedTotal(d).total;
  const year = new Date().getFullYear();
  // Bez ceny ustalonej: średnia z tegorocznych wynajmów i faktur z kwotą.
  const withAmount = d.transactions.filter((t) => new Date(t.date).getFullYear() === year && t.net);
  const avgInvoice = withAmount.length ? withAmount.reduce((s, t) => s + (t.net ?? 0), 0) / withAmount.length : null;
  return (
    <Section id="rytm" title="Rytm współpracy" gap="gap-3" action={<Legend />}>
      {r.grid.length === 0 ? (
        <p className="text-[13px] text-[#5C6166]">Brak wynajmów — rytm pojawi się po pierwszych rezerwacjach.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-[560px] flex-col gap-1">
            <div className="grid gap-1 text-[11px] tracking-[0.12em] text-[#767C82]" style={GRID}>
              <span />
              {ROMAN.map((m) => (
                <span key={m} className="text-center">
                  {m}
                </span>
              ))}
            </div>
            {r.grid.map((g) => (
              <div key={g.year} className="grid items-center gap-1" style={GRID}>
                <span className="text-[13px] text-[#5C6166]">{g.year}</span>
                {g.months.map((m, i) => {
                  const count = m.realized + m.planned + m.proposed;
                  const cls =
                    m.realized > 0
                      ? "bg-[#1B6FA8] text-white"
                      : m.planned > 0
                        ? "border-2 border-[#1B6FA8] bg-white text-[#1B6FA8]"
                        : m.proposed > 0
                          ? "border-2 border-dashed border-[#E08A5C] bg-white text-[#B8612F]"
                          : "bg-[#F4F5F6]";
                  const title = [m.realized ? `zrealizowane: ${m.realized}` : null, m.planned ? `zaplanowane: ${m.planned}` : null, m.proposed ? "proponowany termin" : null].filter(Boolean).join(", ");
                  return (
                    <div key={i} title={title || undefined} className={`box-border flex h-6 items-center justify-center text-[11px] font-medium ${cls}`}>
                      {count > 1 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-[#E4E7EA] pt-3 md:grid-cols-4">
        <Stat
          label="Urządzenie"
          value={dc ? `${dc.family}${dc.heads ? ` · ${dc.heads} ${dc.heads === 1 ? "głowica" : "głowice"}` : ""}` : "—"}
          sub={dc ? (dc.models.length > 1 ? dc.models.map((m) => `${m.name} ${m.count}×`).join(" · ") : `${dc.models[0]?.count ?? 0}× wynajem`) : null}
        />
        <Stat label="Czas" value={d.cardFacts.typicalDays ? `${d.cardFacts.typicalDays} ${d.cardFacts.typicalDays === 1 ? "dzień" : "dni"}` : "—"} sub="wg rezerwacji w panelu" />
        <Stat
          label={price ? "Cena ustalona" : `Cena (${year})`}
          value={price ? `${money(price)} netto` : avgInvoice ? `≈ ${money(Math.round(avgInvoice))} netto` : "—"}
          sub={price ? (d.transportPriceNet ? "wynajem + transport" : "wynajem (bez transportu)") : avgInvoice ? "średnia z wynajmów i faktur" : "brak kwot w tym roku"}
        />
        <Stat
          label="Ryzyko odejścia"
          value={risk ? `● ${risk.level}` : "—"}
          valueClass={risk ? (risk.level === "niskie" ? "font-semibold text-[#2F7A68]" : "font-semibold text-[#B8612F]") : undefined}
          sub={r.lastPlannedAt ? `terminy zajęte do ${dm(r.lastPlannedAt)}` : risk ? `ostatni wynajem ${dm(risk.lastAt)}` : "za mało wynajmów"}
        />
      </div>
    </Section>
  );
}

function Legend() {
  const box = "box-border h-3 w-3";
  return (
    <div className="hidden gap-[18px] text-[12.5px] text-[#4A4A4A] sm:flex">
      <span className="flex items-center gap-1.5">
        <span className={`${box} bg-[#1B6FA8]`} />
        zrealizowany
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`${box} border-2 border-[#1B6FA8]`} />
        zaplanowany
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`${box} border-2 border-dashed border-[#E08A5C]`} />
        proponowany
      </span>
    </div>
  );
}

function Stat({ label, value, sub, valueClass = "font-medium text-[#1B6FA8]" }: { label: string; value: string; sub?: string | null; valueClass?: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className={`text-[14px] ${valueClass}`}>{value}</div>
      {sub && <div className="text-[12.5px] text-[#5C6166]">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Szanse sprzedaży (kafle)

const STAGES = [
  { value: "pomysl", label: "pomysł" },
  { value: "rozmowa", label: "rozmowa" },
  { value: "oferta", label: "oferta" },
  { value: "decyzja", label: "czeka na decyzję" },
  { value: "wygrana", label: "wygrana" },
  { value: "przegrana", label: "przegrana" },
];
const CHANCES: Record<string, string> = { wysoka: "wysoka", srednia: "średnia", niska: "niska", sprawdzic: "sprawdzić" };
const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;

function Tile({ no, label, title, children, actions }: { no: number; label: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-[#EAF4FB] p-[22px]">
      <div className="text-[12px] uppercase tracking-[0.16em] text-[#82B7DA]">
        {String(no).padStart(2, "0")} · {label}
      </div>
      <div className="card-display text-[15px] font-medium text-[#1B6FA8]">{title}</div>
      <div className="text-[13px] leading-[1.5] text-[#4A4A4A]">{children}</div>
      {actions}
    </div>
  );
}

function OpportunitiesSection({ d, onChanged, notify }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ device: "", stage: "rozmowa", chance: "", returnAt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const open = d.opportunities.filter((o) => !o.closedAt);
  const review = d.profile.googleReview;
  const showReview = !!review?.askedAt && review.given !== true;

  async function save() {
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/opportunities`, "POST", f);
    setBusy(false);
    if (!ok) return notify(data.message ?? "Nie udało się dodać szansy.", true);
    setAdding(false);
    setF({ device: "", stage: "rozmowa", chance: "", returnAt: "", note: "" });
    onChanged(data.detail);
  }
  async function close(id: string, stage: "wygrana" | "przegrana") {
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/opportunities/${id}`, "PATCH", { stage });
    if (!ok) return notify(data.message ?? "Nie udało się zamknąć szansy.", true);
    onChanged(data.detail);
  }

  return (
    <Section
      title="Szanse sprzedaży"
      gap="gap-4"
      action={
        !agent &&
        !adding && (
          <button type="button" onClick={() => setAdding(true)} className={LINK}>
            + dodaj szansę
          </button>
        )
      }
    >
      {adding && (
        <div className="flex flex-col gap-2 border border-[#A9D2EC] bg-white p-4">
          <input className={INPUT} placeholder="Urządzenie / temat, np. Cooltech – modelowanie ciała" value={f.device} onChange={(e) => setF({ ...f, device: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <select className={INPUT} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
              {STAGES.slice(0, 4).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select className={INPUT} value={f.chance} onChange={(e) => setF({ ...f, chance: e.target.value })}>
              <option value="">szansa…</option>
              {Object.entries(CHANCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input className={INPUT} type="date" title="Wrócić" value={f.returnAt} onChange={(e) => setF({ ...f, returnAt: e.target.value })} />
          </div>
          <textarea className="w-full border border-[#C3C4C7] px-3 py-2 text-[13px] outline-none focus:border-[#1B6FA8]" rows={2} placeholder="Opis" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <div className="flex justify-end gap-2.5">
            <button type="button" className={BTN_OUTLINE} onClick={() => setAdding(false)}>
              Anuluj
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !f.device.trim()} onClick={() => void save()}>
              Dodaj
            </button>
          </div>
        </div>
      )}
      {open.length === 0 && !showReview && !adding ? (
        <p className="text-[13px] text-[#5C6166]">Brak otwartych szans.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {open.map((o, i) => (
            <Tile
              key={o.id}
              no={i + 1}
              label={o.chance ? CHANCES[o.chance] ?? o.chance : stageLabel(o.stage)}
              title={o.device}
              actions={
                !agent && (
                  <div className="flex gap-4 pt-1 text-[12.5px]">
                    <button type="button" className="text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => void close(o.id, "wygrana")}>
                      wygrana
                    </button>
                    <button type="button" className="text-[#767C82] hover:text-[#B8612F]" onClick={() => void close(o.id, "przegrana")}>
                      zamknij
                    </button>
                  </div>
                )
              }
            >
              {[o.note, o.lastContact ? `Ostatni kontakt ${dmy(o.lastContact)}.` : null, o.returnAt ? `Wrócić ${dmy(o.returnAt)}.` : null].filter(Boolean).join(" ") || stageLabel(o.stage)}
            </Tile>
          ))}
          {showReview && (
            <Tile no={open.length + 1} label="sprawdzić" title="Opinia w Google">
              Prośba wysłana {dmy(review!.askedAt)}. {review!.given === false ? "Nie wystawiła." : "Nie wiadomo, czy wystawiła."}
            </Tile>
          )}
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Oś zdarzeń

type Filter = "all" | "rentals" | "invoices" | "comm" | "notes";
type Item = { key: string; at: string; title: string; sub: string | null; tag: string; dot: "filled" | "outline"; color: string; group: Exclude<Filter, "all">; item?: ClientHistoryItem; hidden?: string | null };

const HIDDEN_LABEL: Record<string, string> = { ENGINEERING: "ukryty · inżynieria", EXCLUDED: "ukryty · wykluczona", MANUAL: "ukryty" };
const BLUE = "#1B6FA8";
const TERRA = "#E08A5C";
const GREY = "#767C82";

function timelineItems(d: ClientDetail, withHidden = false): Item[] {
  const out: Item[] = [];
  // Adnotacje: „Pierwszy wynajem”, „pierwszy po przerwie” (odstęp > 2,5 × rytm).
  const realizedAt = d.history
    .filter((h) => (h.kind === "rental" && !h.deleted && !h.upcoming && h.eventType === "WYNAJEM") || (h.kind === "history" && h.eventType === "WYNAJEM"))
    .map((h) => h.at)
    .sort();
  const note = (iso: string): string | null => {
    const i = realizedAt.indexOf(iso);
    if (i === 0) return "first";
    const rhythm = d.rhythm.rhythmDays;
    if (i > 0 && rhythm && (new Date(iso).getTime() - new Date(realizedAt[i - 1]).getTime()) / 86_400_000 > 2.5 * rhythm) return "break";
    return null;
  };
  const realizedTitle = (iso: string, device: string) => {
    const n = note(iso);
    return n === "first" ? `Pierwszy wynajem · ${device}` : n === "break" ? `Wynajem zrealizowany · pierwszy po przerwie · ${device}` : `Wynajem zrealizowany · ${device}`;
  };
  const invByNumber = new Map(d.transactions.filter((t) => t.invoice).map((t) => [t.invoice!.number, t]));
  for (const h of withHidden ? [...d.history, ...d.hiddenThreads] : d.history) {
    if (h.kind === "rental") {
      if (h.deleted) continue;
      const planned = h.upcoming;
      out.push({
        key: `r-${h.id}`,
        at: h.at,
        title: planned ? `Rezerwacja${h.time ? ` ${h.time}` : ""} · ${h.deviceName}` : h.eventType === "SZKOLENIE" ? `Szkolenie · ${h.deviceName}` : realizedTitle(h.at, h.deviceName),
        sub: [planned && !h.time ? "godz. do ustalenia" : null, h.totalNet ? `${money(h.totalNet)} netto` : null, planned ? null : h.settled ? "rozliczony" : null].filter(Boolean).join(" · ") || null,
        tag: planned ? "zaplanowany" : "wynajem",
        dot: planned ? "outline" : "filled",
        color: BLUE,
        group: "rentals",
        item: h,
      });
    } else if (h.kind === "history") {
      out.push({ key: `h-${h.id}`, at: h.at, title: h.eventType === "SZKOLENIE" ? `Szkolenie · ${h.deviceName}` : realizedTitle(h.at, h.deviceName), sub: `z kalendarza: ${h.title}`, tag: "wynajem", dot: "filled", color: BLUE, group: "rentals" });
    } else if (h.kind === "invoice") {
      const tx = invByNumber.get(h.number);
      out.push({
        key: `i-${h.id}`,
        at: h.at,
        title: `FV ${h.number}`,
        sub: [`${money(h.totalNet, 2)} netto`, tx?.invoice?.totalGross ? `${money(tx.invoice.totalGross, 2)} brutto` : null, tx ? tx.status.label.charAt(0).toLowerCase() + tx.status.label.slice(1) : null].filter(Boolean).join(" / "),
        tag: "faktura",
        dot: "filled",
        color: TERRA,
        group: "invoices",
      });
    } else if (h.kind === "email") {
      out.push({
        key: `e-${h.id}`,
        at: h.at,
        title: `Mail: ${h.subject ?? "(bez tematu)"}`,
        sub: h.snippet ? `„${h.snippet.slice(0, 110)}${h.snippet.length > 110 ? "…" : ""}”` : null,
        tag: h.hidden ? HIDDEN_LABEL[h.hidden] ?? "ukryty" : "mail",
        dot: h.hidden ? "outline" : "filled",
        color: GREY,
        group: "comm",
        item: h,
        hidden: h.hidden ?? null,
      });
    } else if (h.kind === "message") {
      out.push({ key: `m-${h.id}`, at: h.at, title: `${h.channel === "SMS" ? "SMS" : "E-mail z panelu"}${h.failed ? " (nie wysłano)" : ""}`, sub: h.body.slice(0, 120), tag: h.channel === "SMS" ? "sms" : "mail", dot: "filled", color: GREY, group: "comm", item: h });
    } else if (h.kind === "activity") {
      out.push({
        key: `a-${h.id}`,
        at: h.at,
        title: h.type === "NOTE" ? "Notatka" : h.type === "CALL" ? "Rozmowa telefoniczna" : "Nieodebrane połączenie",
        sub: [h.body, h.userName].filter(Boolean).join(" — ") || null,
        tag: h.type === "NOTE" ? "notatka" : "rozmowa",
        dot: "outline",
        color: GREY,
        group: "notes",
        item: h,
      });
    }
  }
  for (const t of d.tasks) {
    out.push({
      key: `t-${t.id}`,
      at: t.dueDate ?? t.createdAt,
      title: `Zadanie: ${t.title}`,
      sub: [t.assigneeName, t.status === "DONE" ? `wykonane${t.completedAt ? ` ${dm(t.completedAt)}` : ""}` : t.dueDate ? `termin ${dm(t.dueDate)}` : "otwarte"].filter(Boolean).join(" · "),
      tag: "zadanie",
      dot: "outline",
      color: GREY,
      group: "notes",
    });
  }
  for (const o of d.opportunities) {
    out.push({ key: `o-${o.id}`, at: o.lastContact ?? o.createdAt, title: o.device, sub: o.note, tag: "szansa", dot: "outline", color: TERRA, group: "notes" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

function TimelineSection({ d, onChanged, notify, onOpenItem, onShowAll }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void; onOpenItem: (h: ClientHistoryItem) => void; onShowAll: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(10);
  const [showHidden, setShowHidden] = useState(false);
  const agent = useContext(AgentModeContext);
  const all = useMemo(() => timelineItems(d, showHidden), [d, showHidden]);
  const items = all.filter((i) => filter === "all" || i.group === filter);

  async function toggleHidden(messageId: string, hidden: boolean) {
    const { ok, data } = await api<{ detail: ClientDetail | null }>(`/api/emails/${messageId}/hide`, "POST", { hidden });
    if (!ok) return notify(data.message ?? "Nie udało się zmienić.", true);
    if (data.detail) onChanged(data.detail);
    notify(hidden ? "Wątek ukryty w historii klienta." : "Wątek znów widoczny.");
  }
  // Lejek (pkt 7): sygnał z wątku Gmail — źródło E-mail, odnośnik = wątek.
  async function leadFromEmail(item: ClientHistoryItem) {
    if (item.kind !== "email") return;
    const { ok, data } = await api<{ id: string }>("/api/leads", "POST", {
      type: "EMAIL",
      clientId: d.id,
      sourceRef: `gmail:${item.id}`,
      message: [item.subject, item.snippet].filter(Boolean).join(" — ").slice(0, 2000) || null,
    });
    if (!ok) return notify(data.message ?? "Nie udało się utworzyć sygnału.", true);
    notify("Utworzono sygnał z maila — jest w Sygnałach (pierwszy kontakt w 4 h rob.).");
  }
  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/activity`, "POST", { type: "NOTE", body: note.trim() });
    setSaving(false);
    if (!ok) return notify(data.message ?? "Nie udało się zapisać notatki.", true);
    setNote("");
    onChanged(data.detail);
    notify("Dodano notatkę.");
  }

  const FILTERS: { k: Filter; label: string }[] = [
    { k: "all", label: "Wszystko" },
    { k: "rentals", label: "Wynajmy" },
    { k: "invoices", label: "Faktury" },
    { k: "comm", label: "Maile i SMS" },
    { k: "notes", label: "Notatki i zadania" },
  ];
  const clickable = (i: Item) => !!i.item && (i.item.kind === "email" || i.item.kind === "message" || i.item.kind === "activity");

  return (
    <Section
      title="Oś zdarzeń"
      gap="gap-3"
      action={
        <div className="flex flex-wrap gap-5">
          {FILTERS.map((f) => (
            <FilterLink key={f.k} on={filter === f.k} onClick={() => setFilter(f.k)}>
              {f.label}
            </FilterLink>
          ))}
        </div>
      }
    >
      <div className="flex items-center gap-2.5 py-2">
        <label htmlFor="card-note" className={LABEL}>
          Notatka
        </label>
        <input
          id="card-note"
          className="h-[34px] min-w-0 flex-grow rounded-[6px] border border-[#C3C4C7] bg-white px-3 text-[13px] outline-none focus:border-[#1B6FA8]"
          placeholder="Dodaj notatkę z rozmowy…"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addNote();
          }}
        />
        {note.trim() && (
          <button type="button" onClick={() => void addNote()} disabled={saving} className={BTN_PRIMARY}>
            Zapisz
          </button>
        )}
      </div>
      {items.length === 0 && <p className="text-[13px] text-[#5C6166]">Brak zdarzeń w tym widoku.</p>}
      <div className="flex flex-col">
        {items.slice(0, limit).map((i) => (
          <div
            key={i.key}
            className={`grid items-start gap-3 border-b border-[#E4E7EA] py-2 ${clickable(i) ? "cursor-pointer hover:bg-white" : ""}`}
            style={{ gridTemplateColumns: "100px 16px minmax(0, 1fr) auto" }}
            onClick={() => clickable(i) && onOpenItem(i.item!)}
          >
            <div className="text-[13px] tabular-nums text-[#5C6166]">{dmy(i.at)}</div>
            <div className="mt-[7px] box-border h-2.5 w-2.5" style={i.dot === "filled" ? { background: i.color } : { border: `2px solid ${i.color}` }} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="text-[13px] font-semibold text-[#2B2B2B]">{i.title}</div>
              {i.sub && <div className="break-words text-[13px] text-[#5C6166]">{i.sub}</div>}
            </div>
            <span className="flex flex-col items-end gap-1">
              <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.12em] text-[#767C82]">{i.tag}</span>
              {!agent && i.item?.kind === "email" && (
                <button
                  type="button"
                  className="text-[12px] text-[#767C82] hover:text-[#1B6FA8]"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleHidden(i.item!.id, !i.hidden);
                  }}
                >
                  {i.hidden ? "pokaż" : "ukryj"}
                </button>
              )}
              {!agent && i.item?.kind === "email" && !i.hidden && (
                <button
                  type="button"
                  className="whitespace-nowrap text-[12px] text-[#767C82] hover:text-[#1B6FA8]"
                  title="Utwórz sygnał z tego maila (Sygnały → Na dziś)"
                  onClick={(e) => {
                    e.stopPropagation();
                    void leadFromEmail(i.item!);
                  }}
                >
                  + sygnał
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
        {items.length > limit ? (
          <button type="button" onClick={() => setLimit((l) => l + 30)} className={LINK}>
            Pokaż więcej ({items.length - limit}) →
          </button>
        ) : (
          <button type="button" onClick={onShowAll} className={LINK}>
            Pokaż całą historię →
          </button>
        )}
        {d.hiddenThreads.length > 0 && (
          <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-[13px] text-[#767C82] hover:text-[#1B6FA8]">
            {showHidden ? "Schowaj ukryte wątki" : `Ukryte wątki (${d.hiddenThreads.length})`}
          </button>
        )}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ Faktury i płatności

// Zieleń = opłacona; terakota = po terminie / bez przelewu / bez faktury
// (do zrobienia); nie sprawdzono i oczekuje — neutralnie.
function statusColor(kind: string): string {
  if (kind === "ZAPLACONA" || kind === "GOTOWKA") return "font-semibold text-[#2F7A68]";
  if (kind === "PO_TERMINIE" || kind === "BRAK_PRZELEWU" || kind === "BEZ_FAKTURY") return "text-[#B8612F]";
  return "text-[#767C82]";
}

function CashForm({ fakturowniaId, onDone, onCancel, notify }: { fakturowniaId: number; onDone: (n: ClientDetail) => void; onCancel: () => void; notify: (t: string, e?: boolean) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivedBy, setReceivedBy] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail | null }>(`/api/fakturownia/invoices/${fakturowniaId}/cash`, "POST", { date, receivedBy });
    setBusy(false);
    if (!ok) return notify(data.message ?? "Nie udało się oznaczyć gotówki.", true);
    if (data.detail) onDone(data.detail);
    notify("Oznaczono: opłacona gotówką.");
  }
  return (
    <div className="my-2 flex flex-wrap items-end gap-2.5 bg-white p-4">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Data zapłaty</span>
        <input type="date" className={INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="flex min-w-[200px] flex-grow flex-col gap-1">
        <span className={LABEL}>Kto przyjął</span>
        <input className={INPUT} placeholder="np. kierowca Marek" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
      </label>
      <button type="button" className={BTN_OUTLINE} onClick={onCancel}>
        Anuluj
      </button>
      <button type="button" className={BTN_PRIMARY} disabled={busy || !date} onClick={() => void save()}>
        Opłacona gotówką
      </button>
    </div>
  );
}

export function InvoicesSection({ d, onShowAll, onChanged, notify }: { d: ClientDetail; onShowAll: () => void; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [cashFor, setCashFor] = useState<number | null>(null);
  // Etap C: wiersz = wynajem (także zaplanowany) albo faktura bez wynajmu —
  // pozycje rozliczenia, razem, część na FV i status wpłaty.
  const rows = d.transactions.slice(0, 8);
  const thisYear = new Date().getFullYear();
  const t = d.txTotals;
  // Data · Wynajem · Pozycje · Razem · Na FV · Status (wg karta-kierunek.html).
  const cols = { gridTemplateColumns: "50px minmax(0,0.9fr) minmax(0,1.5fr) 62px 58px minmax(96px,0.8fr)" };

  async function undoCash(fakturowniaId: number) {
    if (!window.confirm("Cofnąć oznaczenie „opłacona gotówką”?")) return;
    const { ok, data } = await api<{ detail: ClientDetail | null }>(`/api/fakturownia/invoices/${fakturowniaId}/cash`, "DELETE");
    if (!ok) return notify(data.message ?? "Nie udało się cofnąć.", true);
    if (data.detail) onChanged(data.detail);
  }

  const summary = [
    d.overview.typicalPayment ? `Płaci: ${d.overview.typicalPayment}.` : null,
    t.overdueCount ? `${t.overdueCount} po terminie (${money(t.overdueNet)}).` : null,
    t.noTransferCount ? `${t.noTransferCount} bez przelewu w okresie wyciągów — jeśli zapłacono gotówką, oznacz „gotówka”; inaczej przypomnij o płatności.` : null,
    t.uncheckedCount ? `${t.uncheckedCount} nie sprawdzono (poza okresem wyciągów).` : null,
    t.paymentsAsOf ? `Wpłaty z okresu ${t.paymentsFrom ? `${dm(t.paymentsFrom)}–` : "do "}${dm(t.paymentsAsOf)}.` : "Brak wgranych wyciągów z banku.",
    d.profile.invoiceEmail ? `E-mail do faktur: ${d.profile.invoiceEmail}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="flex flex-col gap-2 bg-[#FBF0E7] px-4 py-4">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="m-0 self-start border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold leading-tight text-[#0C3450]">Faktury i płatności</h2>
        <button type="button" onClick={onShowAll} className={LINK}>
          Wszystkie wynajmy i faktury →
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[#5C6166]">Brak wynajmów i faktur w panelu.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[540px]">
            <div className={`grid gap-2.5 border-b-[1.5px] border-[#0C3450] pb-1.5 ${LABEL}`} style={cols}>
              <span>Data</span>
              <span>Wynajem</span>
              <span>Pozycje</span>
              <span className="text-right">Razem</span>
              <span className="text-right">Na FV</span>
              <span>Status</span>
            </div>
            {rows.map((r) => {
              const inv = r.invoice;
              const cash = r.status.kind === "ZAPLACONA" && r.status.method === "CASH";
              const unpaid = inv && !["ZAPLACONA", "GOTOWKA", "ARCHIWALNA"].includes(r.status.kind);
              const noFv = r.status.kind === "BEZ_FAKTURY" && r.onInvoiceNet === 0;
              const d0 = new Date(r.date);
              const total = r.rentalNet ?? r.net;
              return (
                <div key={r.key}>
                  <div className="grid items-baseline gap-2.5 border-b border-[#E6D5C6] py-1.5 text-[12.5px] tabular-nums text-[#333333]" style={cols}>
                    <span>{d0.getFullYear() === thisYear ? dm(r.date) : dmy(r.date)}</span>
                    <span className="min-w-0">
                      <span className="block truncate" title={r.title}>
                        {r.title}
                      </span>
                      {inv && <span className="block truncate text-[11px] text-[#767C82]">FV {inv.number}</span>}
                    </span>
                    <span className="min-w-0 text-[11.5px] text-[#5C6166]">{r.positions ?? r.details ?? "—"}</span>
                    <span className="text-right">{total != null ? num(total) : "—"}</span>
                    <span className="text-right">
                      {r.onInvoicePending ? <span className="text-[11.5px] text-[#B8612F]" title="Warunki klienta: część na FV, bez ustalonej kwoty">do ustalenia</span> : r.onInvoiceNet != null ? num(r.onInvoiceNet) : "—"}
                    </span>
                    <span className="min-w-0 text-[11.5px]">
                      <span
                        className={`inline-block px-1.5 py-px ${
                          r.status.kind === "ZAPLANOWANY"
                            ? "bg-[#EAF4FB] text-[#1B6FA8]"
                            : r.status.kind === "ZAPLACONA" || r.status.kind === "GOTOWKA"
                              ? "bg-[#E6F2EE] text-[#2F7A68]"
                              : noFv
                                ? "text-[#767C82]"
                                : statusColor(r.status.kind)
                        }`}
                        title={r.status.label}
                      >
                        {noFv ? "bez FV" : r.status.kind === "NIE_SPRAWDZONO" && !t.paymentsAsOf ? "brak danych z banku" : r.status.label.charAt(0).toLowerCase() + r.status.label.slice(1)}
                      </span>
                      {!agent && unpaid && cashFor !== inv.fakturowniaInvoiceId && (
                        <button type="button" className="ml-1.5 text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => setCashFor(inv.fakturowniaInvoiceId)}>
                          gotówka
                        </button>
                      )}
                      {!agent && cash && inv && (
                        <button type="button" className="ml-1.5 text-[#767C82] hover:text-[#B8612F]" onClick={() => void undoCash(inv.fakturowniaInvoiceId)}>
                          cofnij
                        </button>
                      )}
                    </span>
                  </div>
                  {inv && cashFor === inv.fakturowniaInvoiceId && (
                    <CashForm
                      fakturowniaId={inv.fakturowniaInvoiceId}
                      notify={notify}
                      onCancel={() => setCashFor(null)}
                      onDone={(n) => {
                        setCashFor(null);
                        onChanged(n);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-2">
        <Quote tone="terra">{summary}</Quote>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Jakość danych

export function QualitySection({ d, onShowData }: { d: ClientDetail; onShowData: () => void }) {
  const q = cardQuality({
    status: d.summary.status,
    name: d.name,
    nip: d.nip,
    street: d.street,
    city: d.city,
    clinicType: d.clinicType,
    hubspotCompanyId: d.hubspotCompanyId,
    aliasesCount: d.aliases.length,
    invoicesCount: d.summary.invoicesCount,
    rentalsTotal: d.summary.rentalsTotal,
    paymentsAsOf: d.txTotals.paymentsAsOf,
    contacts: d.contacts,
    profile: d.profile,
    fieldSources: [...Object.values(d.fieldMeta), ...d.contacts.flatMap((c) => Object.values(c.fieldMeta))].map((m) => m.source),
  });
  return (
    <Section
      title="Jakość danych"
      gap="gap-3.5"
      action={
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-[220px] max-w-[40vw] bg-[#E3F1EC]">
            <div className="h-1.5 bg-[#2F7A68]" style={{ width: `${q.percent}%` }} />
          </div>
          <span className="text-[17px] text-[#2F7A68]">{q.percent}%</span>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2F7A68]">✓ Potwierdzone</div>
          <div className="text-[13px] leading-[1.5] text-[#4A4A4A]">{q.confirmed.length ? q.confirmed.join(" · ") : "—"}</div>
        </div>
        <div>
          <div className={`mb-1.5 ${LABEL}`}>Brakuje</div>
          <div className="text-[13px] leading-[1.5] text-[#4A4A4A]">{q.missing.length ? q.missing.join(" · ") : "nic — komplet"}</div>
        </div>
        <div>
          <div className={`mb-1.5 ${LABEL}`}>Źródła</div>
          <div className="text-[13px] leading-[1.5] text-[#4A4A4A]">{q.sources.length ? q.sources.join(" · ") : <Missing>brak</Missing>}</div>
        </div>
      </div>
      <button type="button" onClick={onShowData} className={`${LINK} self-start`}>
        Wszystkie dane, kwalifikacja i notatki →
      </button>
    </Section>
  );
}

export function CardRight({
  d,
  onChanged,
  notify,
  onOpenItem,
  onTab,
  top,
}: {
  d: ClientDetail;
  onChanged: (n: ClientDetail) => void;
  notify: (t: string, e?: boolean) => void;
  onOpenItem: (h: ClientHistoryItem) => void;
  onTab: (t: "komunikacja") => void;
  top?: ReactNode; // blok „Następny krok”
}) {
  return (
    <div className="flex w-full min-w-0 flex-grow flex-col gap-6">
      {top}
      <RhythmSection d={d} />
      <OpportunitiesSection d={d} onChanged={onChanged} notify={notify} />
      <TimelineSection d={d} onChanged={onChanged} notify={notify} onOpenItem={onOpenItem} onShowAll={() => onTab("komunikacja")} />
    </div>
  );
}
