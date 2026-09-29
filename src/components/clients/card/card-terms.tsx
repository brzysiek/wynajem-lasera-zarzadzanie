"use client";

import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientDetail } from "@/lib/clients/load";
import { BASE_PATH } from "@/lib/base-path";
import { transportSuggestion } from "@/lib/clients/transport-suggest";
import { AgentModeContext, api } from "../client-forms";
import { LINK, Missing, Row, Section, dm, dmy, money, num } from "./kit";
import {
  INVOICE_MODE_LABEL,
  PRICE_SOURCES,
  PRICE_SOURCE_LABEL,
  TERMS_DAYS,
  TERMS_DEVICES,
  TERMS_DEVICE_LABEL,
  TRANSPORT_SOURCE_LABEL,
  transportNeedsReview,
  type TermsDeviceCode,
} from "@/lib/clients/terms-rules";

// „Warunki” na karcie klienta (wniosek 28) — lewa kolumna, pod „Dane firmy”.
// Trzy poziomy ceny: cennik ogólny → wyjątki klienta (tylko to, co inne;
// każda zmiana = nowa wersja od daty, ze źródłem) → cena jednorazowa w
// rezerwacji. Autozapis: klik w pole = edycja, zapis po Enter / wyjściu z
// pola, „Zapisano ✓ · Cofnij” przez 10 s, każda zmiana w dzienniku.
// Przyszłe rezerwacje przeliczają się dopiero po „Zastosuj”. Faktura i
// płatność — logika bez zmian. ADMIN/STAFF edytują, agent tylko czyta
// (propozycje przez MCP).

export const PAYMENT_FORM_LABEL: Record<string, string> = {
  GOTOWKA: "gotówka",
  PRZELEW: "przelew",
  OBA: "gotówka i przelew",
};

// Dawna „cena ustalona” albo pierwsza cena klienta za 1 dzień (+ transport).
export function agreedTotal(d: ClientDetail): { rental: number | null; transport: number | null; total: number | null } {
  const firstDay = TERMS_DEVICES.map((x) => d.terms.prices.find((r) => r.device === x.code && r.days === 1)).find(Boolean);
  const rental = d.profile.agreedPrice ? Number(d.profile.agreedPrice) : (firstDay?.priceNet ?? null);
  const transport = d.transportPriceNet ? Number(d.transportPriceNet) : null;
  return { rental, transport, total: rental != null ? rental + (transport ?? 0) : null };
}

const ymd = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" }) : "");
const parseAmount = (v: string): number | null | "invalid" => {
  const t = v.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : "invalid";
};

// ------------------------------------------------------------------ autozapis

type Saver = (label: string, run: () => Promise<ClientDetail | string>, undo?: () => Promise<ClientDetail | string>) => Promise<boolean>;

// Pole edytowane w miejscu: wygląda jak tekst, klik = edycja; Enter / wyjście
// zapisuje, Esc cofa. Błąd walidacji — obok pola, wartość się nie zapisuje.
function AutoInput({
  value,
  onSave,
  placeholder,
  width = "w-[90px]",
  align = "text-right",
  type = "text",
  multiline = false,
  disabled = false,
  label,
}: {
  value: string;
  onSave: (v: string) => Promise<string | null>;
  placeholder?: string;
  width?: string;
  align?: string;
  type?: "text" | "date" | "email";
  multiline?: boolean;
  disabled?: boolean;
  label: string;
}) {
  const [v, setV] = useState(value);
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (seen !== value) {
    setSeen(value);
    setV(value);
  }
  async function commit() {
    if (v === value) return setError(null);
    setBusy(true);
    const err = await onSave(v);
    setBusy(false);
    setError(err);
  }
  const cls = `${width} ${align} rounded-[4px] border border-transparent bg-transparent px-1.5 py-[3px] text-[13px] text-[#0C3450] outline-none hover:border-[#D6DADE] focus:border-[#1B6FA8] focus:bg-white disabled:cursor-default disabled:hover:border-transparent ${error ? "border-[#E08A5C]" : ""}`;
  const common = {
    value: v,
    disabled: disabled || busy,
    "aria-label": label,
    placeholder,
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        setV(value);
        setError(null);
      }
    },
  };
  return (
    <span className={`inline-flex min-w-0 flex-col ${multiline ? "w-full" : ""}`}>
      {multiline ? (
        <textarea rows={2} {...common} onChange={(e) => setV(e.target.value)} className={`${cls} resize-y`} />
      ) : (
        <input type={type} inputMode={type === "text" && align === "text-right" ? "decimal" : undefined} {...common} onChange={(e) => setV(e.target.value)} className={cls} />
      )}
      {error && <span className="px-1.5 text-[11.5px] text-[#B8612F]">{error}</span>}
    </span>
  );
}

