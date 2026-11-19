import { redirect } from "next/navigation";

// Import kosztów przeniesiony do Marketing → Ustawienia pomiaru (wniosek 54, etap 1c).
export default function CostImportMovedPage() {
  redirect("/marketing/ustawienia");
}
