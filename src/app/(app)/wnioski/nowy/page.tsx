import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientOptions } from "@/lib/porzadki/client-options";
import { loadAreas } from "@/lib/porzadki/areas";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { EMPTY_PROPOSAL, ProposalForm } from "@/components/porzadki/proposal-form";

// ?skrzynka=1 — nowy wpis w skrzynce Tomka (tylko obszary niedeweloperskie).
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ skrzynka?: string }> }) {
  await requireClientsPageAccess();
  const inbox = (await searchParams).skrzynka === "1";
  const [clientOptions, all] = await Promise.all([loadClientOptions(), loadAreas()]);
  const areas = all.filter((a) => a.dev !== inbox);
  return (
    <PorzadkiLayout
      title={inbox ? "Nowy wpis w skrzynce" : "Nowy wniosek"}
      description={
        inbox
          ? "Pomysł, decyzja albo sprawa do ogarnięcia (marketing, strona, oferta, organizacja). To notatka biznesowa — nie trafia do backlogu panelu."
          : "Opisz problem, pokaż dowód i zaproponuj zmianę. Decyzję podejmuje administrator."
      }
    >
      <div className="max-w-3xl">
        <ProposalForm initial={EMPTY_PROPOSAL} clientOptions={clientOptions} areas={areas} />
      </div>
    </PorzadkiLayout>
  );
}
