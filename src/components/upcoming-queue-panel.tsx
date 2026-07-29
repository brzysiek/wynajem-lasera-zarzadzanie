"use client";

import { useState } from "react";
import { QueueCancelBadge } from "@/components/queue-cancel-badge";

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

export function UpcomingQueuePanel({ initialItems }: { initialItems: UpcomingQueueItem[] }) {
  const [items, setItems] = useState(initialItems);

  function handleCancelled(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function handleSaved(id: string, body: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, messageBody: body } : i)));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900">Nadchodzące powiadomienia do wysłania</h2>
        <p className="mt-1 text-sm text-gray-500">
          Przypomnienia 1/3/7-dniowe, które wejdą do najbliższej wysyłki — widoczne tu, gdy zbliża się ich termin, na
          tyle wcześnie, by można je jeszcze edytować lub anulować przed wysłaniem. Kliknij badge „zakolejkowane”, żeby
          zmienić treść lub anulować wysyłkę.
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
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id}>
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
                  <td className="whitespace-nowrap px-4 py-2">
                    <QueueCancelBadge
                      ruleId={item.id}
                      daysBefore={item.daysBefore}
                      initialMessageBody={item.messageBody}
                      onSaved={(body) => handleSaved(item.id, body)}
                      onCancelled={() => handleCancelled(item.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