function AutoSelect({ value, options, onSave, disabled, label }: { value: string; options: [string, string][]; onSave: (v: string) => void; disabled?: boolean; label: string }) {
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className="h-7 cursor-pointer rounded-[4px] border border-transparent bg-transparent px-1 text-[13px] text-[#0C3450] outline-none hover:border-[#D6DADE] focus:border-[#1B6FA8] disabled:cursor-default disabled:hover:border-transparent"
    >
      {options.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------ transport ustalony

// Wspólne dla bloku Warunki i paszportu dostawy: kwota ustalona (tylko ona
// trafia do rezerwacji) + sugestia z km obok, „do przejrzenia” przy > 20%.
export function TransportFixed({ d, save, compact = false }: { d: ClientDetail; save: Saver; compact?: boolean }) {
  const agent = useContext(AgentModeContext);
  const fixed = d.transportPriceNet != null && d.transportPriceNet !== "" ? Number(d.transportPriceNet) : null;
  const sug = transportSuggestion(d);
  const review = transportNeedsReview(fixed, sug?.priceNet ?? null);
  const src = d.terms.transportSource ? (TRANSPORT_SOURCE_LABEL[d.terms.transportSource as keyof typeof TRANSPORT_SOURCE_LABEL] ?? d.terms.transportSource) : null;
  const setFixed = (next: number | null, source: string | null, label: string) =>
    save(
      label,
      () => patch(d.id, { transportPriceNet: next == null ? null : String(next), ...(next != null ? { transportSource: source ?? "USTALONE" } : {}) }),
      () => patch(d.id, { transportPriceNet: fixed == null ? null : String(fixed), transportSource: d.terms.transportSource, ...(d.terms.transportSince ? { transportPriceSince: ymd(d.terms.transportSince) } : {}) }),
    );
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
      {!compact && <span className="text-[#5C6166]">Transport ustalony</span>}
      <span className="inline-flex items-baseline">
        <AutoInput
          label="Transport ustalony"
          value={fixed != null ? String(fixed) : ""}
          placeholder={sug ? String(sug.priceNet) : "kwota"}
          width="w-[70px]"
          disabled={agent}
          onSave={async (v) => {
            const n = parseAmount(v);
            if (n === "invalid") return "Kwota musi być liczbą, np. 140.";
            await setFixed(n, "USTALONE", n == null ? "Wyczyszczono transport ustalony" : `Transport ustalony ${money(n)}`);
            return null;
          }}
        />
        <span className="text-[#5C6166]">zł / kurs</span>
      </span>
      {fixed != null && (src || d.terms.transportSince) && (
        <span className="text-[11.5px] text-[#767C82]">{[src, d.terms.transportSince ? `od ${dmy(d.terms.transportSince)}` : null].filter(Boolean).join(" · ")}</span>
      )}
      {fixed == null && <Missing>brak — rezerwacja poprosi o kwotę</Missing>}
      {sug && (
        <span className={`text-[11.5px] ${review ? "text-[#B8612F]" : "text-[#767C82]"}`} title="Sugestia ze stref (Ustawienia → Cennik) — nigdy nie trafia do rezerwacji sama">
          {num(sug.km)} km · strefa {sug.zone} · sugerowane {num(sug.priceNet)}
          {review && " · do przejrzenia"}
        </span>
      )}
      {sug && !agent && fixed !== sug.priceNet && (
        <button type="button" className="text-[11.5px] text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => void setFixed(sug.priceNet, "USTALONE", `Transport ustalony ${money(sug.priceNet)} (z sugestii)`)}>
          przyjmij sugestię
        </button>
      )}
    </span>
  );
}

async function patch(id: string, body: Record<string, unknown>): Promise<ClientDetail | string> {
  const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${id}`, "PATCH", body);
  return ok ? data.detail : (data.message ?? "Nie udało się zapisać.");
}
async function priceRow(id: string, body: Record<string, unknown>): Promise<ClientDetail | string> {
  const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${id}/prices/row`, "POST", body);
  return ok ? data.detail : (data.message ?? "Nie udało się zapisać.");
}

