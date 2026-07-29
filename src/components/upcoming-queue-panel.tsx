"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

export type UpcomingQueueItem = {
  id: string;
  rentalId: string;
  rentalTitle: string;
  deviceName: string;
  clientName: string | null;
  phone: string | null;
  daysBefore: 1 | 3 | 7;
  scheduledFor: string;
  messageBody: string;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function QueueRow({ item, onCancelled }: { item: UpcomingQueueItem; onCancelled: (id: string) => void }) {
  const router = useRouter();
  const [isCancelling, setIsCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setIsCancelling(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/reminders/queue/${item.id}/cancel`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setIsCancelling(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się anulować.");
      return;
    }
    onCancelled(item.id);
    router.refresh();
  }

  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{formatDate(item.scheduledFor)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{item.daysBefore} dni przed</td>
      <td className="px-4 py-2 text-gray-900">
        {item.rentalTitle} ({item.deviceName})
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{item.clientName || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{item.phone || "—"}</td>
      <td className="max-w-xs truncate px-4 py-2 text-gray-600" title={item.messageBody}>
        {item.messageBody}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        {error && <p className="mb-1 text-xs text-red-700">{error}</p>}
        {confirming ? (
          <span className="flex items-center justify-end gap-2 text-xs">
            <span className="text-gray-600">Na pewno?</span>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isCancelling ? "Anulowanie…" : "Tak, anuluj"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-gray-500 hover:underline">
              Wróć
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
          >
            Anuluj
          </button>
        )}
      </td>
    </tr>
  );
}

export function UpcomingQueuePanel({ initialItems }: { initialItems: UpcomingQueueItem[] }) {
  const [items, setItems] = useState(initialItems);

  function handleCancelled(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900">Nadchodzące powiadomienia do wysłania</h2>
        <p className="mt-1 text-sm text-gray-500">
          Przypomnienia 1/3/7-dniowe, które wejdą do najbliższej wysyłki — widoczne tu, gdy zbliża się ich termin, na
          tyle wcześnie, by można je jeszcze anulować przed wysłaniem.
        </p>
      </div>
      {items.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-400">Brak powiadomień w kolejce.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-2">Termin wysyłki</th>
                <th className="px-4 py-2">Przypomnienie</th>
                <th className="px-4 py-2">Wynajem</th>
                <th className="px-4 py-2">Klient</th>
                <th className="px-4 py-2">Telefon</th>
                <th className="px-4 py-2">Treść</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <QueueRow key={item.id} item={item} onCancelled={handleCancelled} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
