"use client";

import { useEffect, useMemo, useState } from "react";
import type { DevicePricingCategory, PaymentMethod, RentalEventType } from "@prisma/client";
import type { RentalFinanceDto } from "@/lib/finance";
import { DOUBLE_VARIANT, FLEX_VARIANT, variantLabel } from "@/lib/pricing/variants";
import {
  parseAmount,
  previewBasePrice,
  previewTotals,
  TRANSPORT_VAT_RATE_PREVIEW,
  type PreviewPriceRule,
  type PreviewPulseTier,
} from "@/lib/pricing/preview";

export type FinancePayload = {
  deviceVariant: string | null;
  baseRentalPriceNet?: string; // tylko gdy ręczne / brak w cenniku / szkolenie
  baseRentalPriceOverrideNote?: string;
  vatApplicable: boolean;
  vatRate: number;
  paymentMethod: PaymentMethod;
  // --- transport ---
  transportPriceNet: string; // "" = brak
  transportPaidSeparately: boolean;
  transportVatApplicable: boolean;
  transportPaymentMethod: PaymentMethod;
};

function fmt(n: number): string {
  return new Intl.NumberFormat("pl-PL", {
    useGrouping: "always",
    minimumFractionDigits: Math.abs(n - Math.trunc(n)) > 1e-9 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function PayToggle({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="flex w-full overflow-hidden rounded-md border border-gray-300">
      {(["CASH", "TRANSFER"] as PaymentMethod[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`flex-1 px-3 py-1.5 text-center text-sm font-medium ${
            value === m ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {m === "CASH" ? "Gotówka" : "Przelew"}
        </button>
      ))}
    </div>
  );
}

export function RentalFinanceSection({
  eventType,
  pricingCategory,
  deviceVariantOptions,
  durationDays,
  transportPrice,
  onTransportPriceChange,
  transportPriceHint,
  previewPriceRules,
  previewPulseTiers,
  defaultVatRate,
  initialFinance,
  onChange,
}: {
  eventType: RentalEventType;
  pricingCategory: DevicePricingCategory | null;
  deviceVariantOptions: string[];
  durationDays: number;
  // Cena transportu (netto) — trzymana w rodzicu (żeby przypisanie kontaktu
  // HubSpot mogło ją podpowiedzieć na żywo), tu tylko edytowana.
  transportPrice: string;
  onTransportPriceChange: (v: string) => void;
  // Surowa wartość „ustalona_cena_transportu" z HubSpot — do wiersza podpowiedzi.
  transportPriceHint: string | null;
  previewPriceRules: PreviewPriceRule[];
  previewPulseTiers: PreviewPulseTier[];
  defaultVatRate: number;
  initialFinance: RentalFinanceDto | null;
  onChange: (payload: FinancePayload) => void;
}) {
  const isSzkolenie = eventType === "SZKOLENIE";

  const [deviceVariant, setDeviceVariant] = useState<string>(initialFinance?.deviceVariant ?? "");
  const [manualMode, setManualMode] = useState<boolean>(initialFinance?.baseRentalPriceSource === "MANUAL");
  const [manualPrice, setManualPrice] = useState<string>(
    initialFinance && initialFinance.baseRentalPriceSource === "MANUAL" ? initialFinance.baseRentalPriceNet : "",
  );
  const [overrideNote, setOverrideNote] = useState<string>(initialFinance?.baseRentalPriceOverrideNote ?? "");
  const [vatApplicable, setVatApplicable] = useState<boolean>(initialFinance?.vatApplicable ?? false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialFinance?.paymentMethod ?? "CASH");

  // --- transport (kwota w rodzicu; tu tylko przełączniki) ---
  const [transportSeparate, setTransportSeparate] = useState<boolean>(initialFinance?.transportPaidSeparately ?? false);
  const [transportVat, setTransportVat] = useState<boolean>(initialFinance?.transportVatApplicable ?? false);
  const [transportPayment, setTransportPayment] = useState<PaymentMethod>(
    initialFinance?.transportPaymentMethod ?? "CASH",
  );

  const vatRate = initialFinance ? Number(initialFinance.vatRate) || defaultVatRate : defaultVatRate;
  const ctx = useMemo(() => ({ priceRules: previewPriceRules, pulseTiers: previewPulseTiers }), [previewPriceRules, previewPulseTiers]);

  // Wariant, który realnie liczymy (szkolenie = bez wariantu).
  const effVariant = isSzkolenie ? null : deviceVariant || null;
  const isFlex = pricingCategory === "LIGHTSHEER_VARIANT" && effVariant === FLEX_VARIANT;
  const isDouble = effVariant === DOUBLE_VARIANT;
  const needsCounters = isFlex || pricingCategory === "ALMA_HARMONY";

  const base = useMemo(
    () => previewBasePrice(ctx, isSzkolenie ? null : pricingCategory, effVariant, durationDays),
    [ctx, isSzkolenie, pricingCategory, effVariant, durationDays],
  );

  // Czy pole ceny jest ręczne: szkolenie zawsze, brak reguły w cenniku, albo
  // świadome nadpisanie. Flex nigdy (placeholder do przeliczenia z liczników).
  const priceIsManual = !isFlex && (isSzkolenie || base.priceNet == null || manualMode);
  const effectiveBaseNet = isFlex
    ? base.priceNet ?? 0
    : priceIsManual
      ? parseAmount(manualPrice) ?? 0
      : base.priceNet ?? 0;

  const transportSeparateEff = !isSzkolenie && transportSeparate;

  const totals = useMemo(
    () =>
      previewTotals({
        baseNet: effectiveBaseNet,
        pulseSurchargeNet: null, // dopłata Alma i nakładka HS — po stronie kierowcy
        transportNet: parseAmount(transportPrice),
        transportPaidSeparately: transportSeparateEff,
        transportVatApplicable: transportVat,
        capFeeNet: null,
        capUsed: false,
        vatApplicable,
        vatRate,
        isSzkolenie,
      }),
    [effectiveBaseNet, transportPrice, transportSeparateEff, transportVat, vatApplicable, vatRate, isSzkolenie],
  );

  // Raportuj payload do formularza przy każdej zmianie.
  useEffect(() => {
    onChange({
      deviceVariant: effVariant,
      baseRentalPriceNet: isFlex ? undefined : priceIsManual ? manualPrice : undefined,
      baseRentalPriceOverrideNote: manualMode && !isSzkolenie && base.priceNet != null ? overrideNote || undefined : undefined,
      vatApplicable,
      vatRate,
      paymentMethod,
      transportPriceNet: isSzkolenie ? "" : transportPrice.trim(),
      transportPaidSeparately: transportSeparateEff,
      transportVatApplicable: transportSeparateEff && transportVat,
      transportPaymentMethod: transportPayment,
    });
    // onChange celowo pomijamy w deps — rodzic przekazuje stabilną referencję.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effVariant, isFlex, priceIsManual, manualPrice, manualMode, isSzkolenie, base.priceNet, overrideNote,
    vatApplicable, vatRate, paymentMethod,
    transportPrice, transportSeparateEff, transportVat, transportPayment,
  ]);

  const badge = isFlex
    ? { text: "⏳ tymczasowo", cls: "bg-gray-100 text-gray-600" }
    : priceIsManual
      ? { text: "✎ ręcznie", cls: "bg-amber-100 text-amber-800" }
      : { text: "🏷 z cennika", cls: "bg-blue-100 text-blue-700" };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="mb-3 text-sm font-medium text-gray-700">Finanse</p>

      {!isSzkolenie && deviceVariantOptions.length > 0 && (
        <label className="mb-4 flex flex-col gap-1 text-sm text-gray-700">
          Wariant głowicy
          <select
            value={deviceVariant}
            onChange={(e) => {
              setDeviceVariant(e.target.value);
              setManualMode(false);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          >
            <option value="">— wybierz —</option>
            {deviceVariantOptions.map((v) => (
              <option key={v} value={v}>
                {variantLabel(pricingCategory, v)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm text-gray-700">
          <span>{isSzkolenie ? "Ustalona cena szkolenia (netto)" : "Cena wynajmu (netto)"}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>
        </div>

        {priceIsManual ? (
          <>
            <input
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              inputMode="decimal"
              placeholder="np. 1500"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
            {!isSzkolenie && base.priceNet == null && (
              <p className="mt-1 text-xs text-amber-700">Brak reguły w cenniku dla tego wariantu / okresu — wpisz cenę ręcznie.</p>
            )}
            {manualMode && !isSzkolenie && base.priceNet != null && (
              <>
                <input
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="Powód odstępstwa od cennika (opcjonalnie, ale zachęcamy)"
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-gray-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(false);
                    setManualPrice("");
                    setOverrideNote("");
                  }}
                  className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  wróć do ceny z cennika
                </button>
              </>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-lg font-semibold text-gray-900">{fmt(base.priceNet ?? 0)} zł</span>
            {!isFlex && (
              <button
                type="button"
                onClick={() => {
                  setManualMode(true);
                  setManualPrice(String(base.priceNet ?? ""));
                }}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Zmień ręcznie →
              </button>
            )}
          </div>
        )}
        {isFlex && (
          <p className="mt-1 text-xs text-gray-500">
            Kwota minimalna dla tego okresu — dokładna wartość wyliczy się po odczycie liczników impulsów przez kierowcę.
          </p>
        )}
      </div>

      {/* Cena transportu — przeniesiona tu z karty „Dostawa". Nie dla szkolenia. */}
      {!isSzkolenie && (
        <div className="mb-4">
          <div className="mb-1 text-sm text-gray-700">Cena transportu (netto)</div>
          <input
            value={transportPrice}
            onChange={(e) => onTransportPriceChange(e.target.value)}
            inputMode="decimal"
            placeholder="np. 150"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
          {transportPriceHint && transportPriceHint.trim() && (
            <p className="mt-1 text-xs text-gray-400">Podpowiedź z HubSpot: {transportPriceHint}</p>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={transportSeparate}
              onChange={(e) => setTransportSeparate(e.target.checked)}
            />
            Niezależna płatność za transport
          </label>

          {transportSeparateEff && (
            <div className="mt-2 flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={transportVat} onChange={(e) => setTransportVat(e.target.checked)} />
                Doliczyć VAT ({TRANSPORT_VAT_RATE_PREVIEW}%) do transportu
              </label>
              <div className="flex flex-col gap-1 text-sm text-gray-700">
                Sposób płatności za transport
                <PayToggle value={transportPayment} onChange={setTransportPayment} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={vatApplicable} onChange={(e) => setVatApplicable(e.target.checked)} />
          Doliczyć VAT ({vatRate}%){transportSeparateEff ? " do wynajmu" : ""}
        </label>
        <div className="flex flex-col gap-1 text-sm text-gray-700">
          {transportSeparateEff ? "Sposób płatności za wynajem" : "Sposób płatności"}
          <PayToggle value={paymentMethod} onChange={setPaymentMethod} />
        </div>
      </div>

      {!isSzkolenie && needsCounters && (
        <p className="mt-3 text-xs text-gray-500">Liczniki impulsów uzupełni kierowca po zwrocie sprzętu.</p>
      )}
      {!isSzkolenie && isDouble && (
        <p className="mt-1 text-xs text-gray-500">Zużycie nakładki HS zaznaczy kierowca przy odbiorze.</p>
      )}

      <div className="mt-4 border-t border-gray-200 pt-3 text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {transportSeparateEff ? "Wynajem" : "Razem"}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Netto</span>
          <span className="font-semibold text-gray-900">{fmt(totals.net)} zł</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Brutto</span>
          <span className="font-semibold text-gray-900">
            {fmt(totals.gross)} zł {!vatApplicable && <span className="text-xs font-normal text-gray-400">(VAT wyłączony)</span>}
          </span>
        </div>

        {transportSeparateEff && (
          <>
            <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Transport · {transportPayment === "CASH" ? "gotówka" : "przelew"}
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Netto</span>
              <span className="font-semibold text-gray-900">{fmt(totals.transportNet ?? 0)} zł</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Brutto</span>
              <span className="font-semibold text-gray-900">
                {fmt(totals.transportGross ?? 0)} zł{" "}
                {!transportVat && <span className="text-xs font-normal text-gray-400">(bez VAT)</span>}
              </span>
            </div>
          </>
        )}

        {!isSzkolenie && needsCounters && (
          <p className="mt-1 text-xs text-gray-400">+ dopłata za impulsy / nakładka — po zwrocie sprzętu.</p>
        )}
      </div>
    </div>
  );
}
