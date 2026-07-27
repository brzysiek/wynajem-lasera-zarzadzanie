import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { ReminderRunNowButton } from "@/components/reminder-run-now-button";
import { prisma } from "@/lib/prisma";

function formatDateTime(value: Date): string {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

export default async function GatewaySettingsPage() {
  await requireAdmin();

  const messages = await prisma.message.findMany({
    where: { channel: "SMS" },
    orderBy: { sentAt: "desc" },
    take: 200,
    include: { rental: { include: { device: true } } },
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader title="Bramka" description="Historia SMS-ów wysłanych przez bramkę SzybkiSMS." />
        <ReminderRunNowButton />
      </div>

      {messages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
          Brak wysłanych SMS-ów.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Odbiorca</th>
                <th className="px-4 py-2 font-medium">Wynajem</th>
                <th className="px-4 py-2 font-medium">Treść</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(m.sentAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-900">{m.recipient}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                    {m.rental ? `${m.rental.title} (${m.rental.device.name})` : "—"}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-gray-600" title={m.body}>
                    {m.body}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        m.status === "SENT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                      title={m.errorMessage || undefined}
                    >
                      {m.status === "SENT" ? "wysłano" : "błąd"}
                    </span>
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
