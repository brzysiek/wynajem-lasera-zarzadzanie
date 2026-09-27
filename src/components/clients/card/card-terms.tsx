"use client";

import { useContext, useState } from "react";
import type { ClientDetail } from "@/lib/clients/load";
import { BASE_PATH } from "@/lib/base-path";
import { AgentModeContext, FormError, INPUT, api } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY, LINK, Missing, Row, Section, dmy, money, num } from "./kit";
import { INVOICE_MODE_LABEL, PRICE_SOURCES, PRICE_SOURCE_LABEL, TERMS_DAYS, TERMS_DEVICES, type TermsDeviceCode } from "@/lib/clients/terms-rules";

// „Warunki handlowe” na karcie klienta (etap C, wg karta-kierunek.html;
// ADMIN/STAFF edytują, agent tylko proponuje): tabela cen klienta (urządzenie ×
// dni, brak = cennik ogólny*), transport za kurs, impulsy, faktura (całość /
// część / bez FV), forma i termin płatności, uwagi, e-mail do FV, umowa ramowa.

export const PAYMENT_FORM_LABEL: Record<string, string> = {
  GOTOWKA: "gotówka",
  PRZELEW: "przelew",
  OBA: "gotówka i przelew",
};

// „Cena ustalona” (kafel liczb na górze): dawna cena ustalona albo — po
// rozpisaniu na urządzenia — pierwsza cena klienta za 1 dzień.
export function agreedTotal(d: ClientDetail): {
  rental: number | null;
  transport: number | null;
  total: number | null;
} {
  const firstDay = TERMS_DEVICES.map((x) => d.terms.prices.find((r) => r.device === x.code && r.days === 1)).find(Boolean);
  const rental = d.profile.agreedPrice ? Number(d.profile.agreedPrice) : (firstDay?.priceNet ?? null);
  const transport = d.transportPriceNet ? Number(d.transportPriceNet) : null;
  return {
    rental,
    transport,
    total: rental != null ? rental + (transport ?? 0) : null,
  };
}

const toForm = (cash: boolean, transfer: boolean) => (cash && transfer ? "OBA" : cash ? "GOTOWKA" : transfer ? "PRZELEW" : null);

