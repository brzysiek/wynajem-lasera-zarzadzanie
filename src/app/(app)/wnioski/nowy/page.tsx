import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientOptions } from "@/lib/porzadki/client-options";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { EMPTY_PROPOSAL, ProposalForm } from "@/components/porzadki/proposal-form";

export default async function NewProposalPage() {
  await requireClientsPageAccess();
  const clientOptions = await loadClientOptions();
  return (
    <PorzadkiLayout title="Nowy wniosek" description="Opisz problem, pokaż dowód i zaproponuj zmianę. Decyzję podejmuje administrator.">
      <div className="max-w-3xl">
        <ProposalForm initial={EMPTY_PROPOSAL} clientOptions={clientOptions} />
      </div>
    </PorzadkiLayout>
  );
}
