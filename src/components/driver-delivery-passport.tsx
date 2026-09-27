"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type { DeliveryAddressDto } from "@/lib/clients/delivery";
import { routeLabel, splitFeedback } from "@/lib/clients/delivery-rules";

// Widok kierowcy: paszport dostawy adresu tego wynajmu (karta klienta, etap
// B) — pola „na miejscu”, uwagi biura i poprzednich kierowców (u góry), oraz
// formularz własnej uwagi po dostawie / odbiorze (przy raporcie kierowcy).

const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const CARD_LABEL = "mb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#9CA3AF]";

const ROWS: { key: keyof DeliveryAddressDto; label: string }[] = [
  { key: "entrance", label: "Wejście" },
  { key: "floor", label: "Piętro / winda" },
  { key: "parking", label: "Parking" },
  { key: "power", label: "Prąd" },
  { key: "receiver", label: "Kto odbiera" },
  { key: "openingHours", label: "Godziny otwarcia" },
  { key: "usualStartTime", label: "Zwykle dostawa" },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

export function DriverDeliveryPassport({ address: a }: { address: DeliveryAddressDto }) {
  const [showAll, setShowAll] = useState(false);
  const rows = ROWS.filter((r) => a[r.key]);
  const route = routeLabel(a.distanceKm, a.routeAuto ? a.durationMin : null);
  const { shown, more } = splitFeedback(a.feedback);

  return (
    <div className={CARD}>
      <p className={CARD_LABEL}>Paszport dostawy · {a.label}</p>
      {route && <p className="text-[12.5px] text-[#6B7280]">{route} od bazy</p>}
      {rows.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[112px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13.5px]">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-[#6B7280]">{r.label}</dt>
              <dd className="font-medium text-[#171A21]">{String(a[r.key])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-[13px] text-[#9CA3AF]">Brak wskazówek na miejscu — po dostawie dopisz na dole, co warto wiedzieć następnym razem.</p>
      )}
      {a.officeNotes && (
        <div className="mt-2.5 flex gap-2 rounded-[9px] border border-[#F0E0B8] bg-[#FBF3E1] px-3 py-2 text-[12.5px] text-[#7A5A0E]">
          <span aria-hidden>💬</span>
          <span>
            <b className="font-bold">Uwagi biura:</b> {a.officeNotes}
          </span>
        </div>
      )}
      {a.feedback.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9CA3AF]">Uwagi kierowców</p>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] text-[#171A21]">
            {[...shown, ...(showAll ? more : [])].map((f) => (
              <li key={f.id}>
                <span className="text-[#6B7280]">
                  {day(f.rentalAt ?? f.createdAt)}
                  {f.driverName ? ` · ${f.driverName}` : ""}:
                </span>{" "}
                {f.text}
              </li>
            ))}
          </ul>
          {more.length > 0 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-[#2F6FD1]">
              {showAll ? "mniej" : `więcej (${more.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Uwaga o adresie — obok raportu kierowcy (uwagi do dostawy / odbioru). Trafia
// do paszportu dostawy klienta, więc zobaczą ją kolejni kierowcy i biuro.
export function DriverFeedbackForm({ rentalId, label }: { rentalId: string; label: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function add() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/delivery-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) return setMsg({ text: data?.message ?? "Nie udało się zapisać uwagi.", error: true });
    setText("");
    setMsg({ text: "Dopisano do paszportu dostawy." });
    router.refresh();
  }

  return (
    <div className={CARD}>
      <p className={CARD_LABEL}>Uwaga o adresie · {label}</p>
      <p className="mb-2 text-[12.5px] text-[#6B7280]">Dla kolejnych kierowców — trafi do paszportu dostawy klienta (np. wjazd, parking, kto odbiera).</p>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="np. wjazd od podwórza, parking za budynkiem"
        className="w-full rounded-[9px] border border-[#E2E6EC] px-3 py-2 text-[14px] text-[#171A21] outline-none focus:border-[#2F6FD1]"
      />
      {msg && <p className={`mt-1 text-[12.5px] ${msg.error ? "text-[#B42318]" : "text-[#2F7A68]"}`}>{msg.text}</p>}
      <button
        type="button"
        onClick={() => void add()}
        disabled={saving || !text.trim()}
        className="mt-2 h-10 w-full rounded-[10px] border border-[#2F6FD1] bg-white text-[14px] font-semibold text-[#2F6FD1] disabled:opacity-40"
      >
        {saving ? "Zapisywanie…" : "Dodaj uwagę o adresie"}
      </button>
    </div>
  );
}