export function TermsSection({ d, onChanged, notify }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [edit, setEdit] = useState(false);
  const p = d.profile;
  const fa = p.frameAgreement;
  const prices = d.terms.prices;
  const devices = TERMS_DEVICES.filter((x) => prices.some((r) => r.device === x.code));
  const days = [...new Set([1, 2, 3, ...prices.map((r) => r.days)])].sort((a, b) => a - b);
  const listPrice = (code: string, n: number) => d.terms.priceList.find((r) => r.device === code && r.days === n)?.priceNet ?? null;
  const transport = d.transportPriceNet && Number(d.transportPriceNet) > 0 ? Number(d.transportPriceNet) : null;
  const pulseRate = p.pulseRateNet != null ? Number(p.pulseRateNet) : null;
  const legacy = p.agreedPrice != null && prices.length === 0 ? Number(p.agreedPrice) : null;
  const TH = "border-b border-[#D6DADE] px-1.5 py-1 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-[#5C6166]";
  const TD = "border-b border-[#F0F1F2] px-1.5 py-[5px]";

  return (
    <Section
      title="Warunki handlowe"
      action={
        !agent &&
        !edit && (
          <button type="button" onClick={() => setEdit(true)} className={LINK}>
            Edytuj
          </button>
        )
      }
    >
      {edit ? (
        <TermsEditor
          d={d}
          onCancel={() => setEdit(false)}
          onSaved={(n, note) => {
            setEdit(false);
            onChanged(n);
            notify(`Zapisano warunki handlowe.${note ? ` ${note}` : ""}`);
          }}
        />
      ) : (
        <>
          <table className="mt-1 w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={TH}>Urządzenie / wariant</th>
                {days.map((n) => (
                  <th key={n} className={`${TH} text-right`}>
                    {n} {n === 1 ? "dzień" : "dni"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((x) => (
                <tr key={x.code}>
                  <td className={TD}>{x.label}</td>
                  {days.map((n) => {
                    const own = prices.find((r) => r.device === x.code && r.days === n);
                    const list = listPrice(x.code, n);
                    return (
                      <td
                        key={n}
                        className={`${TD} text-right tabular-nums`}
                        title={own ? [own.source ? PRICE_SOURCE_LABEL[own.source] : null, own.sourceRef].filter(Boolean).join(" · ") || undefined : "wg cennika ogólnego"}
                      >
                        {own ? (
                          <span className="font-medium text-[#0C3450]">{num(own.priceNet)}</span>
                        ) : list != null ? (
                          <span className="text-[#8A939B]">{num(list)}*</span>
                        ) : (
                          <span className="text-[#C3C7CB]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className={`${TD} text-[#8A939B]`}>{devices.length ? "pozostałe" : "wszystkie urządzenia"}</td>
                <td className={`${TD} text-[#8A939B]`} colSpan={days.length}>
                  wg cennika ogólnego*
                </td>
              </tr>
            </tbody>
          </table>
          {legacy != null && <p className="mt-1 text-[12px] text-[#B8612F]">Dawna „cena ustalona” {money(legacy)} netto — przypisz ją do urządzenia w edycji (Edytuj).</p>}
          <p className="mb-1 mt-1 text-[11px] text-[#8A939B]">* cennik ogólny (Ustawienia → Cennik); ceny klienta mają pierwszeństwo w nowej rezerwacji.</p>
          <Row label="Transport">
            {transport != null ? (
              <>
                {money(transport)} / kurs <span className="text-[#767C82]">· 2 urządzenia jednego dnia = 1 kurs</span>
              </>
            ) : (
              <Missing>uzupełnij stawkę za kurs</Missing>
            )}
          </Row>
          <Row label="Impulsy">
            Alma {pulseRate != null ? `${pulseRate.toLocaleString("pl-PL")} zł/imp.` : "wg cennika"} – doliczać:{" "}
            <b className="font-semibold">{p.pulsesCharged === true ? "tak" : p.pulsesCharged === false ? "nie" : "do potwierdzenia"}</b>
          </Row>
          <Row label="Faktura">
            <Seg
              options={(["FULL", "PARTIAL", "NONE"] as const).map((k) => ({
                key: k,
                label: INVOICE_MODE_LABEL[k],
              }))}
              value={p.invoiceMode}
            />
            {p.invoiceMode === "PARTIAL" && (
              <span className="text-[#5C6166]"> {p.invoicePartDefault ? `${money(Number(p.invoicePartDefault))} netto na FV` : <Missing>ustal kwotę na FV</Missing>}</span>
            )}
            {!p.invoiceMode && <span className="text-[12px] text-[#B8612F]"> ustal</span>}
          </Row>
          <Row label="Płatność">
            <Seg
              options={[
                { key: "PRZELEW", label: "przelew" },
                { key: "GOTOWKA", label: "gotówka" },
                { key: "OBA", label: "oba" },
              ]}
              value={p.paymentForm}
            />
            {p.paymentTermDays != null && <span className="text-[#5C6166]"> · przelew {p.paymentTermDays} dni</span>}
            {!p.paymentForm && <span className="text-[12px] text-[#B8612F]"> ustal</span>}
          </Row>
          {p.paymentTerms && <Row label="Uwagi">{p.paymentTerms}</Row>}
          <Row label="E-mail do FV">{p.invoiceEmail ?? <Missing>uzupełnij</Missing>}</Row>
          <Row label="Umowa ramowa">
            {fa?.fileId ? (
              <>
                <a href={`${BASE_PATH}/api/clients/${d.id}/frame-agreement`} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:text-[#0C3450]">
                  {fa.name ?? "umowa"}
                </a>
                {fa.signedAt && <span className="text-[#5C6166]"> · podpisana {dmy(fa.signedAt)}</span>}
                {fa.note && <span className="text-[#5C6166]"> · {fa.note}</span>}
              </>
            ) : fa?.url ? (
              <a href={fa.url} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:text-[#0C3450]">
                {fa.name ?? "umowa (link)"}
              </a>
            ) : (
              <Missing>brak pliku</Missing>
            )}
          </Row>
        </>
      )}
    </Section>
  );
}

// Przełącznik jak we wzorze (tylko do odczytu): wybrana opcja ciemna.
function Seg({ options, value }: { options: { key: string; label: string }[]; value: string | null }) {
  return (
    <span className="inline-flex overflow-hidden rounded-[6px] border border-[#C9D3DC] align-middle text-[12px]">
      {options.map((o) => (
        <span key={o.key} className={`border-r border-[#E3E6E9] px-[9px] py-px last:border-0 ${o.key === value ? "bg-[#0C3450] text-white" : "text-[#5C6166]"}`}>
          {o.label}
        </span>
      ))}
    </span>
  );
}

// Główne urządzenie klienta → kod tabeli cen (podpowiedź przy rozpisywaniu
// dawnej „ceny ustalonej”).
const FAVORITE_CODE: Record<string, TermsDeviceCode> = {
  LIGHTSHEER: "LS_1G",
  LIGHTSHEER_ET400: "ET400",
  ALMA_HARMONY: "ALMA_DYEVL",
  COOLTECH: "COOLTECH",
  RESURFX: "RESURFX",
  OBSERV: "OBSERV",
};

type PriceDraft = {
  key: string;
  device: TermsDeviceCode;
  days: string;
  priceNet: string;
  source: string;
  sourceRef: string;
};

function TermsEditor({ d, onCancel, onSaved }: { d: ClientDetail; onCancel: () => void; onSaved: (n: ClientDetail, note?: string) => void }) {
  const p = d.profile;
  const legacy = p.agreedPrice != null && d.terms.prices.length === 0 ? Number(p.agreedPrice) : null;
  const [rows, setRows] = useState<PriceDraft[]>(() =>
    d.terms.prices.length
      ? d.terms.prices.map((r) => ({
          key: r.id,
          device: r.device as TermsDeviceCode,
          days: String(r.days),
          priceNet: String(r.priceNet),
          source: r.source ?? "",
          sourceRef: r.sourceRef ?? "",
        }))
      : legacy != null
        ? [
            {
              key: "legacy",
              device: (d.summary.favoriteDevice && FAVORITE_CODE[d.summary.favoriteDevice]) || "LS_1G",
              days: "1",
              priceNet: String(legacy),
              source: "USTALENIE",
              sourceRef: "dawna cena ustalona",
            },
          ]
        : [],
  );
  const [f, setF] = useState({
    transport: d.transportPriceNet ? String(Number(d.transportPriceNet)) : "",
    pulsesCharged: p.pulsesCharged === true ? "tak" : p.pulsesCharged === false ? "nie" : "",
    pulseRate: p.pulseRateNet != null ? String(Number(p.pulseRateNet)) : "",
    invoiceMode: p.invoiceMode ?? "",
    invoicePart: p.invoicePartDefault != null ? String(Number(p.invoicePartDefault)) : "",
    cash: p.paymentForm === "GOTOWKA" || p.paymentForm === "OBA",
    transfer: p.paymentForm === "PRZELEW" || p.paymentForm === "OBA",
    termDays: p.paymentTermDays != null ? String(p.paymentTermDays) : "",
    notes: p.paymentTerms ?? "",
    email: p.invoiceEmail ?? "",
    signedAt: p.frameAgreement?.signedAt ?? "",
    note: p.frameAgreement?.note ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (key: string, patch: Partial<PriceDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    const faChanged = !file && !removeFile && p.frameAgreement && (f.signedAt !== (p.frameAgreement.signedAt ?? "") || f.note !== (p.frameAgreement.note ?? ""));
    // Najpierw ceny (walidacja tabeli), potem pola klienta.
    let { ok, data } = await api<{ detail: ClientDetail; synced?: { filled: number; updated: number; manual: number } | null }>(`/api/clients/${d.id}/prices`, "PUT", {
      prices: rows.map((r) => ({
        device: r.device,
        days: Number(r.days),
        priceNet: r.priceNet,
        source: r.source || null,
        sourceRef: r.sourceRef || null,
      })),
    });
    const synced = ok ? data.synced : null;
    if (ok) {
      ({ ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}`, "PATCH", {
        transportPriceNet: f.transport,
        pulsesCharged: f.pulsesCharged || null,
        pulseRateNet: f.pulseRate,
        invoiceMode: f.invoiceMode || null,
        invoicePartDefault: f.invoiceMode === "PARTIAL" ? f.invoicePart : null,
        paymentForm: toForm(f.cash, f.transfer),
        paymentTermDays: f.termDays.trim() ? Number(f.termDays) : null,
        paymentTerms: f.notes,
        invoiceEmail: f.email,
        // Dawna „cena ustalona” rozpisana na urządzenie — nie trzymamy jej podwójnie.
        ...(legacy != null && rows.length > 0 ? { agreedPrice: null } : {}),
        ...(faChanged
          ? {
              frameAgreement: {
                ...p.frameAgreement,
                signedAt: f.signedAt || null,
                note: f.note || null,
              },
            }
          : {}),
      }));
    }
    if (ok && removeFile) ({ ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/frame-agreement`, "DELETE"));
    if (ok && file) {
      const form = new FormData();
      form.set("file", file);
      if (f.signedAt) form.set("signedAt", f.signedAt);
      if (f.note) form.set("note", f.note);
      const res = await fetch(`${BASE_PATH}/api/clients/${d.id}/frame-agreement`, { method: "POST", body: form });
      data = await res.json().catch(() => ({}));
      ok = res.ok;
    }
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    const n = synced ? synced.filled + synced.updated : 0;
    onSaved(
      data.detail,
      synced && (n || synced.manual)
        ? [n ? `Przyszłe rezerwacje wg warunków: ${n}.` : null, synced.manual ? `Ręcznych kwot bez zmian: ${synced.manual} (Klienci → Kwoty wg warunków).` : null].filter(Boolean).join(" ")
        : undefined,
    );
  }

  const label = "flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-[#5C6166]";
  const SMALL = "h-8 rounded-[6px] border border-[var(--c-border)] bg-white px-2 text-[13px] text-[var(--c-text)] outline-none focus:border-[var(--c-brand)]";
  return (
    <div className="flex flex-col gap-3 pt-1">
      <fieldset className={label}>
        <legend className="mb-1">Ceny klienta (netto za wynajem) — brak wiersza = cennik ogólny</legend>
        <div className="flex flex-col gap-1.5 normal-case tracking-normal">
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center gap-1.5">
              <select className={`${SMALL} w-[170px]`} value={r.device} onChange={(e) => setRow(r.key, { device: e.target.value as TermsDeviceCode })}>
                {TERMS_DEVICES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select className={`${SMALL} w-[88px]`} value={r.days} onChange={(e) => setRow(r.key, { days: e.target.value })}>
                {[...new Set([...TERMS_DAYS.map(String), r.days])].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === "1" ? "dzień" : "dni"}
                  </option>
                ))}
              </select>
              <input className={`${SMALL} w-[80px] text-right`} inputMode="decimal" value={r.priceNet} onChange={(e) => setRow(r.key, { priceNet: e.target.value })} placeholder="zł" />
              <select className={`${SMALL} w-[104px]`} value={r.source} onChange={(e) => setRow(r.key, { source: e.target.value })} title="Skąd ta cena">
                <option value="">źródło…</option>
                {PRICE_SOURCES.map((x) => (
                  <option key={x} value={x}>
                    {PRICE_SOURCE_LABEL[x]}
                  </option>
                ))}
              </select>
              <input className={`${SMALL} min-w-[120px] flex-1`} value={r.sourceRef} onChange={(e) => setRow(r.key, { sourceRef: e.target.value })} placeholder="np. oferta 30.10.2025" />
              <button type="button" className="text-[12.5px] text-[#767C82] hover:text-[#B8612F]" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} title="Usuń wiersz">
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${LINK} self-start`}
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  key: `n${Date.now()}`,
                  device: rs[rs.length - 1]?.device ?? "LS_1G",
                  days: "1",
                  priceNet: "",
                  source: "",
                  sourceRef: "",
                },
              ])
            }
          >
            + dodaj cenę
          </button>
          {legacy != null && <span className="text-[12px] text-[#B8612F]">Dawna „cena ustalona” {money(legacy)} — sprawdź urządzenie i liczbę dni; po zapisie zostanie tylko w tabeli.</span>}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-3">
        <label className={label}>
          Transport / kurs
          <input className={INPUT} inputMode="decimal" value={f.transport} onChange={(e) => set("transport", e.target.value)} placeholder="np. 70" />
        </label>
        <label className={label}>
          Impulsy
          <select className={INPUT} value={f.pulsesCharged} onChange={(e) => set("pulsesCharged", e.target.value)}>
            <option value="">do potwierdzenia</option>
            <option value="tak">tak</option>
            <option value="nie">nie</option>
          </select>
        </label>
        <label className={label}>
          Zł / impuls
          <input className={INPUT} inputMode="decimal" value={f.pulseRate} onChange={(e) => set("pulseRate", e.target.value)} placeholder="cennik" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Faktura
          <select className={INPUT} value={f.invoiceMode} onChange={(e) => set("invoiceMode", e.target.value)}>
            <option value="">nie ustalono</option>
            <option value="FULL">całość na FV</option>
            <option value="PARTIAL">część na FV</option>
            <option value="NONE">bez FV</option>
          </select>
        </label>
        {f.invoiceMode === "PARTIAL" && (
          <label className={label}>
            Na FV netto (zł)
            <input className={INPUT} inputMode="decimal" value={f.invoicePart} onChange={(e) => set("invoicePart", e.target.value)} placeholder="np. 500" />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className={label}>
          <legend className="mb-1">Forma płatności (można obie)</legend>
          <div className="flex gap-5 text-[13px] normal-case tracking-normal text-[#333333]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.cash} onChange={(e) => set("cash", e.target.checked)} /> gotówka
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.transfer} onChange={(e) => set("transfer", e.target.checked)} /> przelew
            </label>
          </div>
        </fieldset>
        <label className={label}>
          Termin przelewu (dni)
          <input className={INPUT} inputMode="numeric" value={f.termDays} onChange={(e) => set("termDays", e.target.value)} placeholder="np. 7" />
        </label>
      </div>
      <label className={label}>
        Uwagi do warunków
        <textarea
          rows={2}
          className="w-full resize-y rounded-lg border border-[var(--c-border)] px-3 py-2 text-sm normal-case tracking-normal text-[var(--c-text)] outline-none focus:border-[var(--c-brand)]"
          value={f.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="np. impulsy nie doliczane wg oferty 30.10.2025 — do potwierdzenia"
        />
      </label>
      <label className={label}>
        E-mail do FV
        <input className={INPUT} inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
      </label>
      <fieldset className={`${label} border border-[#E4E7EA] p-4`}>
        <legend className="px-1">Umowa ramowa / kaucja</legend>
        {p.frameAgreement?.fileId && !removeFile && (
          <div className="flex items-center gap-3 text-[13px] normal-case tracking-normal text-[#333333]">
            obecny plik: {p.frameAgreement.name}
            <button type="button" className="text-[12.5px] text-[#B8612F] hover:underline" onClick={() => setRemoveFile(true)}>
              usuń
            </button>
          </div>
        )}
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="text-[12.5px] normal-case tracking-normal" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="normal-case tracking-normal">PDF, JPG albo PNG, do 8 MB. Nowy plik zastępuje poprzedni.</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Data podpisania
            <input type="date" className={INPUT} value={f.signedAt} onChange={(e) => set("signedAt", e.target.value)} />
          </label>
          <label className={label}>
            Uwagi
            <input className={INPUT} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="np. kaucja 2000 zł" />
          </label>
        </div>
      </fieldset>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_OUTLINE} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void save()}>
          {busy ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </div>
  );
}
