"use client";

import { useContext, useMemo, useState } from "react";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { cardQuality } from "@/lib/clients/card-quality";
import { AgentModeContext, INPUT, api } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY, LINK, Missing, Pill, Section, Tag, dm, dmy, hm, money, num } from "./kit";

// Prawa kolumna karty wg karta-klienta-wzor.html: Rytm współpracy (siatka
// lata × miesiące), Oś zdarzeń z filtrami i szybką notatką, Faktury
// i płatności, Szanse sprzedaży, Jakość danych.

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// ------------------------------------------------------------------ Rytm współpracy

function RhythmSection({ d }: { d: ClientDetail }) {
  const r = d.rhythm;
  const dc = r.deviceConfig;
  const risk = r.churnRisk;
  const riskColor = risk?.level === "niskie" ? "var(--c-brand)" : risk?.level === "średnie" ? "#9A4A06" : "var(--c-red)";
  const price = d.profile.agreedPrice ? Number(d.profile.agreedPrice) : null;
  const year = new Date().getFullYear();
  const invoicedThisYear = d.transactions.filter((t) => t.invoice && new Date(t.date).getFullYear() === year && t.net);
  const avgInvoice = invoicedThisYear.length ? invoicedThisYear.reduce((s, t) => s + (t.net ?? 0), 0) / invoicedThisYear.length : null;
  return (
    <Section title="Rytm współpracy" wide gap="gap-4" action={<Legend />}>
      {r.grid.length === 0 ? (
        <p className="text-[13px] text-[var(--c-muted)]">Brak wynajmów — rytm pojawi się po pierwszych rezerwacjach.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-[560px] flex-col gap-1.5">
            <div className="grid gap-1.5 text-[12px] text-[var(--c-muted)]" style={{ gridTemplateColumns: "56px repeat(12, minmax(0, 1fr))" }}>
              <span />
              {ROMAN.map((m) => (
                <span key={m} className="text-center">
                  {m}
                </span>
              ))}
            </div>
            {r.grid.map((g) => (
              <div key={g.year} className="grid items-center gap-1.5" style={{ gridTemplateColumns: "56px repeat(12, minmax(0, 1fr))" }}>
                <span className="font-mono text-[13px] text-[var(--c-text-2)]">{g.year}</span>
                {g.months.map((m, i) => {
                  const count = m.realized + m.planned + m.proposed;
                  const cls =
                    m.realized > 0
                      ? "bg-[var(--c-brand)] text-white"
                      : m.planned > 0
                        ? "border-2 border-[var(--c-brand)] bg-white text-[var(--c-brand)]"
                        : m.proposed > 0
                          ? "border-2 border-dashed border-[#8A94A0] bg-white text-[var(--c-muted)]"
                          : "bg-[var(--c-bg)]";
                  const title = [m.realized ? `zrealizowane: ${m.realized}` : null, m.planned ? `zaplanowane: ${m.planned}` : null, m.proposed ? "proponowany termin" : null].filter(Boolean).join(", ");
                  return (
                    <div key={i} title={title || undefined} className={`box-border flex h-[34px] items-center justify-center rounded-md text-[12px] font-semibold ${cls}`}>
                      {count > 1 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--c-divider)] pt-3.5 md:grid-cols-4">
        <Stat label="Urządzenie" value={dc ? `${dc.family}${dc.heads ? ` · ${dc.always ? "zawsze " : ""}${dc.heads} ${dc.heads === 1 ? "głowica" : "głowice"}` : ""}` : "—"} sub={dc?.models.map((m) => `${m.name} ${m.count}×`).join(" · ")} />
        <Stat label="Czas" value={d.cardFacts.typicalDays ? `${d.cardFacts.typicalDays} ${d.cardFacts.typicalDays === 1 ? "dzień" : "dni"}` : "—"} sub="wg rezerwacji w panelu" />
        <Stat
          label={`Cena (${year})`}
          value={price ? `${money(price)} netto` : avgInvoice ? `≈ ${money(Math.round(avgInvoice))} netto` : "—"}
          sub={price ? (d.profile.paymentTerms ?? "cena ustalona") : avgInvoice ? "średnia z faktur" : "brak faktur w tym roku"}
        />
        <Stat
          label="Ryzyko odejścia"
          value={risk ? risk.level : "—"}
          color={risk ? riskColor : undefined}
          sub={r.lastPlannedAt ? `terminy zajęte do ${dm(r.lastPlannedAt)}` : risk ? `ostatni wynajem ${dm(risk.lastAt)}` : "za mało wynajmów"}
        />
      </div>
    </Section>
  );
}

function Legend() {
  const box = "h-3 w-3 rounded-[3px] box-border";
  return (
    <div className="hidden gap-4 text-[12px] text-[var(--c-text-2)] sm:flex">
      <span className="flex items-center gap-1.5">
        <span className={`${box} bg-[var(--c-brand)]`} />
        zrealizowany
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`${box} border-2 border-[var(--c-brand)] bg-white`} />
        zaplanowany
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`${box} border-2 border-dashed border-[#8A94A0] bg-white`} />
        proponowany
      </span>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string | null; color?: string }) {
  return (
    <div>
      <div className="text-[12px] text-[var(--c-muted)]">{label}</div>
      <div className="text-[14px] font-medium" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[12px] text-[var(--c-muted)]">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Oś zdarzeń

type Filter = "all" | "rentals" | "invoices" | "comm" | "notes";
type Item = { key: string; at: string; title: string; sub: string | null; tag: string; dot: "filled" | "outline"; color: string; group: Exclude<Filter, "all">; item?: ClientHistoryItem };

function timelineItems(d: ClientDetail): Item[] {
  const out: Item[] = [];
  // Adnotacje wzoru: „Pierwszy wynajem”, „pierwszy po przerwie” (odstęp
  // dłuższy niż 2,5 × rytm).
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
  for (const h of d.history) {
    if (h.kind === "rental") {
      if (h.deleted) continue;
      const planned = h.upcoming;
      out.push({
        key: `r-${h.id}`,
        at: h.at,
        title: planned
          ? `Rezerwacja${hm(h.at) !== "00:00" ? ` ${hm(h.at)}` : ""} · ${h.deviceName}`
          : h.eventType === "SZKOLENIE"
            ? `Szkolenie · ${h.deviceName}`
            : realizedTitle(h.at, h.deviceName),
        sub: [h.totalNet ? `${money(h.totalNet)} netto` : null, planned ? null : h.settled ? "rozliczony" : null].filter(Boolean).join(" · ") || null,
        tag: planned ? "zaplanowany" : "wynajem",
        dot: planned ? "outline" : "filled",
        color: "var(--c-brand)",
        group: "rentals",
        item: h,
      });
    } else if (h.kind === "history") {
      out.push({ key: `h-${h.id}`, at: h.at, title: h.eventType === "SZKOLENIE" ? `Szkolenie · ${h.deviceName}` : realizedTitle(h.at, h.deviceName), sub: `z kalendarza: ${h.title}`, tag: "wynajem", dot: "filled", color: "var(--c-brand)", group: "rentals" });
    } else if (h.kind === "invoice") {
      const tx = invByNumber.get(h.number);
      out.push({
        key: `i-${h.id}`,
        at: h.at,
        title: `FV ${h.number}`,
        sub: [`${money(h.totalNet, 2)} netto`, tx?.invoice?.totalGross ? `${money(tx.invoice.totalGross, 2)} brutto` : null, tx ? tx.status.label.toLowerCase() : null].filter(Boolean).join(" / "),
        tag: "faktura",
        dot: "filled",
        color: "#9A4A06",
        group: "invoices",
      });
    } else if (h.kind === "email") {
      out.push({ key: `e-${h.id}`, at: h.at, title: `Mail: ${h.subject ?? "(bez tematu)"}`, sub: h.snippet ? `„${h.snippet.slice(0, 110)}${h.snippet.length > 110 ? "…" : ""}”` : null, tag: "mail", dot: "filled", color: "var(--c-muted)", group: "comm", item: h });
    } else if (h.kind === "message") {
      out.push({ key: `m-${h.id}`, at: h.at, title: `${h.channel === "SMS" ? "SMS" : "E-mail z panelu"}${h.failed ? " (nie wysłano)" : ""}`, sub: h.body.slice(0, 120), tag: h.channel === "SMS" ? "sms" : "mail", dot: "filled", color: "var(--c-muted)", group: "comm", item: h });
    } else if (h.kind === "activity") {
      out.push({
        key: `a-${h.id}`,
        at: h.at,
        title: h.type === "NOTE" ? "Notatka" : h.type === "CALL" ? "Rozmowa telefoniczna" : "Nieodebrane połączenie",
        sub: [h.body, h.userName].filter(Boolean).join(" — ") || null,
        tag: h.type === "NOTE" ? "notatka" : "rozmowa",
        dot: "outline",
        color: "var(--c-muted)",
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
      color: "var(--c-muted)",
      group: "notes",
    });
  }
  for (const o of d.opportunities) {
    out.push({ key: `o-${o.id}`, at: o.lastContact ?? o.createdAt, title: o.device, sub: o.note, tag: "szansa", dot: "outline", color: "var(--c-muted)", group: "notes" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

function TimelineSection({ d, onChanged, notify, onOpenItem, onShowAll }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void; onOpenItem: (h: ClientHistoryItem) => void; onShowAll: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(10);
  const all = useMemo(() => timelineItems(d), [d]);
  const items = all.filter((i) => filter === "all" || i.group === filter);
  const rentalsCount = d.summary.rentalsTotal;

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

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-[var(--c-border)] bg-white px-[22px] py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--c-text-2)]">Oś zdarzeń</h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Pill key={f.k} on={filter === f.k} onClick={() => setFilter(f.k)}>
              {f.label}
            </Pill>
          ))}
        </div>
      </div>
      <div className="flex gap-2.5 rounded-lg border border-[var(--c-divider)] bg-[var(--c-inner)] px-3 py-2.5">
        <label htmlFor="card-note" className="self-center text-[13px] text-[var(--c-muted)]">
          Notatka
        </label>
        <input
          id="card-note"
          className="h-9 min-w-0 flex-grow rounded-md border border-[var(--c-btn-border)] bg-white px-2.5 text-[14px] outline-none focus:border-[var(--c-brand)]"
          placeholder="Dodaj notatkę z rozmowy…"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addNote();
          }}
        />
        {note.trim() && (
          <button type="button" onClick={() => void addNote()} disabled={saving} className="h-9 rounded-md bg-[var(--c-brand)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--c-brand-deep)]">
            Zapisz
          </button>
        )}
      </div>
      {items.length === 0 && <p className="text-[13px] text-[var(--c-muted)]">Brak zdarzeń w tym widoku.</p>}
      {items.slice(0, limit).map((i) => (
        <div
          key={i.key}
          className={`grid items-start gap-3 border-t border-[var(--c-divider)] py-2.5 ${i.item && (i.item.kind === "email" || i.item.kind === "message" || i.item.kind === "activity") ? "cursor-pointer hover:bg-[var(--c-inner)]" : ""}`}
          style={{ gridTemplateColumns: "92px 18px minmax(0, 1fr) auto" }}
          onClick={() => i.item && (i.item.kind === "email" || i.item.kind === "message" || i.item.kind === "activity") && onOpenItem(i.item)}
        >
          <div className="pt-0.5 font-mono text-[12px] text-[var(--c-text-2)]">{dmy(i.at)}</div>
          <div
            className="mt-1 box-border h-3 w-3 rounded-full"
            style={i.dot === "filled" ? { background: i.color } : { border: `2px solid ${i.color}`, background: "#FFFFFF" }}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="text-[14px] font-medium">{i.title}</div>
            {i.sub && <div className="break-words text-[13px] text-[var(--c-muted)]">{i.sub}</div>}
          </div>
          <Tag tone="neutral">{i.tag}</Tag>
        </div>
      ))}
      {items.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 30)} className={`${LINK} self-start`}>
          Pokaż więcej ({items.length - limit})
        </button>
      ) : (
        <button type="button" onClick={onShowAll} className={`${LINK} self-start`}>
          Pokaż całą historię ({rentalsCount} {rentalsCount === 1 ? "wynajem" : "wynajmów"}, maile, faktury, SMS)
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Faktury i płatności

function statusTone(kind: string): "warn" | "accent" | "neutral" {
  if (kind === "ZAPLACONA" || kind === "GOTOWKA") return "accent";
  if (kind === "PO_TERMINIE" || kind === "NIE_SPRAWDZONO" || kind === "BEZ_FAKTURY") return "warn";
  return "neutral";
}

function InvoicesSection({ d, onShowAll }: { d: ClientDetail; onShowAll: () => void }) {
  const rows = d.transactions.filter((t) => t.invoice).slice(0, 6);
  const t = d.txTotals;
  return (
    <Section title="Faktury i płatności" wide gap="gap-2.5">
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--c-muted)]">Brak faktur w panelu.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[380px]">
            <div className="grid gap-2 border-b border-[var(--c-divider)] pb-1.5 text-[12px] text-[var(--c-muted)]" style={{ gridTemplateColumns: "88px 76px minmax(0, 1fr) 96px" }}>
              <span>Numer</span>
              <span>Sprzedaż</span>
              <span>Netto (zł)</span>
              <span>Status</span>
            </div>
            {rows.map((r) => (
              <div key={r.key} className="mt-2.5 grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: "88px 76px minmax(0, 1fr) 96px" }}>
                <span className="truncate font-mono">{r.invoice!.number}</span>
                <span>{dmy(r.date)}</span>
                <span className="flex flex-col whitespace-nowrap leading-tight" title="netto / brutto, zł">
                  <span>{r.net != null ? num(r.net, 2) : "—"}</span>
                  {r.invoice!.totalGross != null && <span className="text-[11px] text-[var(--c-muted)]">{num(r.invoice!.totalGross, 2)} brutto</span>}
                </span>
                <span className="text-center" title={r.status.label}>
                  <Tag tone={statusTone(r.status.kind)}>{r.status.kind === "NIE_SPRAWDZONO" ? "nie sprawdzono" : r.status.label.toLowerCase()}</Tag>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="border-t border-[var(--c-divider)] pt-2.5 text-[13px] text-[var(--c-text-2)]">
        {[
          d.overview.typicalPayment ? `Płaci: ${d.overview.typicalPayment}.` : null,
          t.overdueCount ? `${t.overdueCount} po terminie (${money(t.overdueNet)}).` : null,
          t.uncheckedCount ? `${t.uncheckedCount} ${t.uncheckedCount === 1 ? "faktura" : "faktur"} nie sprawdzono (termin po ostatnim wyciągu albo sprzed 09.2026).` : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </div>
      <div className="text-[13px] text-[var(--c-text-2)]">
        {t.paymentsAsOf ? `Wpłaty aktualne na ${dm(t.paymentsAsOf)} (wyciąg z banku)` : "Brak wgranych wyciągów z banku"}
        {d.profile.invoiceEmail ? ` · e-mail do FV: ${d.profile.invoiceEmail}` : ""}
      </div>
      <button type="button" onClick={onShowAll} className={`${LINK} self-start`}>
        Wszystkie wynajmy i faktury →
      </button>
    </Section>
  );
}

// ------------------------------------------------------------------ Szanse sprzedaży

const STAGES = [
  { value: "pomysl", label: "pomysł" },
  { value: "rozmowa", label: "rozmowa" },
  { value: "oferta", label: "oferta" },
  { value: "decyzja", label: "czeka na decyzję" },
  { value: "wygrana", label: "wygrana" },
  { value: "przegrana", label: "przegrana" },
];
const CHANCES = [
  { value: "wysoka", label: "wysoka", color: "var(--c-brand)" },
  { value: "srednia", label: "średnia", color: "#9A4A06" },
  { value: "niska", label: "niska", color: "var(--c-muted)" },
  { value: "sprawdzic", label: "sprawdzić", color: "var(--c-muted)" },
];
const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;

function OpportunitiesSection({ d, onChanged, notify }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ device: "", stage: "rozmowa", chance: "", returnAt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const open = d.opportunities.filter((o) => !o.closedAt);
  const review = d.profile.googleReview;

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
      wide
      gap="gap-2.5"
      action={
        !agent &&
        !adding && (
          <button type="button" onClick={() => setAdding(true)} className={LINK}>
            + dodaj
          </button>
        )
      }
    >
      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--c-brand)] p-3">
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
              {CHANCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input className={INPUT} type="date" title="Wrócić" value={f.returnAt} onChange={(e) => setF({ ...f, returnAt: e.target.value })} />
          </div>
          <textarea className="w-full rounded-lg border border-[var(--c-border)] px-3 py-2 text-sm outline-none focus:border-[var(--c-brand)]" rows={2} placeholder="Opis" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_OUTLINE} onClick={() => setAdding(false)}>
              Anuluj
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !f.device.trim()} onClick={() => void save()}>
              Dodaj
            </button>
          </div>
        </div>
      )}
      {open.length === 0 && !review?.askedAt && !adding && <p className="text-[13px] text-[var(--c-muted)]">Brak otwartych szans.</p>}
      {open.map((o) => {
        const ch = CHANCES.find((c) => c.value === o.chance);
        return (
          <div key={o.id} className="group flex flex-col gap-1 rounded-lg border border-[var(--c-divider)] bg-[var(--c-inner)] p-3">
            <div className="flex justify-between gap-2">
              <span className="text-[14px] font-semibold">{o.device}</span>
              <span className="text-[12px] font-semibold" style={{ color: ch?.color ?? "var(--c-muted)" }}>
                {ch?.label ?? stageLabel(o.stage)}
              </span>
            </div>
            <div className="text-[13px] text-[var(--c-text-2)]">
              {[o.note, `etap: ${stageLabel(o.stage)}`, o.lastContact ? `ostatni kontakt ${dmy(o.lastContact)}` : null, o.returnAt ? `wrócić ${dmy(o.returnAt)}` : null].filter(Boolean).join(" · ")}
            </div>
            {!agent && (
              <div className="hidden gap-3 text-[12px] group-hover:flex">
                <button type="button" className={LINK} onClick={() => void close(o.id, "wygrana")}>
                  wygrana
                </button>
                <button type="button" className="text-[12px] text-[var(--c-muted)] hover:underline" onClick={() => void close(o.id, "przegrana")}>
                  zamknij bez sprzedaży
                </button>
              </div>
            )}
          </div>
        );
      })}
      {review?.askedAt && review.given !== true && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--c-divider)] bg-[var(--c-inner)] p-3">
          <div className="flex justify-between">
            <span className="text-[14px] font-semibold">Opinia w Google</span>
            <span className="text-[12px] font-semibold text-[var(--c-muted)]">sprawdzić</span>
          </div>
          <div className="text-[13px] text-[var(--c-text-2)]">Prośba wysłana {dmy(review.askedAt)}. {review.given === false ? "Nie wystawiła." : "Nie wiadomo, czy wystawiła."}</div>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ Jakość danych

function QualitySection({ d, onShowData }: { d: ClientDetail; onShowData: () => void }) {
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
    <section className="flex flex-col gap-3.5 rounded-lg border border-[var(--c-border)] bg-white px-[22px] py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--c-text-2)]">Jakość danych</h2>
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-[200px] max-w-[40vw] rounded bg-[var(--c-divider)]">
            <div className="h-2 rounded bg-[var(--c-brand)]" style={{ width: `${q.percent}%` }} />
          </div>
          <span className="text-[14px] font-semibold">{q.percent}%</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 text-[13px] md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <div className="font-semibold">Potwierdzone</div>
          <div className="text-[var(--c-text-2)]">{q.confirmed.length ? q.confirmed.join(" · ") : "—"}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="font-semibold">Brakuje</div>
          <div className="text-[var(--c-text-2)]">{q.missing.length ? q.missing.join(" · ") : "nic — komplet"}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="font-semibold">Źródła</div>
          <div className="text-[var(--c-text-2)]">{q.sources.length ? q.sources.join(" · ") : <Missing>brak</Missing>}</div>
        </div>
      </div>
      <button type="button" onClick={onShowData} className={`${LINK} self-start`}>
        Wszystkie dane, kwalifikacja i notatki →
      </button>
    </section>
  );
}

export function CardRight({
  d,
  onChanged,
  notify,
  onOpenItem,
  onTab,
}: {
  d: ClientDetail;
  onChanged: (n: ClientDetail) => void;
  notify: (t: string, e?: boolean) => void;
  onOpenItem: (h: ClientHistoryItem) => void;
  onTab: (t: "transakcje" | "komunikacja" | "dane") => void;
}) {
  return (
    <div className="flex w-full min-w-0 flex-grow flex-col gap-4">
      <RhythmSection d={d} />
      <TimelineSection d={d} onChanged={onChanged} notify={notify} onOpenItem={onOpenItem} onShowAll={() => onTab("komunikacja")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InvoicesSection d={d} onShowAll={() => onTab("transakcje")} />
        <OpportunitiesSection d={d} onChanged={onChanged} notify={notify} />
      </div>
      <QualitySection d={d} onShowData={() => onTab("dane")} />
    </div>
  );
}
