import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadProposal } from "@/lib/porzadki/proposals";
import { loadClientOptions } from "@/lib/porzadki/client-options";
import { loadAreas } from "@/lib/porzadki/areas";
import { ProposalDetailView } from "@/components/porzadki/proposal-detail";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireClientsPageAccess();
  const { id } = await params;
  const [p, clientOptions, others, areas] = await Promise.all([
    loadProposal(id, { userId: session.user.id, role: session.user.role }),
    loadClientOptions(),
    prisma.proposal.findMany({ orderBy: { number: "desc" }, select: { id: true, number: true, title: true }, take: 500 }),
    loadAreas(),
  ]);
  if (!p) notFound();
  return <ProposalDetailView key={p.id} initial={p} role={session.user.role} clientOptions={clientOptions} areas={areas} others={others} />;
}
