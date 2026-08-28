"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DevicePricingCategory, RentalEventType } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import type { RentalFinanceDto } from "@/lib/finance";
import { DOUBLE_VARIANT, FLEX_VARIANT } from "@/lib/pricing/variants";
import { parseAmount, previewFlexPrice, previewTotals, type PreviewContext } from "@/lib/pricing/preview";

function fmt(n: number): string {
  return new Intl.NumberFormat("pl-PL", {
    useGrouping: "always",
    minimumFractionDigits: Math.abs(n - Math.trunc(n)) > 1e-9 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export function DriverFinancePanel({
  rentalId,
  eventType,
  pricingCategory,
  finance,
  initialDriverNotes,
  previewCtx,
  durationDays,
  transportPrice,
  capFeeHsNet,
  almaPulseRateNet,
}: {
  rentalId: string;
  eventType: RentalEventType;
  pricingCategory: DevicePricingCategory | null;
  finance: RentalFinanceDto | null;
  initialDriverNotes: string;
  previewCtx: PreviewContext;
  durationDays: number;
  transportPrice: string | null;
  capFeeHsNet: number;
  almaPulseRateNet: number;
}) {
  const router = useRouter();
  const isSzkolenie = eventType === "SZKOLENIE";

  const [start, setStart] = useState(finance?.pulseCounterStart != null ? String(finance.pulseCounterStart) : "");
  const [end, setEnd] = useState(finance?.pulseCounterEnd != null ? String(finance.pulseCounterEnd) : "");
  const [capUsed, setCapUsed] = useState<boolean>(finance?.capUsedHS ?? false);
  const [cashCollected, setCashCollected] = useState<boolean>(finance?.cashCollected ?? false);
  const [notes, setNotes] = useState(initialDriverNotes);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const variant = finance?.deviceVariant ?? null;
  const isFlex = !isSzkolenie && pricingCategory === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT;
  const isDouble = !isSzkolenie && variant === DOUBLE_VARIANT;
  const isAlma = !isSzkolenie && pricingCategory === "ALMA_HARMONY";
  const needsCounters = isFlex || isAlma;

  const startN = start === "" ? null : Number(start);
  const endN = end === "" ? null : Number(end);
  const countersFilled = startN != null && endN != null;
  const countersValid =
    !needsCounters ||
    (start === "" && end === "") ||
    (countersFilled && Number.isInteger(startN) && Number.isInteger(endN) && startN >= 0 && endN >= startN);
  const pulsesUsed = countersFilled && countersValid ? (endN as number) - (startN as number) : null;

  const { net, gross, rows, pending } = useMemo(() => {
    if (!finance) return { net: 0, gross: 0, rows: [] as { label: string; value: number }[], pending: false };

    const baseFromFinance = Number(finance.baseRentalPriceNet) || 0;
    const baseNet = isFlex && pulsesUsed != null ? previewFlexPrice(previewCtx, durationDays, pulsesUsed) ?? baseFromFinance : baseFromFinance;

    const surcharge = isAlma
      ? pulsesUsed != null
        ? pulsesUsed * almaPulseRateNet
        : Number(finance.pulseSurchargeNet ?? 0) || 0
      : 0;

    const capFee = Number(finance.capFeeNet ?? capFeeHsNet) || 0;
    const transportN = isSzkolenie ? null : parseAmount(transportPrice);
    const vatApplicable = finance.vatApplicable;
    const vatRate = Number(finance.vatRate) || 0;

    const t = previewTotals({
      baseNet,
      pulseSurchargeNet: surcharge || null,
      transportNet: transportN,
      capFeeNet: capFee,
      capUsed,
      vatApplicable,
      vatRate,
      isSzkolenie,
    });

    const r: { label: string; value: number }[] = [{ label: isSzkolenie ? "Szkolenie" : "Wynajem", value: baseNet }];
    if (!isSzkolenie && transportN) r.push({ label: "Transport", value: transportN });
    if (surcharge) r.push({ label: "Dopłata za impulsy", value: surcharge });
    if (capUsed && capFee) r.push({ label: "Nakładka HS", value: capFee });
    if (vatApplicable) r.push({ label: `VAT ${vatRate}%`, value: round2(t.gross - t.net) });

    const isPending = needsCounters && pulsesUsed == null;
    return { net: t.net, gross: t.gross, rows: r, pending: isPending };
  }, [
    finance,
    isFlex,
    isAlma,
    isSzkolenie,
    pulsesUsed,
    previewCtx,
    durationDays,
    almaPulseRateNet,
    capFeeHsNet,
    capUsed,
    transportPrice,
    needsCounters,
  ]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const payload: Record<string, unknown> = { driverNotes: notes.trim() || null, cashCollected };
    if (isDouble) payload.capUsedHS = capUsed;
    if (needsCounters) {
      payload.pulseCounterStart = start === "" ? null : Number(start);
      payload.pulseCounterEnd = end === "" ? null : Number(end);
    }

    const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/finance/driver`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setIsSaving(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się zapisać.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  // Brak rozliczenia przygotowanego przez biuro — kierowca może zostawić tylko uwagi.
  if (!finance) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Biuro nie przygotowało jeszcze rozliczenia tego wydarzenia.
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Uwagi kierowcy</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">Zapisano.</p>}
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    );
  }

  const isCash = finance.paymentMethod === "CASH";
  const displayAmount = gross;

  return (
    <div className="flex flex-col gap-4">
      {/* Banner płatności */}
      <div
        className={`rounded-xl px-5 py-5 text-center ${
          isCash ? "bg-gradient-to-b from-orange-500 to-orange-700 text-white shadow-lg shadow-orange-500/30" : "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
        }`}
      >
        <div className="text-xs font-bold uppercase tracking-wider opacity-90">
          {isCash ? "💵 Gotówka" : "🏦 Przelew"}
        </div>
        <div className="mt-1 text-4xl font-extrabold tabular-nums">{fmt(displayAmount)} zł</div>
        <div className="mt-1 text-sm opacity-80">
          {isCash ? "do odebrania od klientki" : "klientka płaci przelewem — nie pobieraj gotówki"}
        </div>
        {pending && (
          <div className="mt-1 text-xs opacity-80">kwota tymczasowa — uzupełnij liczniki impulsów poniżej</div>
        )}
        {isCash && (
          <label className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold ring-1 ring-white/25">
            <input type="checkbox" checked={cashCollected} onChange={(e) => setCashCollected(e.target.checked)} />
            Gotówka odebrana
          </label>
        )}
      </div>

      {!isCash && (
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={cashCollected} onChange={(e) => setCashCollected(e.target.checked)} />
          Płatność potwierdzona
        </label>
      )}

      {/* Rozbicie kwoty — domyślnie zwinięte */}
      <details className="rounded-lg border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600">Rozbicie kwoty</summary>
        <div className="border-t border-gray-100 px-4 py-3 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between py-0.5 text-gray-700">
              <span>{r.label}</span>
              <span className="font-medium tabular-nums">{fmt(r.value)} zł</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-900">
            <span>{finance.vatApplicable ? "Razem brutto" : "Razem netto"}</span>
            <span className="tabular-nums">{fmt(finance.vatApplicable ? gross : net)} zł</span>
          </div>
        </div>
      </details>

      {/* Nakładka HS — tylko podwójna głowica */}
      {isDouble && (
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={capUsed} onChange={(e) => setCapUsed(e.target.checked)} />
          Nakładka HS zużyta podczas zabiegu
        </label>
      )}

      {/* Liczniki impulsów */}
      {needsCounters && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Liczniki impulsów</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Początkowy
              <input
                value={start}
                onChange={(e) => setStart(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Końcowy
              <input
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                inputMode="numeric"
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm text-gray-900 focus:outline-none ${
                  countersValid ? "border-gray-300 focus:border-gray-500" : "border-red-400 focus:border-red-500"
                }`}
              />
            </label>
          </div>
          {!countersValid && (
            <p className="mt-1 text-xs text-red-600">Licznik końcowy nie może być mniejszy niż początkowy.</p>
          )}
        </div>
      )}

      {/* Uwagi kierowcy */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Uwagi kierowcy</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="np. utrudniony dojazd, klientka prosiła o kontakt przed odbiorem…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Zapisano.</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !countersValid}
        className="rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {isSaving ? "Zapisywanie…" : "Zapisz"}
      </button>
    </div>
  );
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