// Hak autozapisu: zapis → świeże dane karty, „Zapisano ✓ · Cofnij” (10 s),
// odświeżenie paska „Zmienia N przyszłych rezerwacji”.
export function useTermsSaver(onChanged: (n: ClientDetail) => void, notify: (t: string, e?: boolean) => void) {
  const [saved, setSaved] = useState<{ text: string; undo?: () => Promise<ClientDetail | string> } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 10000);
    return () => clearTimeout(t);
  }, [saved]);
  const save: Saver = useCallback(
    async (label, run, undo) => {
      const res = await run();
      if (typeof res === "string") {
        notify(res, true);
        return false;
      }
      onChanged(res);
      setVersion((v) => v + 1);
      setSaved({ text: label, undo });
      return true;
    },
    [onChanged, notify],
  );
  const undo = async () => {
    if (!saved?.undo) return;
    const res = await saved.undo();
    setSaved(null);
    if (typeof res === "string") return notify(res, true);
    onChanged(res);
    setVersion((v) => v + 1);
    notify("Cofnięto zmianę.");
  };
  const bar = saved ? (
    <span role="status" className="flex items-center gap-2 text-[12px] text-[#2F7A68]">
      Zapisano ✓ <span className="text-[#5C6166]">{saved.text}</span>
      {saved.undo && (
        <button type="button" className="font-semibold text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => void undo()}>
          Cofnij
        </button>
      )}
    </span>
  ) : null;
  return { save, bar, version };
}

// ------------------------------------------------------------------ przyszłe rezerwacje

type SyncPlan = { changes: { rentalId: string; title: string; startsAt: string; before: string | null; after: string }[]; manual: number; skipped: boolean };

