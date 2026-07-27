import { PageHeader } from "@/components/page-header";
import { ReminderSettingsPanel } from "@/components/reminder-settings-panel";
import { getReminderHour, getReminderTemplates } from "@/lib/reminders";

export default async function ReminderSettingsPage() {
  const [hour, templates] = await Promise.all([getReminderHour(), getReminderTemplates()]);

  return (
    <div>
      <PageHeader
        title="Przypomnienia SMS"
        description="Godzina automatycznej wysyłki i treść przypomnień SMS o nadchodzącym wynajmie."
      />
      <ReminderSettingsPanel initialHour={hour} initialTemplates={templates} />
    </div>
  );
}
