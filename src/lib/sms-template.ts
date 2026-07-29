export const SUPPORT_PHONE = "531574115";

export type SmsPlaceholderContext = {
  clientName?: string | null;
  deviceName?: string | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
};

// Best-effort substitution for manually composed SMS: a placeholder is only
// replaced when the matching context is actually available, so missing data
// stays visible as literal {token} text for the sender to notice and fill in
// by hand rather than silently going blank.
//
// Tokens that depend on a specific rental's context carry a "rezerwacja_"
// prefix so it's visually obvious, when writing or picking a template, which
// ones need that context to resolve (as opposed to e.g. {telefon_obslugi},
// a static value that works regardless of context).
export function applySmsPlaceholders(body: string, ctx: SmsPlaceholderContext = {}): string {
  let result = body;
  if (ctx.clientName) result = result.replaceAll("{rezerwacja_klient}", ctx.clientName);
  if (ctx.deviceName) result = result.replaceAll("{rezerwacja_urzadzenie}", ctx.deviceName);
  if (ctx.startsAt) result = result.replaceAll("{rezerwacja_data_start}", new Date(ctx.startsAt).toLocaleDateString("pl-PL"));
  if (ctx.endsAt) result = result.replaceAll("{rezerwacja_data_koniec}", new Date(ctx.endsAt).toLocaleDateString("pl-PL"));
  return result.replaceAll("{telefon_obslugi}", SUPPORT_PHONE);
}
