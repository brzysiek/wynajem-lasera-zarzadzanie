import { redirect } from "next/navigation";

// Messenger / Instagram przeniesione do grupy „Zapytania i skrzynka” (wniosek 55).
export default function MetaIntegrationMovedPage() {
  redirect("/ustawienia/messenger-instagram");
}
