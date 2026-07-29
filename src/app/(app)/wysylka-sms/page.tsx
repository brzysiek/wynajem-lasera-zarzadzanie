import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { SmsSendPanel } from "@/components/sms-send-panel";
import { ReminderRunNowButton } from "@/components/reminder-run-now-button";
import { QueueCancelBadge } from "@/components/queue-cancel-badge";
import { prisma } from "@/lib/prisma";
import { listSmsTemplates } from "@/lib/message-templates";
import { getUpcomingQueue } from "@/lib/reminders";

function formatDateTime(value: Date): string {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

type Row =
  | { kind: "message"; id: string; date: Date; recipient: string; rentalLabel: string; body: string; status: "SENT" | "FAILED"; errorMessage: string | null }
  | { kind: "queued"; id: string; date: Date; recipient: string; rentalLabel: string; body: string };

export default async function SmsSendingPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  const [templates, messages, queueItems] = await Promise.all([
    listSmsTemplates(),
    prisma.message.findMany({
      where: { channel: "SMS" },
      orderBy: { sentAt: "desc" },
      take: 200,
      include: { rental: { include: { device: true } } },
    }),
    getUpcomingQueue(),
  ]);

  const templateOptions = templates.map((t) => ({ id: t.id, label: t.label, body: t.body }));

  const rows: Row[] = [
    ...queueItems.map(
      (item): Row => ({
        kind: "queued",
        id: item.id,
        date: new Date(item.scheduledFor),
        recipient: item.phone || "—",
        rentalLabel: `${item.rentalTitle} (${item.deviceName})`,
        body: item.messageBody,
      }),
    ),
    ...messages.map(
      (m): Row => ({
        kind: "message",
        id: m.id,
        date: m.sentAt,
        recipient: m.recipient,
        rentalLabel: m.rental ? `${m.rental.title} (${m.rental.device.name})` : "—",
        body: m.body,
        status: m.status,
        errorMessage: m.errorMessage,
      }),
    ),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader title="Wysyłka SMS" description="Wyślij pojedynczą wiadomość SMS i przeglądaj historię wysyłki." />
        {isAdmin && <ReminderRunNowButton />}
      </div>

      <div className="flex flex-col gap-6">
        <SmsSendPanel templates={templateOptions} />

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
            Brak SMS-ów.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Historia SMS</h2>
            <div className="overflow-x-auto">
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
                  {rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(row.date)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-900">{row.recipient}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">{row.rentalLabel}</td>
                      <td className="max-w-xs truncate px-4 py-2 text-gray-600" title={row.body}>
                        {row.body}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {row.kind === "queued" ? (
                          <QueueCancelBadge ruleId={row.id} />
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              row.status === "SENT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                            title={row.errorMessage || undefined}
                          >
                            {row.status === "SENT" ? "wysłano" : "błąd"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
