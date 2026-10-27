// Meta Graph API: sprawdzenie i odnowienie subskrypcji strony na webhook
// Messengera (wniosek 42). Token strony idzie wyłącznie w nagłówku Authorization
// (nie w adresie), a komunikaty błędów są oczyszczone z tokenów. Nic nie jest
// logowane ani zwracane z sekretów.

const GRAPH = "https://graph.facebook.com/v21.0";
// Messenger: messages, message_echoes, standby (komunikaty „przeczytano” pomijamy).
export const SUBSCRIBED_FIELDS = ["messages", "message_echoes", "standby"] as const;

export type MetaConfigStatus = { appSecret: boolean; verifyToken: boolean; pageToken: boolean; pageId: boolean; appId: boolean };

export function metaConfigStatus(env: NodeJS.ProcessEnv = process.env): MetaConfigStatus {
  return { appSecret: Boolean(env.META_APP_SECRET), verifyToken: Boolean(env.META_VERIFY_TOKEN), pageToken: Boolean(env.META_PAGE_ACCESS_TOKEN), pageId: Boolean(env.META_PAGE_ID), appId: Boolean(env.META_APP_ID) };
}

export type SubscriptionInfo = {
  pageName: string | null;
  instagram: { id: string; username: string | null } | null;
  apps: { id: string | null; name: string | null; fields: string[]; ours: boolean }[];
  missing: string[]; // pola z SUBSCRIBED_FIELDS, których nasza aplikacja nie ma (gdy znamy META_APP_ID)
  expected: readonly string[];
};

export function sanitizeGraphError(message: string): string {
  return message.replace(/[A-Za-z0-9_-]{40,}/g, "…").slice(0, 300);
}

type Rec = Record<string, unknown>;
async function graph(path: string, init: RequestInit = {}): Promise<Rec> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("Brak META_PAGE_ACCESS_TOKEN w konfiguracji serwera.");
  const res = await fetch(`${GRAPH}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => ({}))) as Rec;
  if (!res.ok) {
    const e = (json.error ?? {}) as Rec;
    throw new Error(sanitizeGraphError(typeof e.message === "string" ? e.message : `Meta zwróciła błąd ${res.status}.`));
  }
  return json;
}

export function summarizeSubscription(page: Rec, subs: Rec, ourAppId: string | undefined): SubscriptionInfo {
  const ig = (page.instagram_business_account ?? null) as Rec | null;
  const apps = (Array.isArray(subs.data) ? (subs.data as Rec[]) : []).map((a) => ({
    id: typeof a.id === "string" ? a.id : null,
    name: typeof a.name === "string" ? a.name : null,
    fields: Array.isArray(a.subscribed_fields) ? (a.subscribed_fields as unknown[]).filter((f): f is string => typeof f === "string") : [],
    ours: Boolean(ourAppId && a.id === ourAppId),
  }));
  const ours = apps.find((a) => a.ours);
  return {
    pageName: typeof page.name === "string" ? page.name : null,
    instagram: ig && typeof ig.id === "string" ? { id: ig.id, username: typeof ig.username === "string" ? ig.username : null } : null,
    apps,
    missing: ourAppId ? SUBSCRIBED_FIELDS.filter((f) => !(ours?.fields ?? []).includes(f)) : [],
    expected: SUBSCRIBED_FIELDS,
  };
}

function pageId(): string {
  const id = process.env.META_PAGE_ID;
  if (!id) throw new Error("Brak META_PAGE_ID w konfiguracji serwera.");
  return id;
}

export async function checkSubscription(): Promise<SubscriptionInfo> {
  const id = pageId();
  const [page, subs] = await Promise.all([graph(`/${encodeURIComponent(id)}?fields=name,instagram_business_account%7Bid,username%7D`), graph(`/${encodeURIComponent(id)}/subscribed_apps`)]);
  return summarizeSubscription(page, subs, process.env.META_APP_ID);
}

export async function renewSubscription(): Promise<SubscriptionInfo> {
  const id = pageId();
  await graph(`/${encodeURIComponent(id)}/subscribed_apps`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `subscribed_fields=${SUBSCRIBED_FIELDS.join(",")}` });
  return checkSubscription();
}
