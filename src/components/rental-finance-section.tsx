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
          className={`flex-1 px-3 py-1.5 text-center text-sm font-medium transition-colors ${
            value === m ? "bg-[#1B6FA8] text-white" : "bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {m === "CASH" ? "💵 Gotówka" : "🏦 Przelew"}
        </button>
      ))}
    </div>
  );
}

// Mały przełącznik „z boku" — do włączania niezależnej płatności za transport.
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
        checked ? "border-[#9CC5E0] bg-[#EAF4FB] text-[#1B6FA8]" : "border-gray-200 text-gray-500 hover:bg-gray-50"
      }`}
    >
      <span>{label}</span>
      <span
        className={`relative inline-flex h-4 w-7 flex-none items-center rounded-full transition-colors ${
          checked ? "bg-[#1B6FA8]" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}

// Co zrobił kierowca po zrealizowaniu wynajmu — biuro tego dotąd nigdzie nie
// widziało (dane leżały tylko w panelu kierowcy). Czytelnie na górze sekcji
// Finanse, zanim admin w ogóle dotknie edytowalnych pól: czy i ile gotówki
// pobrano (albo — gdy przelew — na jaką kwotę wystawić fakturę), ile
// nakładek HS / membran zużyto, jakie liczniki impulsów. Pokazuje się
// dopiero gdy kierowca faktycznie otworzył i zapisał swój panel —
// `cashCollected` jest wysyłane przy KAŻDYM jego zapisie (patrz
// driver-finance-panel.tsx save()), więc `!= null` to niezawodny sygnał
// "kierowca już tu był", nie tylko "biuro przygotowało rozliczenie".
function DriverSummaryCard({ finance, isSzkolenie }: { finance: RentalFinanceDto; isSzkolenie: boolean }) {
  const rentalValue = finance.vatApplicable ? Number(finance.totalGross) || 0 : Number(finance.totalNet) || 0;
  const rentalIsCash = finance.paymentMethod === "CASH";

  const transportSep = !isSzkolenie && finance.transportPaidSeparately;
  const transportValue = finance.transportVatApplicable
    ? Number(finance.transportTotalGross) || 0
    : Number(finance.transportTotalNet) || 0;
  const transportIsCash = transportSep && finance.transportPaymentMethod !== "TRANSFER";

  const payRow = (label: string, value: number, isCash: boolean, collected: boolean | null) => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700">
      <span>
        {label}: <b className="font-semibold text-gray-900">{fmt(value)} zł</b>
      </span>
      {isCash ? (
        <Badge
          text={collected ? "💵 Gotówka pobrana" : "💵 Gotówka jeszcze nie pobrana"}
          cls={collected ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}
        />
      ) : (
        <Badge text={`🏦 Do faktury: ${fmt(value)} zł`} cls="bg-blue-100 text-blue-700" />
      )}
    </div>
  );

  return (
    <div className="mb-4 rounded-lg border border-[#CFE0F0] bg-[#EAF4FB] p-4">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-[#1B6FA8]">Podsumowanie kierowcy</p>

      <div className="flex flex-col gap-1.5">
        {payRow(transportSep ? "Wynajem" : "Wartość wynajmu", rentalValue, rentalIsCash, finance.cashCollected)}
        {transportSep && payRow("Transport", transportValue, transportIsCash, finance.transportCashCollected)}
      </div>

      {(finance.capUsedHS != null || finance.membraneUsed != null) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[#CFE0F0] pt-2.5 text-sm text-gray-700">
          {finance.capUsedHS != null && (
            <span>
              Nakładka HS:{" "}
              <b className="font-semibold text-gray-900">
                {finance.capUsedHS ? `użyta ×${finance.capCountHS}` : "nie użyta"}
              </b>
            </span>
          )}
          {finance.membraneUsed != null && (
            <span>
              Membrany:{" "}
              <b className="font-semibold text-gray-900">
                {finance.membraneUsed ? `użyte ×${finance.membraneCount}` : "nie użyte"}
              </b>
            </span>
          )}
        </div>
      )}

      {(finance.pulseCounterStart != null || finance.pulseCounterEnd != null) && (
        <div className="mt-1.5 text-sm text-gray-700">
          Liczniki impulsów:{" "}
          <b className="font-semibold text-gray-900">
            {finance.pulseCounterStart ?? "—"} → {finance.pulseCounterEnd ?? "—"}
          </b>
          {finance.pulseCounterStart != null && finance.pulseCounterEnd != null && (
            <span> ({finance.pulseCounterEnd - finance.pulseCounterStart} impulsów)</span>
          )}
        </div>
      )}
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
  // Surowa wartość „ustalona_cena_transportu" z HubSpot — źródło podpowiedzi.
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

  // --- transport ---
  const hintAmount = parseAmount(transportPriceHint);
  // Tryb ręczny transportu: gdy nie ma czego podpowiedzieć, albo zapisana
  // wcześniej kwota różni się od aktualnej podpowiedzi z HubSpot.
  const [transportManual, setTransportManual] = useState<boolean>(() => {
    const hv = parseAmount(transportPriceHint);
    if (hv == null) return true;
    const cur = parseAmount(transportPrice);
    return cur != null && cur !== hv;
  });
  const [transportSeparate, setTransportSeparate] = useState<boolean>(initialFinance?.transportPaidSeparately ?? false);
  const [transportVat, setTransportVat] = useState<boolean>(initialFinance?.transportVatApplicable ?? false);
  const [transportPayment, setTransportPayment] = useState<PaymentMethod>(
    initialFinance?.transportPaymentMethod ?? "CASH",
  );

  const showFilledTransport = !transportManual && hintAmount != null;
  const effTransportPrice = showFilledTransport ? String(hintAmount) : transportPrice;

  // W trybie „z HubSpot" trzymaj kwotę w rodzicu zsynchronizowaną z podpowiedzią
  // (rodzic mirroruje ją też do legacy `Rental.transportPrice`).
  useEffect(() => {
    if (showFilledTransport && parseAmount(transportPrice) !== hintAmount) {
      onTransportPriceChange(String(hintAmount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilledTransport, hintAmount]);

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
        transportNet: parseAmount(effTransportPrice),
        transportPaidSeparately: transportSeparateEff,
        transportVatApplicable: transportVat,
        capFeeNet: null,
        capUsed: false,
        membraneFeeNet: null, // membrany Cooltech — też po stronie kierowcy
        membraneUsed: false,
        vatApplicable,
        vatRate,
        isSzkolenie,
      }),
    [effectiveBaseNet, effTransportPrice, transportSeparateEff, transportVat, vatApplicable, vatRate, isSzkolenie],
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
      transportPriceNet: isSzkolenie ? "" : effTransportPrice.trim(),
      transportPaidSeparately: transportSeparateEff,
      transportVatApplicable: transportSeparateEff && transportVat,
      transportPaymentMethod: transportPayment,
    });
    // onChange celowo pomijamy w deps — rodzic przekazuje stabilną referencję.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effVariant, isFlex, priceIsManual, manualPrice, manualMode, isSzkolenie, base.priceNet, overrideNote,
    vatApplicable, vatRate, paymentMethod,
    effTransportPrice, transportSeparateEff, transportVat, transportPayment,
  ]);

  const badge = isFlex
    ? { text: "⏳ tymczasowo", cls: "bg-gray-100 text-gray-600" }
    : priceIsManual
      ? { text: "✎ ręcznie", cls: "bg-amber-100 text-amber-800" }
      : { text: "🏷 z cennika", cls: "bg-[#EAF4FB] text-[#1B6FA8]" };

  const FILLED = "flex items-center justify-between rounded-md border border-gray-200 bg-gray-50";
  const CHANGE_LINK = "text-xs font-medium text-[#1B6FA8] hover:underline";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="mb-3 text-sm font-medium text-gray-700">Finanse</p>

      {initialFinance && initialFinance.cashCollected !== null && (
        <DriverSummaryCard finance={initialFinance} isSzkolenie={isSzkolenie} />
      )}

      {!isSzkolenie && deviceVariantOptions.length > 0 && (
        <label className="mb-4 flex flex-col gap-1 text-sm text-gray-700">
          Wariant głowicy
          <select
            value={deviceVariant}
            onChange={(e) => {
              setDeviceVariant(e.target.value);
              setManualMode(false);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
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

      {/* --- cena wynajmu --- */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-sm text-gray-700">
          <span>{isSzkolenie ? "Ustalona cena szkolenia (netto)" : "Cena wynajmu (netto)"}</span>
          <Badge text={badge.text} cls={badge.cls} />
        </div>

        {priceIsManual ? (
          <>
            <input
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              inputMode="decimal"
              placeholder="np. 1500"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
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
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(false);
                    setManualPrice("");
                    setOverrideNote("");
                  }}
                  className={`mt-1 ${CHANGE_LINK}`}
                >
                  wróć do ceny z cennika
                </button>
              </>
            )}
          </>
        ) : (
          <div className={`${FILLED} px-3 py-2`}>
            <span className="text-lg font-semibold text-gray-900">{fmt(base.priceNet ?? 0)} zł</span>
            {!isFlex && (
              <button
                type="button"
                onClick={() => {
                  setManualMode(true);
                  setManualPrice(String(base.priceNet ?? ""));
                }}
                className={CHANGE_LINK}
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

      {/* --- cena transportu (przeniesiona z karty „Dostawa") --- */}
      {!isSzkolenie && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm text-gray-700">
            <span>Cena transportu (netto)</span>
            {transportManual ? (
              <Badge text="✎ ręcznie" cls="bg-amber-100 text-amber-800" />
            ) : (
              <Badge text="🏢 z HubSpot" cls="bg-orange-100 text-orange-700" />
            )}
          </div>

          {showFilledTransport ? (
            <div className={`${FILLED} px-3 py-1.5`}>
              <span className="text-base font-semibold text-gray-900">{fmt(hintAmount ?? 0)} zł</span>
              <button type="button" onClick={() => setTransportManual(true)} className={CHANGE_LINK}>
                Zmień ręcznie →
              </button>
            </div>
          ) : (
            <>
              <input
                value={transportPrice}
                onChange={(e) => onTransportPriceChange(e.target.value)}
                inputMode="decimal"
                placeholder="np. 150"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
              />
              {hintAmount != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setTransportManual(false);
                    onTransportPriceChange(String(hintAmount));
                  }}
                  className={`mt-1 ${CHANGE_LINK}`}
                >
                  wróć do wartości z HubSpot ({fmt(hintAmount)} zł)
                </button>
              ) : (
                transportPriceHint &&
                transportPriceHint.trim() && (
                  <p className="mt-1 text-xs text-gray-400">Podpowiedź z HubSpot: {transportPriceHint}</p>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* --- płatność: VAT + forma; „transport osobno" jako przełącznik z boku --- */}
      <div className="mb-1">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Płatność{transportSeparateEff ? " za wynajem" : ""}</p>
          {!isSzkolenie && (
            <Switch label="transport osobno" checked={transportSeparate} onChange={setTransportSeparate} />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={vatApplicable} onChange={(e) => setVatApplicable(e.target.checked)} />
            Doliczyć VAT ({vatRate}%)
          </label>
          <div className="flex flex-col gap-1 text-sm text-gray-700">
            Forma płatności
            <PayToggle value={paymentMethod} onChange={setPaymentMethod} />
          </div>
        </div>

        {transportSeparateEff && (
          <div className="mt-3 flex flex-col gap-3 rounded-md border border-[#CFE0F0] bg-[#EAF4FB]/60 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#14567F]">
              <span aria-hidden>🚚</span> Transport — osobna płatność
            </p>
            <label className="flex items-center gap-2 text-sm text-[#14567F]">
              <input type="checkbox" checked={transportVat} onChange={(e) => setTransportVat(e.target.checked)} />
              Doliczyć VAT ({TRANSPORT_VAT_RATE_PREVIEW}%)
            </label>
            <div className="flex flex-col gap-1 text-sm text-[#14567F]">
              Forma płatności za transport
              <PayToggle value={transportPayment} onChange={setTransportPayment} />
            </div>
          </div>
        )}
      </div>

      {!isSzkolenie && needsCounters && (
        <p className="mt-3 text-xs text-gray-500">Liczniki impulsów uzupełni kierowca po zwrocie sprzętu.</p>
      )}
      {!isSzkolenie && isDouble && (
        <p className="mt-1 text-xs text-gray-500">Zużycie nakładki HS zaznaczy kierowca przy odbiorze.</p>
      )}

      {/* --- podsumowanie --- */}
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
