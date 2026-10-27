"use client";

import { useState } from "react";
import { api } from "@/components/clients/client-forms";
import type { MergeBadge as MergeBadgeData } from "@/lib/chat/merge";

// „Możliwe połączenie: [nazwa]” (wniosek 42, decyzja Tomka 08.10): propozycja
// po samym imieniu i nazwisku jest na wierzchu kafelka (Tablica, „Na dziś”),
// nie schowana w karcie. „Połącz” scala sygnały bez wchodzenia w kartę, „To
// ktoś inny” chowa propozycję. Mruga, dopóki nie zostanie rozstrzygnięta.

export function MergeBadge({ badge, readOnly, onChanged }: { badge: MergeBadgeData; readOnly: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "merge" | "dismiss") {
    setBusy(true);
    setError(null);
    const { ok, data } = await api(`/api/lead-merge/${badge.id}`, "POST", { action });
    setBusy(false);
    if (!ok) return setError((data as { message?: string }).message ?? "Nie udało się zapisać.");
    onChanged();
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1 border-l-[3px] border-[#E08A5C] bg-[#FBF0E7] px-2 py-1.5 text-[11.5px] text-[#8A4A1F]" onClick={(e) => e.stopPropagation()} data-merge-badge>
      <span className="animate-pulse font-semibold">Możliwe połączenie: {badge.label}</span>
      {!readOnly && (
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy} onClick={() => void decide("merge")} className="h-6 rounded-[5px] bg-[#B8612F] px-2 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40">
            Połącz
          </button>
          <button type="button" disabled={busy} onClick={() => void decide("dismiss")} className="h-6 rounded-[5px] border border-[#C9D3DC] bg-white px-2 text-[11.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40">
            To ktoś inny
          </button>
        </span>
      )}
      {error && <span className="text-[#B8312F]">{error}</span>}
    </div>
  );
}
