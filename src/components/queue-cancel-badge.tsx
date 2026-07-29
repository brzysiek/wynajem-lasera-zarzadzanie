"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

// Clickable "zakolejkowane" badge used everywhere a QUEUED/SCHEDULED
// ReminderRule is shown (upcoming queue panel, SMS history, rental detail):
// clicking it reveals an inline two-step confirm, then cancels that one
// reminder via the shared /api/reminders/queue/[id]/cancel endpoint.
export function QueueCancelBadge({ ruleId, onCancelled }: { ruleId: string; onCancelled?: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setIsCancelling(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/reminders/queue/${ruleId}/cancel`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setIsCancelling(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się anulować.");
      return;
    }
    setConfirming(false);
    onCancelled?.();
    router.refresh();
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
        <span className="text-gray-600">Na pewno?</span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling}
          className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isCancelling ? "Anulowanie…" : "Tak, anuluj"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-gray-500 hover:underline">
          Wróć
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Kliknij, aby anulować wysyłkę"
      className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200"
    >
      zakolejkowane
    </button>
  );
}
