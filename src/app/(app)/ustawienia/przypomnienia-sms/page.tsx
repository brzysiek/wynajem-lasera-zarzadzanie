import { PageHeader } from "@/components/page-header";
import { ReminderSettingsPanel } from "@/components/reminder-settings-panel";
import { SmsTemplatesPanel } from "@/components/sms-templates-panel";
import { getReminderHour, getReminderCheckLogs } from "@/lib/reminders";
import { listSmsTemplates } from "@/lib/message-templates";

function formatDateTime(value: Date): string {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "medium" });
}

export default async function ReminderSettingsPage() {
  const [hour, templates, checkLogs] = await Promise.all([
    getReminderHour(),
    listSmsTemplates(),
    getReminderCheckLogs(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Przypomnienia SMS"
        description="Godzina automatycznej wysyłki i treść przypomnień SMS o nadchodzącym wynajmie."
      />
      <ReminderSettingsPanel initialHour={hour} />
      <SmsTemplatesPanel initialTemplates={templates} />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Historia sprawdzeń</h2>
          <p className="mt-1 text-sm text-gray-500">
            Każde automatyczne sprawdzenie przypomnień do wysyłki (co kilka minut).
          </p>
        </div>
        {checkLogs.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">Brak zarejestrowanych sprawdzeń.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-4 py-2">Godzina</th>
                  <th className="px-4 py-2"># sprawdzonych wynajmów</th>
                  <th className="px-4 py-2"># przypomnień do wysłania</th>
                  <th className="px-4 py-2"># wysłanych przypomnień</th>
                  <th className="px-4 py-2"># błędów</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checkLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">{formatDateTime(log.createdAt)}</td>
                    <td className="px-4 py-2 text-gray-700">{log.rentalsChecked}</td>
                    <td className="px-4 py-2 text-gray-700">{log.dueCount}</td>
                    <td className="px-4 py-2 text-gray-700">{log.sentCount}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {log.failedCount > 0 ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          {log.failedCount}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
