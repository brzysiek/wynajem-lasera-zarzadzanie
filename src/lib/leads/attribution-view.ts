// Karta sygnału → „Skąd przyszło” (wniosek 41): grupowanie pól atrybucji
// z formularza WWW do wyświetlenia. Czysty moduł (vitest bez "@/").

export type Attribution = Record<string, string | string[]>;
export type AttrRow = { key: string; label: string; value: string };
export type AttrGroup = { title: string; rows: AttrRow[] };

// Lead.attribution (JSON z bazy) → tylko tekstowe wartości; reszta odrzucona.
export function normalizeAttribution(json: unknown): Attribution | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const out: Attribution = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v as string[];
  }
  return Object.keys(out).length ? out : null;
}

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Pierwsze wejście",
    keys: [
      ["utm_source", "źródło (utm_source)"],
      ["utm_medium", "medium (utm_medium)"],
      ["utm_campaign", "kampania (utm_campaign)"],
      ["utm_term", "fraza (utm_term)"],
      ["utm_content", "treść (utm_content)"],
      ["gclid", "gclid (Google Ads)"],
      ["fbclid", "fbclid (Meta)"],
    ],
  },
  {
    title: "Ostatnie wejście",
    keys: [
      ["last_utm_source", "źródło (last_utm_source)"],
      ["last_utm_campaign", "kampania (last_utm_campaign)"],
      ["last_gclid", "last_gclid"],
      ["last_fbclid", "last_fbclid"],
    ],
  },
  {
    title: "Meta (cookies, za zgodą)",
    keys: [
      ["fbp", "fbp"],
      ["fbc", "fbc"],
    ],
  },
];

const text = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(", ") : (v ?? "")).trim();

// Puste pola i puste grupy są pomijane. Strona: wejście, polecający,
// formularz i zgody (acceptance-*; zaznaczona = ✓).
export function groupAttribution(attr: Attribution | null): AttrGroup[] {
  if (!attr) return [];
  const groups: AttrGroup[] = [];
  for (const g of GROUPS) {
    const rows = g.keys.map(([key, label]) => ({ key, label, value: text(attr[key]) })).filter((r) => r.value);
    if (rows.length) groups.push({ title: g.title, rows });
  }
  const page: AttrRow[] = [
    { key: "landing_url", label: "strona wejścia", value: text(attr.landing_url) },
    { key: "referrer", label: "skąd (referrer)", value: text(attr.referrer) },
    { key: "form", label: "formularz", value: text(attr.form) },
    ...Object.keys(attr)
      .filter((k) => k.startsWith("acceptance"))
      .sort()
      .map((k) => {
        const v = text(attr[k]);
        return { key: k, label: `zgoda (${k})`, value: v && !["0", "false", "off"].includes(v.toLowerCase()) ? "✓ tak" : "nie" };
      }),
  ].filter((r) => r.value);
  if (page.length) groups.push({ title: "Strona i zgody", rows: page });
  return groups;
}

// Długie identyfikatory skracamy (początek…koniec); pełna wartość do kopiowania.
export function shortenId(value: string, max = 28): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.6);
  return `${value.slice(0, head)}…${value.slice(-(max - 1 - head))}`;
}