export function TermsSyncBar({ d, version, onChanged, notify }: { d: ClientDetail; version: number; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { ok, data } = await api<SyncPlan>(`/api/clients/${d.id}/terms-sync`, "GET");
    setPlan(ok ? data : null);
  }, [d.id]);
  // Odśwież po każdej zmianie warunków — także z paszportu dostawy (transport).
  const termsKey = [d.transportPriceNet, d.profile.invoiceMode, d.profile.invoicePartDefault, d.profile.paymentForm, d.profile.pulsesCharged, d.profile.pulseRateNet, ...d.terms.prices.map((r) => `${r.device}|${r.days}|${r.priceNet}`)].join(";");
  useEffect(() => {
    if (agent) return;
    let alive = true;
    void api<SyncPlan>(`/api/clients/${d.id}/terms-sync`, "GET").then(({ ok, data }) => alive && setPlan(ok ? data : null));
    return () => {
      alive = false;
    };
  }, [agent, d.id, version, termsKey]);
  if (agent || !plan || plan.changes.length === 0 || plan.skipped) return null;
  const n = plan.changes.length;
  async function act(action: "apply" | "skip") {
    setBusy(true);
    const { ok, data } = await api<{ updated?: number; filled?: number; manual?: number }>(`/api/clients/${d.id}/terms-sync`, "POST", { action });
    setBusy(false);
    if (!ok) return notify((data as { message?: string }).message ?? "Nie udało się.", true);
    if (action === "apply") {
      notify(`Przeliczono przyszłe rezerwacje: ${(data.updated ?? 0) + (data.filled ?? 0)}.${data.manual ? ` Ręczne kwoty bez zmian: ${data.manual}.` : ""}`);
      const fresh = await api<ClientDetail>(`/api/clients/${d.id}`, "GET");
      if (fresh.ok) onChanged(fresh.data);
    } else notify("Warunki obowiązują tylko dla nowych rezerwacji.");
    await load();
  }
  return (
    <div className="mt-1.5 border-l-[3px] border-[#1B6FA8] bg-[#EAF4FB] px-3 py-2 text-[12.5px] text-[#0C3450]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Zmienia <b className="font-semibold">{n}</b> {n === 1 ? "przyszłą rezerwację" : n < 5 ? "przyszłe rezerwacje" : "przyszłych rezerwacji"}
          {plan.manual ? <span className="text-[#5C6166]"> · ręcznych bez zmian: {plan.manual}</span> : null}
        </span>
        <button type="button" className="text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => setOpen((v) => !v)}>
          {open ? "Ukryj listę" : "Pokaż listę"}
        </button>
        <span className="ml-auto flex gap-2">
          <button type="button" disabled={busy} className="h-7 rounded-[6px] bg-[#1B6FA8] px-3 font-semibold text-white hover:bg-[#0C3450] disabled:opacity-50" onClick={() => void act("apply")}>
            Zastosuj
          </button>
          <button type="button" disabled={busy} className="h-7 rounded-[6px] border border-[#A9D2EC] bg-white px-3 text-[#1B6FA8] hover:border-[#1B6FA8] disabled:opacity-50" onClick={() => void act("skip")}>
            Tylko nowe rezerwacje
          </button>
        </span>
      </div>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {plan.changes.map((c) => (
            <li key={c.rentalId} className="flex flex-col">
              <a href={`${BASE_PATH}/kalendarz?wynajem=${c.rentalId}`} className="font-medium text-[#1B6FA8] hover:text-[#0C3450]">
                {dm(c.startsAt)} · {c.title}
              </a>
              <span className="text-[11.5px] text-[#5C6166]">
                {c.before ?? "bez kwoty"} → <b className="font-semibold text-[#0C3450]">{c.after}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ blok Warunki

export function TermsBlock({ d, onChanged, notify }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const { save, bar, version } = useTermsSaver(onChanged, notify);
  const [mode, setMode] = useState<"CENNIK" | "IND" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const p = d.profile;
  const prices = d.terms.prices;
  const individual = (mode ?? (prices.length ? "IND" : "CENNIK")) === "IND";
  const listPrice = (code: string, n: number) => d.terms.priceList.find((r) => r.device === code && r.days === n)?.priceNet ?? null;
  const legacy = p.agreedPrice != null && prices.length === 0 ? Number(p.agreedPrice) : null;
  const latest = [...prices.map((x) => x.since), d.terms.transportSince].filter((x): x is string => !!x).sort().pop() ?? null;
  const pulseRate = p.pulseRateNet != null ? String(Number(p.pulseRateNet)) : "";

  const field = (key: string, value: unknown, before: unknown, label: string) => save(label, () => patch(d.id, { [key]: value }), () => patch(d.id, { [key]: before }));

  async function toCennik() {
    if (!prices.length) return setMode("CENNIK");
    if (!window.confirm(`Usunąć ${prices.length} ${prices.length === 1 ? "wyjątek" : "wyjątki"}? Klient wraca do cennika ogólnego, historia wersji zostaje.`)) return;
    const old = prices.map((r) => ({ device: r.device, days: r.days, priceNet: r.priceNet, source: r.source, sourceRef: r.sourceRef, since: ymd(r.since) }));
    const put = async (rows: unknown[]) => {
      const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/prices`, "PUT", { prices: rows });
      return ok ? data.detail : (data.message ?? "Nie udało się zapisać.");
    };
    if (await save("Cennik ogólny — bez wyjątków", () => put([]), () => put(old))) setMode("CENNIK");
  }

  return (
    <Section
      id="warunki"
      title="Warunki"
      action={
        <>
          {latest && <span className="text-[11.5px] text-[#767C82]">od {dm(latest)}</span>}
          <button type="button" className={LINK} onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            Historia wersji
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded-[6px] border border-[#C9D3DC] text-[12px]" role="group" aria-label="Cennik klienta">
          {(
            [
              ["CENNIK", "Cennik ogólny"],
              ["IND", "Indywidualne"],
            ] as const
          ).map(([k, l]) => {
            const on = (k === "IND") === individual;
            return (
              <button
                key={k}
                type="button"
                disabled={agent}
                aria-pressed={on}
                onClick={() => (k === "IND" ? setMode("IND") : void toCennik())}
                className={`border-r border-[#E3E6E9] px-[10px] py-[3px] last:border-0 disabled:cursor-default ${on ? "bg-[#0C3450] text-white" : "text-[#5C6166] hover:bg-[#F4F6F8]"}`}
              >
                {l}
              </button>
            );
          })}
        </span>
        {!individual && <span className="text-[12px] text-[#767C82]">ceny z cennika dla danej liczby dni</span>}
        {bar}
      </div>

      {individual && (
        <div className="mt-1 flex flex-col">
          {prices.map((r) => {
            const list = listPrice(r.device, r.days);
            const base = { device: r.device, days: r.days, priceNet: r.priceNet, source: r.source, sourceRef: r.sourceRef, since: ymd(r.since) };
            const lbl = `${TERMS_DEVICE_LABEL[r.device as TermsDeviceCode] ?? r.device} · ${r.days} ${r.days === 1 ? "dzień" : "dni"}`;
            return (
              <div key={r.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-[#F0F1F2] py-[3px] text-[13px] last:border-0">
                <span className="min-w-[128px] text-[#333333]">{lbl}</span>
                <AutoInput
                  label={`Cena ${lbl}`}
                  value={String(r.priceNet)}
                  width="w-[72px]"
                  disabled={agent}
                  onSave={async (v) => {
                    const n = parseAmount(v);
                    if (n === "invalid" || n == null || n <= 0) return "Cena netto musi być liczbą większą od zera.";
                    await save(`${lbl}: ${money(n)} (nowa wersja od dziś)`, () => priceRow(d.id, { ...base, priceNet: n, since: null }), () => priceRow(d.id, base));
                    return null;
                  }}
                />
                {list != null && <s className="text-[12px] text-[#8A939B]" title="Cena z cennika ogólnego">{num(list)}</s>}
                <span className="text-[11.5px] text-[#767C82]">od</span>
                <AutoInput
                  label={`Obowiązuje od — ${lbl}`}
                  type="date"
                  value={ymd(r.since)}
                  width="w-[128px]"
                  align="text-left"
                  disabled={agent}
                  onSave={async (v) => {
                    if (!v) return "Podaj datę.";
                    await save(`${lbl}: obowiązuje od ${v.split("-").reverse().join(".")}`, () => priceRow(d.id, { ...base, since: v }), () => priceRow(d.id, base));
                    return null;
                  }}
                />
                <AutoSelect
                  label={`Źródło — ${lbl}`}
                  value={r.source ?? ""}
                  disabled={agent}
                  options={[["", "źródło…"], ...PRICE_SOURCES.map((k) => [k, PRICE_SOURCE_LABEL[k]] as [string, string])]}
                  onSave={(v) => void save(`${lbl}: źródło ${v ? PRICE_SOURCE_LABEL[v] : "—"}`, () => priceRow(d.id, { ...base, source: v || null }), () => priceRow(d.id, base))}
                />
                {!agent && (
                  <button
                    type="button"
                    className="ml-auto text-[12px] text-[#8A939B] hover:text-[#B8612F]"
                    title="Usuń wyjątek — ta pozycja wraca do cennika"
                    onClick={() => void save(`Usunięto wyjątek ${lbl}`, () => priceRow(d.id, { ...base, priceNet: null }), () => priceRow(d.id, base))}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          {prices.length === 0 && !adding && <span className="py-1 text-[12.5px] text-[#767C82]">Brak wyjątków — wszystko z cennika ogólnego.</span>}
          {adding ? (
            <NewException d={d} onCancel={() => setAdding(false)} onSave={async (row) => (await save(`Dodano wyjątek ${TERMS_DEVICE_LABEL[row.device]} · ${row.days} d.`, () => priceRow(d.id, row), () => priceRow(d.id, { ...row, priceNet: null }))) && setAdding(false)} />
          ) : (
            !agent && (
              <button type="button" className={`${LINK} mt-1 self-start`} onClick={() => setAdding(true)}>
                + dodaj wyjątek
              </button>
            )
          )}
        </div>
      )}
      {legacy != null && (
        <p className="mt-1 text-[12px] text-[#B8612F]">
          Dawna „cena ustalona” {money(legacy)} netto — dodaj ją jako wyjątek (urządzenie i liczba dni), potem zniknie stąd.
          {!agent && (
            <button type="button" className="ml-1 text-[#1B6FA8] hover:text-[#0C3450]" onClick={() => void field("agreedPrice", null, String(legacy), "Usunięto dawną cenę ustaloną")}>
              usuń
            </button>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-col">
        <Row label="Transport">
          <TransportFixed d={d} save={save} compact />
        </Row>
        <Row label="Faktura">
          <span className="flex flex-wrap items-baseline gap-1">
            <AutoSelect
              label="Faktura"
              value={p.invoiceMode ?? ""}
              disabled={agent}
              options={[["", "nie ustalono"], ...(["FULL", "PARTIAL", "NONE"] as const).map((k) => [k, INVOICE_MODE_LABEL[k]] as [string, string])]}
              onSave={(v) => void field("invoiceMode", v || null, p.invoiceMode, `Faktura: ${v ? INVOICE_MODE_LABEL[v as "FULL"] : "nie ustalono"}`)}
            />
            {p.invoiceMode === "PARTIAL" && (
              <>
                <AutoInput
                  label="Na FV netto"
                  value={p.invoicePartDefault != null ? String(Number(p.invoicePartDefault)) : ""}
                  placeholder="kwota"
                  width="w-[72px]"
                  disabled={agent}
                  onSave={async (v) => {
                    const n = parseAmount(v);
                    if (n === "invalid") return "Kwota musi być liczbą.";
                    await field("invoicePartDefault", n == null ? null : String(n), p.invoicePartDefault != null ? String(Number(p.invoicePartDefault)) : null, `Na FV ${n == null ? "—" : money(n)}`);
                    return null;
                  }}
                />
                <span className="text-[#5C6166]">zł netto na FV</span>
              </>
            )}
          </span>
        </Row>
        <Row label="Płatność">
          <span className="flex flex-wrap items-baseline gap-1">
            <AutoSelect
              label="Forma płatności"
              value={p.paymentForm ?? ""}
              disabled={agent}
              options={[
                ["", "nie ustalono"],
                ["PRZELEW", "przelew"],
                ["GOTOWKA", "gotówka"],
                ["OBA", "gotówka i przelew"],
              ]}
              onSave={(v) => void field("paymentForm", v || null, p.paymentForm, `Płatność: ${v ? PAYMENT_FORM_LABEL[v] : "nie ustalono"}`)}
            />
            <span className="text-[#5C6166]">· termin</span>
            <AutoInput
              label="Termin przelewu (dni)"
              value={p.paymentTermDays != null ? String(p.paymentTermDays) : ""}
              placeholder="—"
              width="w-[48px]"
              disabled={agent}
              onSave={async (v) => {
                const t = v.trim();
                if (t && !/^\d{1,3}$/.test(t)) return "Liczba dni, np. 7.";
                await field("paymentTermDays", t ? Number(t) : null, p.paymentTermDays, `Termin przelewu ${t || "—"} dni`);
                return null;
              }}
            />
            <span className="text-[#5C6166]">dni</span>
          </span>
        </Row>
        <Row label="Impulsy (Alma)">
          <span className="flex flex-wrap items-baseline gap-1">
            <AutoSelect
              label="Impulsy doliczać"
              value={p.pulsesCharged === true ? "tak" : p.pulsesCharged === false ? "nie" : ""}
              disabled={agent}
              options={[
                ["", "do potwierdzenia"],
                ["tak", "doliczać"],
                ["nie", "nie doliczać"],
              ]}
              onSave={(v) => void field("pulsesCharged", v || null, p.pulsesCharged === true ? "tak" : p.pulsesCharged === false ? "nie" : null, `Impulsy: ${v || "do potwierdzenia"}`)}
            />
            <AutoInput
              label="Zł za impuls"
              value={pulseRate}
              placeholder="cennik"
              width="w-[64px]"
              disabled={agent}
              onSave={async (v) => {
                const t = v.replace(",", ".").trim();
                if (t && !(Number(t) >= 0)) return "Stawka musi być liczbą.";
                await field("pulseRateNet", t || null, pulseRate || null, `Stawka ${t || "wg cennika"} zł/imp.`);
                return null;
              }}
            />
            <span className="text-[#5C6166]">zł / imp.</span>
          </span>
        </Row>
        <Row label="Uwagi">
          <AutoInput label="Uwagi do warunków" value={p.paymentTerms ?? ""} placeholder="np. impulsy wg oferty 30.10.2025" multiline align="text-left" width="w-full" disabled={agent} onSave={async (v) => (await field("paymentTerms", v, p.paymentTerms ?? "", "Uwagi do warunków"), null)} />
        </Row>
        <Row label="E-mail do FV">
          <AutoInput label="E-mail do FV" type="email" value={p.invoiceEmail ?? ""} placeholder="uzupełnij" align="text-left" width="w-full" disabled={agent} onSave={async (v) => (await field("invoiceEmail", v, p.invoiceEmail ?? "", "E-mail do FV"), null)} />
        </Row>
        <Row label="Umowa ramowa">
          <FrameAgreement d={d} onChanged={onChanged} notify={notify} save={save} />
        </Row>
      </div>

      <TermsSyncBar d={d} version={version} onChanged={onChanged} notify={notify} />

      {showHistory && (
        <div className="mt-2 border-t border-[#E4E7EA] pt-2">
          {d.terms.history.length === 0 ? (
            <p className="text-[12.5px] text-[#767C82]">Brak zmian warunków w dzienniku.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {d.terms.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums text-[#767C82]">{dmy(h.at)}</span>
                  <span className="text-[#333333]">{historyLabel(h.field)}</span>
                  <span className="text-[#5C6166]">
                    {h.before ?? "—"} → <b className="font-semibold text-[#0C3450]">{h.after ?? "—"}</b>
                  </span>
                  {(h.by || h.source) && <span className="text-[11.5px] text-[#8A939B]">{[h.by, h.source].filter(Boolean).join(" · ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  transportPriceNet: "Transport",
  invoiceMode: "Faktura",
  invoicePartDefault: "Na FV netto",
  paymentForm: "Płatność",
  paymentTermDays: "Termin przelewu",
  pulsesCharged: "Impulsy",
  pulseRateNet: "Zł / impuls",
  paymentTerms: "Uwagi",
};
const historyLabel = (f: string) => HISTORY_LABEL[f] ?? f.replace(/^Cena · /, "");

function NewException({ d, onCancel, onSave }: { d: ClientDetail; onCancel: () => void; onSave: (row: { device: TermsDeviceCode; days: number; priceNet: number; source: string | null; since: string | null }) => void }) {
  const taken = new Set(d.terms.prices.map((r) => `${r.device}|${r.days}`));
  const [device, setDevice] = useState<TermsDeviceCode>(TERMS_DEVICES[0].code);
  const [days, setDays] = useState(1);
  const [price, setPrice] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const list = d.terms.priceList.find((r) => r.device === device && r.days === days)?.priceNet ?? null;
  const SMALL = "h-7 rounded-[4px] border border-[#D6DADE] bg-white px-1.5 text-[13px] outline-none focus:border-[#1B6FA8]";
  function submit() {
    const n = parseAmount(price);
    if (n === "invalid" || n == null || n <= 0) return setError("Cena netto musi być liczbą większą od zera.");
    if (taken.has(`${device}|${days}`)) return setError("Ten wyjątek już jest — zmień jego cenę wyżej.");
    onSave({ device, days, priceNet: n, source: source || null, since: null });
  }
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={SMALL} value={device} onChange={(e) => setDevice(e.target.value as TermsDeviceCode)} aria-label="Urządzenie / wariant">
          {TERMS_DEVICES.map((x) => (
            <option key={x.code} value={x.code}>
              {x.label}
            </option>
          ))}
        </select>
        <select className={SMALL} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Dni">
          {TERMS_DAYS.map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "dzień" : "dni"}
            </option>
          ))}
        </select>
        <input
          ref={ref}
          autoFocus
          className={`${SMALL} w-[80px] text-right`}
          inputMode="decimal"
          placeholder={list != null ? String(list) : "cena"}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          aria-label="Cena netto"
        />
        {list != null && <span className="text-[12px] text-[#8A939B]">cennik {num(list)}</span>}
        <select className={SMALL} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Źródło">
          <option value="">źródło…</option>
          {PRICE_SOURCES.map((k) => (
            <option key={k} value={k}>
              {PRICE_SOURCE_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="button" className="h-7 rounded-[6px] bg-[#1B6FA8] px-2.5 text-[12.5px] font-semibold text-white hover:bg-[#0C3450]" onClick={submit}>
          Dodaj
        </button>
        <button type="button" className="text-[12.5px] text-[#767C82] hover:text-[#0C3450]" onClick={onCancel}>
          Anuluj
        </button>
      </div>
      {error && <span className="text-[11.5px] text-[#B8612F]">{error}</span>}
    </div>
  );
}

function FrameAgreement({ d, onChanged, notify, save }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void; save: Saver }): ReactNode {
  const agent = useContext(AgentModeContext);
  const fa = d.profile.frameAgreement;
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    if (fa?.signedAt) form.set("signedAt", fa.signedAt);
    if (fa?.note) form.set("note", fa.note);
    const res = await fetch(`${BASE_PATH}/api/clients/${d.id}/frame-agreement`, { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { detail?: ClientDetail; message?: string };
    setBusy(false);
    if (!res.ok || !data.detail) return notify(data.message ?? "Nie udało się wgrać umowy.", true);
    onChanged(data.detail);
    notify("Zapisano umowę ramową.");
  }
  const meta = (k: "signedAt" | "note", v: string | null, label: string) =>
    save(label, () => patch(d.id, { frameAgreement: { ...fa, [k]: v } }), () => patch(d.id, { frameAgreement: fa ?? null }));
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-2">
        {fa?.fileId ? (
          <a href={`${BASE_PATH}/api/clients/${d.id}/frame-agreement`} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:text-[#0C3450]">
            {fa.name ?? "umowa"}
          </a>
        ) : fa?.url ? (
          <a href={fa.url} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:text-[#0C3450]">
            {fa.name ?? "umowa (link)"}
          </a>
        ) : (
          <Missing>brak pliku</Missing>
        )}
        {!agent && (
          <label className="cursor-pointer text-[12px] text-[#1B6FA8] hover:text-[#0C3450]">
            {busy ? "wgrywam…" : fa?.fileId ? "zmień plik" : "wgraj PDF / zdjęcie"}
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        )}
      </span>
      {(fa?.fileId || fa?.url) && (
        <span className="flex flex-wrap items-baseline gap-1 text-[12px] text-[#5C6166]">
          podpisana
          <AutoInput label="Data podpisania" type="date" value={fa?.signedAt ?? ""} width="w-[128px]" align="text-left" disabled={agent} onSave={async (v) => (await meta("signedAt", v || null, "Data podpisania umowy"), null)} />
          <AutoInput label="Uwagi do umowy" value={fa?.note ?? ""} placeholder="np. kaucja 2000 zł" width="w-[160px]" align="text-left" disabled={agent} onSave={async (v) => (await meta("note", v || null, "Uwagi do umowy"), null)} />
        </span>
      )}
    </span>
  );
}
