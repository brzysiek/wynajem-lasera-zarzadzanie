import { PageHeader } from "@/components/page-header";
import { SmsTemplatesPanel } from "@/components/sms-templates-panel";
import { listSmsTemplates } from "@/lib/message-templates";

export default async function SmsTemplatesPage() {
  const templates = await listSmsTemplates();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Szablony SMS"
        description="Treść przypomnień o nadchodzącym wynajmie oraz dowolne własne szablony do ręcznej wysyłki."
      />
      <SmsTemplatesPanel initialTemplates={templates} />
    </div>
  );
}
