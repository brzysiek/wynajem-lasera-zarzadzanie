import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { SmsSendPanel } from "@/components/sms-send-panel";
import { SmsHistory, type QueuedSms } from "@/components/sms-history";
import { searchSmsHistory } from "@/lib/sms/history";
import { listSmsTemplates } from "@/lib/message-templates";
import { getUpcomingQueue } from "@/lib/reminders";

// Rola AGENT: tylko historia wysłanych (dowód kontaktu z klientem) — bez
// formularza wysyłki i bez kolejki przypomnień (anulowanie/edycja).
export default async function SmsSendingPage() {
  const session = await auth();
  const historyOnly = session?.user.role === "AGENT";
  const [templates, initial, queueItems] = await Promise.all([listSmsTemplates(), searchSmsHistory({ limit: 100 }), historyOnly ? Promise.resolve([]) : getUpcomingQueue()]);

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
      </div>
    </div>
  );
}
