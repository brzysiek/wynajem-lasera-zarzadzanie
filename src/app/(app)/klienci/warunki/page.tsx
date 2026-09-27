import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadTermsReview } from "@/lib/clients/terms-backfill";
import { TermsReview } from "@/components/clients/terms-review";

// Kwoty wg warunków (karta klienta, etap D): przyszłe rezerwacje bez kwoty u
// klientów z warunkami handlowymi (uzupełnienie jednym kliknięciem) i lista
// rezerwacji, w których wpisana kwota różni się od warunków (dla Ani).
export default async function TermsReviewPage() {
  const session = await requireClientsPageAccess();
  const review = await loadTermsReview();
  return <TermsReview initial={review} canApply={session.user.role !== "AGENT"} />;
}
