import { redirect } from "next/navigation";

// Konwersje Google (eksport CSV) przeniesione do Marketing → Ustawienia pomiaru (wniosek 54, etap 1c).
export default function GoogleConversionsMovedPage() {
  redirect("/marketing/ustawienia");
}
