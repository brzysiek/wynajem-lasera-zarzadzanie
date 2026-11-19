import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { SmsSendPanel } from "@/components/sms-send-panel";
import { SmsHistory, type QueuedSms } from "@/components/sms-history";
import { searchSmsHistory } from "@/lib/sms/history";
import { listSmsTemplates } from "@/lib/message-templates";
import { getReminderCheckLogs, getUpcomingQueue } from "@/lib/reminders";
import { ReminderManualRunPanel } from "@/components/reminder-manual-run-panel";
import { ReminderCheckLogTable } from "@/components/reminder-check-log-table";
import { UpcomingQueuePanel } from "@/components/upcoming-queue-panel";

// Rola AGENT: tylko historia wysłanych (dowód kontaktu z klientem) — bez
// formularza wysyłki i bez kolejki przypomnień (anulowanie/edycja).
export default async function SmsSendingPage() {
  const session = await auth();
  const historyOnly = session?.user.role === "AGENT";
  const [templates, initial, queueItems, checkLogPage] = await Promise.all([
    listSmsTemplates(),
    searchSmsHistory({ limit: 100 }),
    historyOnly ? Promise.resolve([]) : getUpcomingQueue(),
    historyOnly ? Promise.resolve(null) : getReminderCheckLogs({ page: 1, pageSize: 25 }),
  ]);
  const isAdmin = session?.user.role === "ADMIN";

  const templateOptions = templates.map((t) => ({ id: t.id, label: t.label, body: t.body }));
  const queued: QueuedSms[] = queueItems.map((item) => ({
    id: item.id,
    at: new Date(item.scheduledFor).toISOString(),
    recipient: item.phone || "—",
    rentalLabel: `${item.rentalTitle} (${item.deviceName})`,
    body: item.messageBody,
    daysBefore: item.daysBefore,
  }));

  return (
    <div>
      <div className="mb-6">
        <PageHeader
          title={historyOnly ? "Historia SMS" : "Wysyłka SMS"}
          description={historyOnly ? "Wysłane SMS-y — podgląd bez wysyłki." : "Wyślij pojedynczą wiadomość SMS i przeglądaj historię wysyłki."}
        />
      </div>

      <div className="flex flex-col gap-6">
        {!historyOnly && <SmsSendPanel templates={templateOptions} />}

        <SmsHistory queued={queued} initial={initial} canCancel={!historyOnly} />

        {/* Wniosek 55: praca bieżąca z automatycznymi przypomnieniami (dawniej w Ustawieniach). */}
        {!historyOnly && (
          <section className="flex flex-col gap-4" aria-label="Przypomnienia automatyczne">
            <h2 className="m-0 text-lg font-semibold text-gray-900">Przypomnienia automatyczne</h2>
            {isAdmin && <ReminderManualRunPanel />}
            <UpcomingQueuePanel initialItems={queueItems} />
            {checkLogPage && <ReminderCheckLogTable initialLogs={checkLogPage.logs} initialTotal={checkLogPage.total} />}
          </section>
        )}
      </div>
    </div>
  );
}
