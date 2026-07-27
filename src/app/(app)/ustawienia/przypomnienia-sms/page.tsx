import { PageHeader } from "@/components/page-header";
import { ReminderSettingsPanel } from "@/components/reminder-settings-panel";
import { SmsTemplatesPanel } from "@/components/sms-templates-panel";
import { getReminderHour } from "@/lib/reminders";
import { listSmsTemplates } from "@/lib/message-templates";

export default async function ReminderSettingsPage() {
  const [hour, templates] = await Promise.all([getReminderHour(), listSmsTemplates()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Przypomnienia SMS"
        description="Godzina automatycznej wysyłki i treść przypomnień SMS o nadchodzącym wynajmie."
      />
      <ReminderSettingsPanel initialHour={hour} />
      <SmsTemplatesPanel initialTemplates={templates} />
    </div>
  );
}
