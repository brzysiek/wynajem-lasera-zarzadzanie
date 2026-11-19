import Link from "next/link";
import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { getFakturowniaConfigStatus } from "@/lib/integrations/fakturownia";
import { getGoogleCalendarConfigStatus } from "@/lib/integrations/google-calendar";
import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";
import { getSzybkiSmsConfigStatus } from "@/lib/integrations/szybkisms";
import { metaConfigStatus } from "@/lib/chat/meta-graph";
import { prisma } from "@/lib/prisma";
import { SETTINGS_GROUPS, itemAccess } from "@/lib/settings-nav";

// Ustawienia → Przegląd (wniosek 55): kafelki 6 grup z opisem i stan integracji
// (połączona / niepołączona, ostatnia synchronizacja kalendarza i błąd).
export default async function SettingsOverviewPage() {
  const session = await auth();
  const role = session?.user.role;
  const google = getGoogleCalendarConfigStatus() as { configured?: boolean };
  const meta = metaConfigStatus();
  const [lastSync, lastOk] = await Promise.all([
    prisma.syncLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true, errorMessage: true } }),
    prisma.syncLog.findFirst({ where: { status: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const when = (d: Date | null | undefined) => (d ? d.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null);
  const integrations: { name: string; ok: boolean; detail: string | null; href: string }[] = [
    {
      name: "Google Calendar",
      ok: Boolean(google.configured) && lastSync?.status !== "ERROR",
      detail: !google.configured ? "nie połączony" : lastSync?.status === "ERROR" ? `błąd synchronizacji (${when(lastSync.createdAt)})` : lastOk ? `ostatnia synchronizacja ${when(lastOk.createdAt)}` : "połączony",
      href: "/ustawienia/integracje/google",
    },
    { name: "HubSpot", ok: getHubspotConfigStatus().configured, detail: getHubspotConfigStatus().configured ? "połączony" : "nie połączony", href: "/ustawienia/integracje/hubspot" },
    { name: "Fakturownia", ok: getFakturowniaConfigStatus().configured, detail: getFakturowniaConfigStatus().configured ? "połączona" : "nie połączona", href: "/ustawienia/integracje/fakturownia" },
    { name: "SzybkiSMS", ok: getSzybkiSmsConfigStatus().configured, detail: getSzybkiSmsConfigStatus().configured ? "połączony" : "nie połączony", href: "/ustawienia/integracje/szybkisms" },
    {
      name: "Meta (Messenger, Instagram)",
      ok: meta.appSecret && meta.pageToken && meta.verifyToken,
      detail: meta.appSecret && meta.pageToken && meta.verifyToken ? "skonfigurowana" : "brakuje kluczy",
      href: "/ustawienia/messenger-instagram",
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ustawienia" description="Wszystko, co konfiguruje panel — w sześciu grupach. Praca bieżąca (kolejka SMS, kwalifikacja kontaktów, szkice faktur) jest w swoich modułach." />
      {role === "STAFF" && (
        <p className="m-0 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Możesz edytować większość pozycji. Użytkownicy, Integracje, Messenger / Instagram i Importy historii są tylko do podglądu — zmiany w nich wprowadza administrator.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SETTINGS_GROUPS.map((g) => (
          <section key={g.key} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <h2 className="m-0 text-base font-semibold text-gray-900">{g.title}</h2>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">{g.description}</p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {g.items.map((i) => (
                <li key={i.href} className="text-sm">
                  <Link href={i.href} className="font-medium text-[#1B6FA8] hover:underline">
                    {i.label}
                  </Link>
                  {itemAccess(i, role) === "view" && <span className="ml-1 text-xs text-gray-400" title="tylko podgląd">🔒</span>}
                  <div className="text-xs text-gray-500">{i.hint}</div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <h2 className="m-0 mb-3 text-base font-semibold text-gray-900">Stan integracji</h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((x) => (
            <li key={x.name} className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span className={`mt-1.5 inline-block h-2.5 w-2.5 flex-none rounded-full ${x.ok ? "bg-green-600" : "bg-amber-500"}`} aria-hidden="true" />
              <span>
                <Link href={x.href} className="font-medium text-gray-900 hover:underline">
                  {x.name}
                </Link>
                <span className="block text-xs text-gray-500">{x.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
