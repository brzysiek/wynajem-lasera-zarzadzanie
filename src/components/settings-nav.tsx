"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_GROUPS, SETTINGS_HOME, findItem, itemAccess, type SettingsRole } from "@/lib/settings-nav";

// Menu boczne Ustawień (wniosek 55): 6 grup + „Przegląd”. Pozycje tylko do podglądu dla
// STAFF są oznaczone kłódką. Na telefonie menu jest nad treścią (poziomo przewijane grupy).
export function SettingsNav({ role }: { role: SettingsRole }) {
  const pathname = usePathname();
  const current = findItem(pathname);
  const onHome = pathname === SETTINGS_HOME;
  const link = (on: boolean) => `flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm ${on ? "bg-[#E8F2F9] font-semibold text-[#1B6FA8]" : "text-gray-700 hover:bg-gray-100"}`;
  return (
    <nav aria-label="Ustawienia" className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Link href={SETTINGS_HOME} aria-current={onHome ? "page" : undefined} className={link(onHome)}>
        Przegląd
      </Link>
      {SETTINGS_GROUPS.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.title}</div>
          {g.items.map((i) => {
            const on = current?.item.href === i.href;
            const view = itemAccess(i, role) === "view";
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={link(on)} title={view ? `${i.hint} — tylko podgląd` : i.hint}>
                <span>{i.label}</span>
                {view && (
                  <span className="text-xs text-gray-400" aria-label="tylko podgląd">
                    🔒
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
