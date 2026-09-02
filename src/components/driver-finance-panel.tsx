"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DevicePricingCategory, RentalEventType } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import type { RentalFinanceDto } from "@/lib/finance";
import { DOUBLE_VARIANT, FLEX_VARIANT } from "@/lib/pricing/variants";
import {
  parseAmount,
  previewFlexPlaceholder,
  previewFlexPrice,
  previewTotals,
  type PreviewContext,
} from "@/lib/pricing/preview";

function fmt(n: number): string {
  return new Intl.NumberFormat("pl-PL", {
    useGrouping: "always",
    minimumFractionDigits: Math.abs(n - Math.trunc(n)) > 1e-9 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
}

const MAX_CAP_COUNT = 20;

// Tokeny z docs/finanse-wynajmu/mockup-modul-finansowy.html (light only).
const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const FIELD_LABEL = "text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280]";
const INPUT_BASE = "w-full rounded-[9px] border bg-[#F1F3F6] px-2.5 py-2 text-[14px] text-[#171A21] focus:outline-none";

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
  tripInfoSlot,
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
  // Karta „Klientka" + „Uwaga z biura" — renderowane zaraz po banerze
  // płatności (mockup-master), przed rozbiciem kwoty.
  tripInfoSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const isSzkolenie = eventType === "SZKOLENIE";

  const [start, setStart] = useState(finance?.pulseCounterStart != null ? String(finance.pulseCounterStart) : "");
  const [end, setEnd] = useState(finance?.pulseCounterEnd != null ? String(finance.pulseCounterEnd) : "");
  const [capUsed, setCapUsed] = useState<boolean>(finance?.capUsedHS ?? false);
  const [capCount, setCapCount] = useState<number>(finance?.capCountHS ?? 1);
  const [cashCollected, setCashCollected] = useState<boolean>(finance?.cashCollected ?? false);
  const [notes, setNotes] = useState(initialDriverNotes);
  const [notesOpen, setNotesOpen] = useState(initialDriverNotes.trim() !== "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSentKey = useRef<string | null>(null);

  const variant = finance?.deviceVariant ?? null;
  const isFlex = !isSzkolenie && pricingCategory === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT;
  const isDouble = !isSzkolenie && variant === DOUBLE_VARIANT;
  const isAlma = !isSzkolenie && pricingCategory === "ALMA_HARMONY";
  const needsCounters = isFlex || isAlma;

  const startRaw = start.trim();
  const endRaw = end.trim();
  const startN = startRaw === "" ? null : Number(startRaw);
  const endN = endRaw === "" ? null : Number(endRaw);

  const startValid = startN == null || (Number.isInteger(startN) && startN >= 0);
  const endValid = endN == null || (Number.isInteger(endN) && endN >= 0);
  const orderValid = startN == null || endN == null || endN >= startN;
  // Twardy błąd tylko przy sprzecznych danych. Sam licznik początkowy bez
  // końcowego to normalna sytuacja: kierowca wpisuje początkowy przy
  // dostarczeniu urządzenia rano, końcowy przy odbiorze wieczorem.
  const countersError = needsCounters && (!startValid || !endValid || !orderValid);
  const pulsesUsed =
    needsCounters && startN != null && endN != null && orderValid ? (endN as number) - (startN as number) : null;
  const awaitingEnd = needsCounters && startN != null && endN == null;

  const savedStart = finance?.pulseCounterStart ?? null;
  const savedEnd = finance?.pulseCounterEnd ?? null;
  const savedNotes = initialDriverNotes.trim();
  const countersDirty =
    needsCounters &&
    !countersError &&
    ((startRaw === "" ? null : Number(startRaw)) !== savedStart || (endRaw === "" ? null : Number(endRaw)) !== savedEnd);

  // Autozapis — brak przycisku „Zapisz". Wołane po wyjściu z pola (liczniki,
  // uwagi) i od razu po każdym przełączniku (nakładka, liczba nakładek,
  // gotówka). Wysyła komplet pól kierowcy; API scala je z resztą rekordu.
  async function save(ov?: { capUsed?: boolean; capCount?: number; cashCollected?: boolean }) {
    const capUsedNow = ov?.capUsed ?? capUsed;
    const capCountNow = ov?.capCount ?? capCount;
    const cashNow = ov?.cashCollected ?? cashCollected;

    const payload: Record<string, unknown> = {
      driverNotes: notes.trim() || null,
      cashCollected: cashNow,
    };
    if (isDouble) {
      payload.capUsedHS = capUsedNow;
      if (capUsedNow) payload.capCountHS = capCountNow;
    }
    if (needsCounters && !countersError) {
      payload.pulseCounterStart = startRaw === "" ? null : Number(startRaw);
      payload.pulseCounterEnd = endRaw === "" ? null : Number(endRaw);
    }

    const key = JSON.stringify(payload);
    if (key === lastSentKey.current) return;
    lastSentKey.current = key;

    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/finance/driver`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        lastSentKey.current = null;
        setSaveError(data?.message ?? "Nie udało się zapisać.");
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
    } catch {
      lastSentKey.current = null;
      setSaveError("Brak połączenia z serwerem.");
      setSaveState("error");
    }
  }

  const { net, gross, rows, pending } = useMemo(() => {
    if (!finance) return { net: 0, gross: 0, rows: [] as { label: string; value: number }[], pending: false };

    const baseFromFinance = Number(finance.baseRentalPriceNet) || 0;
    const flexMin = isFlex ? previewFlexPlaceholder(previewCtx, durationDays) : 0;
    const flexActual =
      isFlex && pulsesUsed != null
        ? previewFlexPrice(previewCtx, durationDays, pulsesUsed) ?? baseFromFinance
        : baseFromFinance;
    const baseNet = isFlex && pulsesUsed != null ? flexActual : baseFromFinance;
    const flexPulseAddon = isFlex && pulsesUsed != null ? round2(flexActual - flexMin) : 0;

    const surcharge = isAlma
      ? pulsesUsed != null
        ? pulsesUsed * almaPulseRateNet
        : Number(finance.pulseSurchargeNet ?? 0) || 0
      : 0;

    const capFee = Number(finance.capFeeNet ?? capFeeHsNet) || 0;
    const capCountEff = capUsed ? Math.max(1, capCount) : 1;
    const transportN = isSzkolenie ? null : parseAmount(transportPrice);
    const vatApplicable = finance.vatApplicable;
    const vatRate = Number(finance.vatRate) || 0;

    const t = previewTotals({
      baseNet,
      pulseSurchargeNet: surcharge || null,
      transportNet: transportN,
      capFeeNet: capFee,
      capUsed,
      capCount: capCountEff,
      vatApplicable,
      vatRate,
      isSzkolenie,
    });

    const r: { label: string; value: number }[] = [];
    if (isFlex && pulsesUsed != null) {
      r.push({ label: "Wynajem (podstawa)", value: flexMin });
      r.push({ label: `Doliczenie za impulsy (${pulsesUsed})`, value: flexPulseAddon });
    } else {
      r.push({ label: isSzkolenie ? "Szkolenie" : "Wynajem", value: baseNet });
    }
    if (!isSzkolenie && transportN) r.push({ label: "Transport", value: transportN });
    if (surcharge) {
      r.push({ label: `Dopłata za impulsy${pulsesUsed != null ? ` (${pulsesUsed})` : ""}`, value: surcharge });
    }
    if (capUsed && capFee) {
      r.push({
        label: capCountEff > 1 ? `Nakładki HS (${capCountEff} × ${fmt(capFee)} zł)` : "Nakładka HS",
        value: round2(capFee * capCountEff),
      });
    }
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
    capCount,
    transportPrice,
    needsCounters,
  ]);

  const statusLine = (
    <div className="min-h-[1rem] text-center text-[11px]">
      {saveState === "saving" && <span className="text-[#6B7280]">Zapisywanie…</span>}
      {saveState === "saved" && <span className="text-[#1E9E6B]">Zapisano ✓</span>}
      {saveState === "error" && (
        <button type="button" onClick={() => void save()} className="font-semibold text-[#E15A2B] underline">
          {saveError ?? "Nie zapisano"} — dotknij, aby ponowić
        </button>
      )}
    </div>
  );

  const notesCard = notesOpen ? (
    <div className={CARD}>
      <p className={`mb-2 ${FIELD_LABEL}`}>Uwagi kierowcy</p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes.trim() !== savedNotes) void save();
        }}
        rows={3}
        placeholder="np. utrudniony dojazd, klientka prosiła o kontakt przed odbiorem…"
        className={`${INPUT_BASE} resize-none border-[#E2E6EC] focus:border-[#2F6FD1]`}
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setNotesOpen(true)}
      className="flex items-center gap-2.5 rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5 text-[13.5px] font-semibold text-[#2F6FD1]"
    >
      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-[#2F6FD1] text-[13px] leading-none">
        +
      </span>
      Dodaj uwagę
    </button>
  );

  // Brak rozliczenia przygotowanego przez biuro — kierowca może zostawić tylko uwagi.
  if (!finance) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[14px] border border-[#F0DFB6] bg-[#FBF3E1] px-4 py-3 text-[13px] text-[#8A6A16]">
          Biuro nie przygotowało jeszcze rozliczenia tego wydarzenia.
        </div>
        {tripInfoSlot}
        <div className={CARD}>
          <p className={`mb-2 ${FIELD_LABEL}`}>Uwagi kierowcy</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes.trim() !== savedNotes) void save();
            }}
            rows={3}
            className={`${INPUT_BASE} resize-none border-[#E2E6EC] focus:border-[#2F6FD1]`}
          />
        </div>
        {statusLine}
      </div>
    );
  }

  const isCash = finance.paymentMethod === "CASH";
  const rentalValue = finance.vatApplicable ? gross : net;

  return (
    <div className="flex flex-col gap-3">
      {/* Banner płatności — pierwsza rzecz, jaką widzi kierowca (mockup-master).
          Kolor koduje info: pomarańcz = gotówka do odebrania, zieleń = przelew,
          nic nie pobieraj. Jedyny element z wyraźnym cieniem. */}
      <div
        className={`rounded-[14px] px-5 py-[18px] text-center text-white ${
          isCash
            ? "bg-[linear-gradient(155deg,#E15A2B_0%,#9C3D1B_100%)] shadow-[0_10px_24px_-10px_rgba(225,90,43,0.5)]"
            : "bg-[linear-gradient(155deg,#1E9E6B_0%,#12724F_100%)] shadow-[0_10px_24px_-10px_rgba(30,158,107,0.45)]"
        }`}
      >
        <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] opacity-90">
          {isCash ? "💵 Gotówka" : "🏦 Przelew"}
        </div>

        {isCash ? (
          <>
            <div className="mt-1.5 text-[36px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              {fmt(rentalValue)} zł
            </div>
            <div className="mt-1.5 text-[12.5px] opacity-85">do odebrania od klientki</div>
            {pending && (
              <div className="mt-1 text-[11px] font-semibold opacity-85">
                kwota tymczasowa — uzupełnij liczniki impulsów poniżej
              </div>
            )}
            <label className="mt-3.5 flex items-center gap-2.5 rounded-[9px] border border-white/[0.28] bg-white/[0.14] px-3 py-2.5 text-left text-[13px] font-semibold">
              <input
                type="checkbox"
                className="h-[19px] w-[19px] flex-none accent-[#2F6FD1]"
                checked={cashCollected}
                onChange={(e) => {
                  setCashCollected(e.target.checked);
                  void save({ cashCollected: e.target.checked });
                }}
              />
              Gotówka odebrana
            </label>
          </>
        ) : (
          <>
            <div className="mt-2 text-[19px] font-extrabold leading-[1.3]">
              Nie musisz pobierać gotówki
            </div>
            <div className="mt-2.5 border-t border-white/[0.25] pt-2.5 text-[13px] opacity-90">
              Wartość wynajmu: <b className="font-bold">{fmt(rentalValue)} zł</b> — rozliczona przelewem
            </div>
            {pending && (
              <div className="mt-1 text-[11px] font-semibold opacity-85">
                kwota tymczasowa — uzupełnij liczniki impulsów poniżej
              </div>
            )}
          </>
        )}
      </div>

      {tripInfoSlot}

      {statusLine}

      {/* Rozbicie kwoty — domyślnie zwinięte */}
      <details className="group rounded-[14px] border border-[#E2E6EC] bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3.5 text-[13.5px] font-semibold text-[#6B7280] [&::-webkit-details-marker]:hidden">
          <span className="text-[10px] transition-transform group-open:rotate-90">▸</span>
          Rozbicie kwoty
        </summary>
        <div className="px-4 pb-3.5 text-[13.5px]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between py-[5px] text-[#171A21]">
              <span>{r.label}</span>
              <span className="font-semibold tabular-nums">{fmt(r.value)} zł</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-[#E2E6EC] pt-2.5 font-bold text-[#171A21]">
            <span>{finance.vatApplicable ? "Razem brutto" : "Razem netto"}</span>
            <span className="tabular-nums">{fmt(finance.vatApplicable ? gross : net)} zł</span>
          </div>
        </div>
      </details>

      {/* Nakładka HS — tylko podwójna głowica. Checkbox = główny przełącznik,
          stepper obok (nie pod spodem) doprecyzowuje ilość, tylko gdy zaznaczone. */}
      {isDouble && (
        <div className={CARD}>
          <p className={`mb-2 ${FIELD_LABEL}`}>Nakładka HS</p>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-[14px] font-semibold text-[#171A21]">
              <input
                type="checkbox"
                className="h-[19px] w-[19px] flex-none accent-[#2F6FD1]"
                checked={capUsed}
                onChange={(e) => {
                  const v = e.target.checked;
                  setCapUsed(v);
                  if (!v) setCapCount(1);
                  void save({ capUsed: v, capCount: v ? capCount : 1 });
                }}
              />
              Zużyta
            </label>
            {capUsed && (
              <div className="flex flex-none items-center gap-3">
                <button
                  type="button"
                  aria-label="mniej"
                  disabled={capCount <= 1}
                  onClick={() => {
                    const v = Math.max(1, capCount - 1);
                    setCapCount(v);
                    void save({ capCount: v });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-[#E2E6EC] text-[15px] font-bold leading-none text-[#171A21] disabled:opacity-40"
                >
                  −
                </button>
                <span className="min-w-[14px] text-center text-[16px] font-extrabold tabular-nums">{capCount}</span>
                <button
                  type="button"
                  aria-label="więcej"
                  disabled={capCount >= MAX_CAP_COUNT}
                  onClick={() => {
                    const v = Math.min(MAX_CAP_COUNT, capCount + 1);
                    setCapCount(v);
                    void save({ capCount: v });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-[#E2E6EC] text-[15px] font-bold leading-none text-[#171A21] disabled:opacity-40"
                >
                  +
                </button>
              </div>
            )}
          </div>
          {capUsed && capCount >= 4 && (
            <p className="mt-2 text-[12px] text-[#B5851E]">Nietypowo duża liczba — sprawdź przed zapisaniem.</p>
          )}
        </div>
      )}

      {/* Liczniki impulsów */}
      {needsCounters && (
        <div className={CARD}>
          <p className={`mb-1 ${FIELD_LABEL}`}>Liczniki impulsów</p>
          <p className="mb-3 text-[11px] text-[#9CA3AF]">
            Początkowy wpisz przy dostarczeniu urządzenia, końcowy przy odbiorze. Zapisują się automatycznie.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-[11px] font-bold uppercase tracking-[0.03em] text-[#9CA3AF]">
              Początkowy
              <input
                value={start}
                onChange={(e) => setStart(e.target.value)}
                onBlur={() => {
                  if (countersDirty) void save();
                }}
                inputMode="numeric"
                className={`mt-1 ${INPUT_BASE} ${
                  startValid ? "border-[#E2E6EC] focus:border-[#2F6FD1]" : "border-[#E15A2B]"
                }`}
              />
            </label>
            <label className="text-[11px] font-bold uppercase tracking-[0.03em] text-[#9CA3AF]">
              Końcowy
              <input
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                onBlur={() => {
                  if (countersDirty) void save();
                }}
                inputMode="numeric"
                className={`mt-1 ${INPUT_BASE} ${
                  endValid && orderValid ? "border-[#E2E6EC] focus:border-[#2F6FD1]" : "border-[#E15A2B]"
                }`}
              />
            </label>
          </div>
          {(!startValid || !endValid) && (
            <p className="mt-2 text-[12px] text-[#E15A2B]">Liczniki podaj jako nieujemne liczby całkowite.</p>
          )}
          {startValid && endValid && !orderValid && (
            <p className="mt-2 text-[12px] text-[#E15A2B]">Licznik końcowy nie może być mniejszy niż początkowy.</p>
          )}
          {pulsesUsed != null && (
            <p className="mt-2 text-[14px] font-semibold text-[#171A21]">
              Zużyto impulsów: <span className="tabular-nums">{pulsesUsed}</span>
            </p>
          )}
          {awaitingEnd && (
            <p className="mt-2 text-[12px] text-[#9CA3AF]">
              Końcowy uzupełnisz przy odbiorze — wtedy wyliczy się ostateczna kwota.
            </p>
          )}
        </div>
      )}

      {notesCard}
    </div>
  );
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
