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
const MAX_MEMBRANE_COUNT = 20;

// Tokeny z docs/finanse-wynajmu/mockup-modul-finansowy.html (light only).
const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const FIELD_LABEL = "text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280]";
const INPUT_BASE = "w-full rounded-[9px] border bg-[#F1F3F6] px-2.5 py-2 text-[14px] text-[#171A21] focus:outline-none";

export function DriverFinancePanel({
  rentalId,
  eventType,
  pricingCategory,
  finance,
  previewCtx,
  durationDays,
  endsAt,
  transportPrice,
  capFeeHsNet,
  almaPulseRateNet,
  membraneFeeCooltechNet,
  vehicleId,
  vehicleName,
  vehicles,
  tripInfoSlot,
}: {
  rentalId: string;
  eventType: RentalEventType;
  pricingCategory: DevicePricingCategory | null;
  finance: RentalFinanceDto | null;
  previewCtx: PreviewContext;
  durationDays: number;
  // Koniec wynajmu (ISO) — steruje popołudniowym przypomnieniem o
  // nakładkach/membranach (patrz `showUsageReminder` niżej).
  endsAt: string;
  transportPrice: string | null;
  capFeeHsNet: number;
  almaPulseRateNet: number;
  membraneFeeCooltechNet: number;
  // Pojazd dostawy — ustala biuro (Rental.vehicleId), kierowca go nie zmienia
  // tutaj, tylko może zaznaczyć INNY pojazd na odbiór (suwak niżej).
  vehicleId: string | null;
  vehicleName: string | null;
  vehicles: { id: string; name: string }[];
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
  const [membraneUsed, setMembraneUsed] = useState<boolean>(finance?.membraneUsed ?? false);
  const [membraneCount, setMembraneCount] = useState<number>(finance?.membraneCount ?? 1);
  const [cashCollected, setCashCollected] = useState<boolean>(finance?.cashCollected ?? false);
  const [transportCash, setTransportCash] = useState<boolean>(finance?.transportCashCollected ?? false);
  const [deliveryMin, setDeliveryMin] = useState(
    finance?.deliveryDurationMinutes != null ? String(finance.deliveryDurationMinutes) : "",
  );
  const [pickupMin, setPickupMin] = useState(
    finance?.pickupDurationMinutes != null ? String(finance.pickupDurationMinutes) : "",
  );
  const initialPickupVehicleId = finance?.pickupVehicleId ?? null;
  const [pickupSameVehicle, setPickupSameVehicle] = useState(initialPickupVehicleId == null);
  const [pickupVehicleSel, setPickupVehicleSel] = useState(initialPickupVehicleId ?? "");
  const initialDeliveryNotes = finance?.deliveryNotes ?? "";
  const initialPickupNotes = finance?.pickupNotes ?? "";
  const [deliveryNotes, setDeliveryNotes] = useState(initialDeliveryNotes);
  const [deliveryNotesOpen, setDeliveryNotesOpen] = useState(initialDeliveryNotes.trim() !== "");
  const [pickupNotes, setPickupNotes] = useState(initialPickupNotes);
  const [pickupNotesOpen, setPickupNotesOpen] = useState(initialPickupNotes.trim() !== "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSentKey = useRef<string | null>(null);

  const otherVehicles = vehicles.filter((v) => v.id !== vehicleId);
  const variant = finance?.deviceVariant ?? null;
  const isFlex = !isSzkolenie && pricingCategory === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT;
  const isDouble = !isSzkolenie && variant === DOUBLE_VARIANT;
  const isCooltech = !isSzkolenie && pricingCategory === "COOLTECH_FLAT";
  const isAlma = !isSzkolenie && pricingCategory === "ALMA_HARMONY";
  const needsCounters = isFlex || isAlma;

  // Przypomnienie o nakładce HS / membranach — pojawia się dopiero od godz.
  // 13:00 w dniu ODBIORU urządzenia (endsAt), bo wcześniej kierowca zwyczajnie
  // jeszcze nie wie, ile zużył. To próg czasowy, nie okno jednego dnia: jeśli
  // pole zostanie niepotwierdzone dłużej, przypomnienie zostaje widoczne przy
  // każdym kolejnym wejściu w kartę, aż kierowca jawnie potwierdzi (checkbox
  // albo przycisk „Nie było" niżej).
  const usageReminderThreshold = useMemo(() => {
    const d = new Date(endsAt);
    d.setHours(13, 0, 0, 0);
    return d;
  }, [endsAt]);
  const afterReminderThreshold = new Date() >= usageReminderThreshold;
  const showCapReminder = isDouble && finance?.capUsedHS == null && afterReminderThreshold;
  const showMembraneReminder = isCooltech && finance?.membraneUsed == null && afterReminderThreshold;

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

  // Czas pracy kierowcy (min) — niezależny od wariantu, opcjonalny.
  const parseMin = (s: string): number | null | undefined => {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 && n <= 24 * 60 ? n : undefined; // undefined = nie wysyłaj
  };
  const deliveryMinParsed = parseMin(deliveryMin);
  const pickupMinParsed = parseMin(pickupMin);
  const savedDeliveryMin = finance?.deliveryDurationMinutes ?? null;
  const savedPickupMin = finance?.pickupDurationMinutes ?? null;

  const savedStart = finance?.pulseCounterStart ?? null;
  const savedEnd = finance?.pulseCounterEnd ?? null;
  const savedDeliveryNotes = initialDeliveryNotes.trim();
  const savedPickupNotes = initialPickupNotes.trim();
  const countersDirty =
    needsCounters &&
    !countersError &&
    ((startRaw === "" ? null : Number(startRaw)) !== savedStart || (endRaw === "" ? null : Number(endRaw)) !== savedEnd);

  // Autozapis — brak przycisku „Zapisz". Wołane po wyjściu z pola (liczniki,
  // uwagi) i od razu po każdym przełączniku (nakładka, liczba nakładek,
  // gotówka). Wysyła komplet pól kierowcy; API scala je z resztą rekordu.
  async function save(ov?: {
    capUsed?: boolean;
    capCount?: number;
    membraneUsed?: boolean;
    membraneCount?: number;
    cashCollected?: boolean;
    transportCashCollected?: boolean;
    pickupSameVehicle?: boolean;
    pickupVehicleSel?: string;
  }) {
    const capUsedNow = ov?.capUsed ?? capUsed;
    const capCountNow = ov?.capCount ?? capCount;
    const membraneUsedNow = ov?.membraneUsed ?? membraneUsed;
    const membraneCountNow = ov?.membraneCount ?? membraneCount;
    const cashNow = ov?.cashCollected ?? cashCollected;
    const transportCashNow = ov?.transportCashCollected ?? transportCash;
    const pickupSameVehicleNow = ov?.pickupSameVehicle ?? pickupSameVehicle;
    const pickupVehicleSelNow = ov?.pickupVehicleSel ?? pickupVehicleSel;

    const payload: Record<string, unknown> = {
      deliveryNotes: deliveryNotes.trim() || null,
      pickupNotes: pickupNotes.trim() || null,
      cashCollected: cashNow,
    };
    const pickupVehicleIdNow = pickupSameVehicleNow ? null : pickupVehicleSelNow || null;
    if (pickupVehicleIdNow !== initialPickupVehicleId) payload.pickupVehicleId = pickupVehicleIdNow;
    if (finance?.transportPaidSeparately) {
      payload.transportCashCollected = transportCashNow;
    }
    // capUsedHS/membraneUsed idą w payloadzie TYLKO gdy ten konkretny zapis
    // dotyczy tego pola (checkbox albo licznik nakładek/membran) — nie przy
    // okazji każdego innego zapisu (np. uwagi, liczniki impulsów). Inaczej
    // domyślne `false` zapisywałoby się jako "potwierdzone nie było" przy
    // pierwszym przypadkowym autozapisie, zanim kierowca w ogóle spojrzy na
    // to pole — a wtedy przypomnienie popołudniowe (`showCapReminder` /
    // `showMembraneReminder`) nigdy by się nie zdążyło pokazać.
    if (isDouble) {
      if (ov?.capUsed !== undefined) {
        payload.capUsedHS = capUsedNow;
        if (capUsedNow) payload.capCountHS = capCountNow;
      } else if (ov?.capCount !== undefined) {
        payload.capCountHS = capCountNow;
      }
    }
    if (isCooltech) {
      if (ov?.membraneUsed !== undefined) {
        payload.membraneUsed = membraneUsedNow;
        if (membraneUsedNow) payload.membraneCount = membraneCountNow;
      } else if (ov?.membraneCount !== undefined) {
        payload.membraneCount = membraneCountNow;
      }
    }
    if (needsCounters && !countersError) {
      payload.pulseCounterStart = startRaw === "" ? null : Number(startRaw);
      payload.pulseCounterEnd = endRaw === "" ? null : Number(endRaw);
    }
    if (deliveryMinParsed !== undefined) payload.deliveryDurationMinutes = deliveryMinParsed;
    if (pickupMinParsed !== undefined) payload.pickupDurationMinutes = pickupMinParsed;

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

  const { net, gross, rows, pending, transportNet, transportGross } = useMemo(() => {
    if (!finance)
      return {
        net: 0,
        gross: 0,
        rows: [] as { label: string; value: number }[],
        pending: false,
        transportNet: null as number | null,
        transportGross: null as number | null,
      };

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
    const membraneFee = Number(finance.membraneFeeNet ?? membraneFeeCooltechNet) || 0;
    const membraneCountEff = membraneUsed ? Math.max(1, membraneCount) : 1;
    const transportN = isSzkolenie
      ? null
      : parseAmount(finance.transportPriceNet ?? transportPrice);
    const transportSeparate = !isSzkolenie && finance.transportPaidSeparately;
    const vatApplicable = finance.vatApplicable;
    const vatRate = Number(finance.vatRate) || 0;

    const t = previewTotals({
      baseNet,
      pulseSurchargeNet: surcharge || null,
      transportNet: transportN,
      transportPaidSeparately: transportSeparate,
      transportVatApplicable: finance.transportVatApplicable,
      capFeeNet: capFee,
      capUsed,
      capCount: capCountEff,
      membraneFeeNet: membraneFee,
      membraneUsed,
      membraneCount: membraneCountEff,
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
    // Transport w rozbiciu wynajmu tylko gdy NIE jest płatny osobno.
    if (!isSzkolenie && !transportSeparate && transportN) r.push({ label: "Transport", value: transportN });
    if (surcharge) {
      r.push({ label: `Dopłata za impulsy${pulsesUsed != null ? ` (${pulsesUsed})` : ""}`, value: surcharge });
    }
    if (capUsed && capFee) {
      r.push({
        label: capCountEff > 1 ? `Nakładki HS (${capCountEff} × ${fmt(capFee)} zł)` : "Nakładka HS",
        value: round2(capFee * capCountEff),
      });
    }
    if (membraneUsed && membraneFee) {
      r.push({
        label: membraneCountEff > 1 ? `Membrany (${membraneCountEff} × ${fmt(membraneFee)} zł)` : "Membrana",
        value: round2(membraneFee * membraneCountEff),
      });
    }
    if (vatApplicable) r.push({ label: `VAT ${vatRate}%`, value: round2(t.gross - t.net) });

    const isPending = needsCounters && pulsesUsed == null;
    return {
      net: t.net,
      gross: t.gross,
      rows: r,
      pending: isPending,
      transportNet: t.transportNet,
      transportGross: t.transportGross,
    };
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
    membraneFeeCooltechNet,
    membraneUsed,
    membraneCount,
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

  // Uwaga kierowcy PER ETAP (dostawa / odbiór) — dawniej jedna wspólna;
  // osobno, bo dostawa i odbiór bywają zupełnie inną sytuacją (np. dostawa
  // połączona z innym klientem, odbiór normalny). Ten sam trójstanowy wzorzec
  // co dawniej: puste "+ Dodaj uwagę" / zwinięte z podglądem / rozwinięte.
  function noteCard(
    label: string,
    value: string,
    setValue: (v: string) => void,
    open: boolean,
    setOpen: (v: boolean) => void,
    saved: string,
    placeholder: string,
  ) {
    const text = value.trim();
    if (open) {
      return (
        <div className={CARD}>
          <div className="mb-2 flex items-center justify-between">
            <p className={FIELD_LABEL}>{label}</p>
            <button
              type="button"
              onClick={() => {
                if (text !== saved) void save();
                setOpen(false);
              }}
              className="text-[13px] font-semibold text-[#2F6FD1]"
            >
              Gotowe
            </button>
          </div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (value.trim() !== saved) void save();
            }}
            rows={3}
            placeholder={placeholder}
            className={`${INPUT_BASE} resize-none border-[#E2E6EC] focus:border-[#2F6FD1]`}
          />
        </div>
      );
    }
    if (text) {
      return (
        <button type="button" onClick={() => setOpen(true)} className={`${CARD} text-left`}>
          <p className={`mb-1 ${FIELD_LABEL}`}>{label}</p>
          <p className="whitespace-pre-wrap text-[13.5px] text-[#171A21]">{text}</p>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5 text-[13.5px] font-semibold text-[#2F6FD1]"
      >
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-[#2F6FD1] text-[13px] leading-none">
          +
        </span>
        {label === "Uwaga do dostawy" ? "Dodaj uwagę do dostawy" : "Dodaj uwagę do odbioru"}
      </button>
    );
  }

  const deliveryNotesCard = noteCard(
    "Uwaga do dostawy",
    deliveryNotes,
    setDeliveryNotes,
    deliveryNotesOpen,
    setDeliveryNotesOpen,
    savedDeliveryNotes,
    "np. MP. dostawa połączona z innym klientem",
  );
  const pickupNotesCard = noteCard(
    "Uwaga do odbioru",
    pickupNotes,
    setPickupNotes,
    pickupNotesOpen,
    setPickupNotesOpen,
    savedPickupNotes,
    "np. MP. odbiór połączony z innym klientem",
  );

  // Brak rozliczenia przygotowanego przez biuro — kierowca może zostawić tylko uwagi.
  if (!finance) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[14px] border border-[#F0DFB6] bg-[#FBF3E1] px-4 py-3 text-[13px] text-[#8A6A16]">
          Biuro nie przygotowało jeszcze rozliczenia tego wydarzenia.
        </div>
        {tripInfoSlot}
        {deliveryNotesCard}
        {pickupNotesCard}
        {statusLine}
      </div>
    );
  }

  const rentalIsCash = finance.paymentMethod === "CASH";
  const rentalValue = finance.vatApplicable ? gross : net;

  // Transport rozliczany osobno (biuro włączyło „niezależna płatność").
  const transportSep = !isSzkolenie && finance.transportPaidSeparately && (transportGross ?? 0) > 0;
  const transportIsCash = transportSep && finance.transportPaymentMethod !== "TRANSFER";
  const transportValue = finance.transportVatApplicable ? transportGross ?? 0 : transportNet ?? 0;

  // Ile gotówki kierowca realnie odbiera (wynajem gotówką + transport gotówką).
  const cashTotal = (rentalIsCash ? rentalValue : 0) + (transportIsCash ? transportValue : 0);
  const splitLabel = (cash: boolean) => (cash ? "gotówką" : "przelewem");

  // Trzy stany banera:
  //  cash     — wynajem płatny gotówką (± transport): pełny pomarańcz, duża kwota
  //  mixed    — wynajem przelewem, ale transport osobno gotówką: kolor pośredni
  //             (bursztyn), wyraźna sekcja „transport gotówką"
  //  transfer — wszystko przelewem: zieleń, nic nie pobierasz
  const bannerKind: "cash" | "mixed" | "transfer" = rentalIsCash
    ? "cash"
    : transportIsCash
      ? "mixed"
      : "transfer";

  const bannerBg = {
    cash: "bg-[linear-gradient(155deg,#E15A2B_0%,#9C3D1B_100%)] shadow-[0_10px_24px_-10px_rgba(225,90,43,0.5)]",
    mixed: "bg-[linear-gradient(150deg,#E1852B_0%,#7C6A2E_58%,#2C8A63_100%)] shadow-[0_10px_24px_-10px_rgba(196,140,52,0.5)]",
    transfer: "bg-[linear-gradient(155deg,#1E9E6B_0%,#12724F_100%)] shadow-[0_10px_24px_-10px_rgba(30,158,107,0.45)]",
  }[bannerKind];

  const transportCashCheckbox = (
    <label className="mt-2.5 flex items-center gap-2.5 rounded-[9px] border border-white/[0.3] bg-white/[0.16] px-3 py-2.5 text-left text-[13px] font-semibold">
      <input
        type="checkbox"
        className="h-[19px] w-[19px] flex-none accent-[#2F6FD1]"
        checked={transportCash}
        onChange={(e) => {
          setTransportCash(e.target.checked);
          void save({ transportCashCollected: e.target.checked });
        }}
      />
      Gotówka za transport odebrana
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Banner płatności — pierwsza rzecz, jaką widzi kierowca (mockup-master).
          Jedyny element z wyraźnym cieniem. */}
      <div className={`rounded-[14px] px-5 py-[18px] text-center text-white ${bannerBg}`}>
        <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] opacity-90">
          {bannerKind === "cash" ? "💵 Gotówka" : bannerKind === "mixed" ? "🏦 Przelew · 💵 transport" : "🏦 Przelew"}
        </div>

        {bannerKind === "cash" && (
          <>
            <div className="mt-1.5 text-[36px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              {fmt(cashTotal)} zł
            </div>
            <div className="mt-1.5 text-[12.5px] opacity-85">do odebrania od klientki</div>
            {pending && (
              <div className="mt-1 text-[11px] font-semibold opacity-85">
                kwota tymczasowa — uzupełnij liczniki impulsów poniżej
              </div>
            )}

            {transportSep && (
              <div className="mt-2.5 space-y-0.5 border-t border-white/[0.25] pt-2.5 text-[12.5px] opacity-90">
                <div>
                  Wynajem: <b className="font-bold">{fmt(rentalValue)} zł</b> — {splitLabel(rentalIsCash)}
                </div>
                <div>
                  Transport: <b className="font-bold">{fmt(transportValue)} zł</b> — {splitLabel(transportIsCash)}
                </div>
              </div>
            )}

            <label className="mt-3 flex items-center gap-2.5 rounded-[9px] border border-white/[0.28] bg-white/[0.14] px-3 py-2.5 text-left text-[13px] font-semibold">
              <input
                type="checkbox"
                className="h-[19px] w-[19px] flex-none accent-[#2F6FD1]"
                checked={cashCollected}
                onChange={(e) => {
                  setCashCollected(e.target.checked);
                  void save({ cashCollected: e.target.checked });
                }}
              />
              {transportSep ? "Gotówka za wynajem odebrana" : "Gotówka odebrana"}
            </label>
            {transportIsCash && transportCashCheckbox}
          </>
        )}

        {bannerKind === "mixed" && (
          <>
            <div className="mt-2 text-[19px] font-extrabold leading-[1.25]">
              Nie pobierasz gotówki za wynajem
            </div>
            <div className="mt-1 text-[12.5px] opacity-90">
              Wynajem <b className="font-bold">{fmt(rentalValue)} zł</b> — rozliczony przelewem
            </div>

            <div className="mt-3 rounded-[11px] border border-white/[0.4] bg-white/[0.18] px-3 py-3">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.05em] opacity-95">
                ⚠ Transport rozliczany osobno — gotówką
              </div>
              <div className="mt-1 text-[30px] font-extrabold leading-none tabular-nums">
                {fmt(transportValue)} zł
              </div>
              <div className="mt-0.5 text-[12px] opacity-85">do odebrania od klientki</div>
              {transportCashCheckbox}
            </div>
          </>
        )}

        {bannerKind === "transfer" && (
          <>
            <div className="mt-2 text-[19px] font-extrabold leading-[1.3]">Nie musisz pobierać gotówki</div>
            <div className="mt-2.5 space-y-0.5 border-t border-white/[0.25] pt-2.5 text-[13px] opacity-90">
              <div>
                {transportSep ? "Wynajem" : "Wartość wynajmu"}: <b className="font-bold">{fmt(rentalValue)} zł</b> — przelewem
              </div>
              {transportSep && (
                <div>
                  Transport: <b className="font-bold">{fmt(transportValue)} zł</b> — przelewem
                </div>
              )}
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

      {/* Membrany Cooltech — proste pole nad rozbiciem kwoty, bez nagłówka
          karty; stepper obok checkboxa doprecyzowuje ilość, tylko gdy
          zaznaczone. */}
      {isCooltech && (
        <div className={CARD}>
          {showMembraneReminder && (
            <div className="mb-2.5 flex items-center justify-between gap-2 rounded-[9px] border border-[#F0DFB6] bg-[#FBF3E1] px-3 py-2 text-[12.5px] text-[#8A6A16]">
              <span>Zaznacz, czy zużyto membrany</span>
              <button
                type="button"
                onClick={() => void save({ membraneUsed: false })}
                className="flex-none font-semibold underline"
              >
                Nie było
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-[14px] font-semibold text-[#171A21]">
              <input
                type="checkbox"
                className="h-[19px] w-[19px] flex-none accent-[#2F6FD1]"
                checked={membraneUsed}
                onChange={(e) => {
                  const v = e.target.checked;
                  setMembraneUsed(v);
                  if (!v) setMembraneCount(1);
                  void save({ membraneUsed: v, membraneCount: v ? membraneCount : 1 });
                }}
              />
              Zużyto membrany
            </label>
            {membraneUsed && (
              <div className="flex flex-none items-center gap-3">
                <button
                  type="button"
                  aria-label="mniej"
                  disabled={membraneCount <= 1}
                  onClick={() => {
                    const v = Math.max(1, membraneCount - 1);
                    setMembraneCount(v);
                    void save({ membraneCount: v });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-[#E2E6EC] text-[15px] font-bold leading-none text-[#171A21] disabled:opacity-40"
                >
                  −
                </button>
                <span className="min-w-[14px] text-center text-[16px] font-extrabold tabular-nums">{membraneCount}</span>
                <button
                  type="button"
                  aria-label="więcej"
                  disabled={membraneCount >= MAX_MEMBRANE_COUNT}
                  onClick={() => {
                    const v = Math.min(MAX_MEMBRANE_COUNT, membraneCount + 1);
                    setMembraneCount(v);
                    void save({ membraneCount: v });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-[#E2E6EC] text-[15px] font-bold leading-none text-[#171A21] disabled:opacity-40"
                >
                  +
                </button>
              </div>
            )}
          </div>
          {membraneUsed && membraneCount >= 4 && (
            <p className="mt-2 text-[12px] text-[#B5851E]">Nietypowo duża liczba — sprawdź przed zapisaniem.</p>
          )}
        </div>
      )}

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
          {showCapReminder && (
            <div className="mb-2.5 flex items-center justify-between gap-2 rounded-[9px] border border-[#F0DFB6] bg-[#FBF3E1] px-3 py-2 text-[12.5px] text-[#8A6A16]">
              <span>Zaznacz, czy zużyto nakładkę</span>
              <button
                type="button"
                onClick={() => void save({ capUsed: false })}
                className="flex-none font-semibold underline"
              >
                Nie było
              </button>
            </div>
          )}
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

      {/* Czas pracy kierowcy — zbieranie danych pod przyszły moduł kosztów. */}
      <div className={CARD}>
        <p className={`mb-1 ${FIELD_LABEL}`}>Czas pracy (min)</p>
        <p className="mb-3 text-[11px] text-[#9CA3AF]">Opcjonalnie — wpisz ile zajął dojazd/rozstawienie i odbiór.</p>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-[11px] font-bold uppercase tracking-[0.03em] text-[#9CA3AF]">
            Dostawa
            <input
              value={deliveryMin}
              onChange={(e) => setDeliveryMin(e.target.value)}
              onBlur={() => {
                if (deliveryMinParsed !== undefined && deliveryMinParsed !== savedDeliveryMin) void save();
              }}
              inputMode="numeric"
              placeholder="np. 45"
              className={`mt-1 ${INPUT_BASE} ${
                deliveryMinParsed === undefined ? "border-[#E15A2B]" : "border-[#E2E6EC] focus:border-[#2F6FD1]"
              }`}
            />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.03em] text-[#9CA3AF]">
            Odbiór
            <input
              value={pickupMin}
              onChange={(e) => setPickupMin(e.target.value)}
              onBlur={() => {
                if (pickupMinParsed !== undefined && pickupMinParsed !== savedPickupMin) void save();
              }}
              inputMode="numeric"
              placeholder="np. 30"
              className={`mt-1 ${INPUT_BASE} ${
                pickupMinParsed === undefined ? "border-[#E15A2B]" : "border-[#E2E6EC] focus:border-[#2F6FD1]"
              }`}
            />
          </label>
        </div>
        {(deliveryMinParsed === undefined || pickupMinParsed === undefined) && (
          <p className="mt-2 text-[12px] text-[#E15A2B]">Podaj liczbę minut (0–1440).</p>
        )}
      </div>

      {/* Pojazd odbioru, gdy inny niż dostawy — np. odbiór łączony z innym
          klientem, jedzie się innym autem. Dostawa zawsze pojazdem z biura
          (vehicleName), tego kierowca tu nie zmienia. Karta pokazuje się
          tylko gdy jest jakiś INNY pojazd do wyboru. */}
      {vehicleId && otherVehicles.length > 0 && (
        <div className={CARD}>
          <p className={`mb-1 ${FIELD_LABEL}`}>Pojazd</p>
          <p className="mb-3 text-[13.5px] text-[#171A21]">
            Dostawa: <b>{vehicleName ?? "—"}</b>
          </p>
          <label className="flex items-center gap-2 text-[13.5px] text-[#171A21]">
            <input
              type="checkbox"
              checked={!pickupSameVehicle}
              onChange={(e) => {
                const different = e.target.checked;
                setPickupSameVehicle(!different);
                if (!different) {
                  setPickupVehicleSel("");
                  void save({ pickupSameVehicle: true, pickupVehicleSel: "" });
                }
              }}
            />
            Odbiór innym pojazdem
          </label>
          {!pickupSameVehicle && (
            <select
              value={pickupVehicleSel}
              onChange={(e) => {
                const v = e.target.value;
                setPickupVehicleSel(v);
                if (v) void save({ pickupVehicleSel: v });
              }}
              className={`mt-2 ${INPUT_BASE} border-[#E2E6EC] focus:border-[#2F6FD1]`}
            >
              <option value="">— wybierz pojazd —</option>
              {otherVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {deliveryNotesCard}
      {pickupNotesCard}
    </div>
  );
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
