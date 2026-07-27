"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applySmsPlaceholders } from "@/lib/sms-template";

type ContactSummary = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type RentalSummary = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  contactNameCache: string | null;
  contactPhoneCache: string | null;
  device: { id: string; name: string };
};

type Template = { id: string; label: string; body: string };

type ContextMode = "contact" | "rental";

function formatRange(startsAt: string, endsAt: string): string {
  const fmt = (v: string) => new Date(v).toLocaleDateString("pl-PL");
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

export function SmsSendPanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<ContextMode>("contact");

  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactSummary[] | null>(null);
  const [isSearchingContact, setIsSearchingContact] = useState(false);
  const [contactSearchError, setContactSearchError] = useState<string | null>(null);
  const [pickedContact, setPickedContact] = useState<ContactSummary | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rentalQuery, setRentalQuery] = useState("");
  const [rentalResults, setRentalResults] = useState<RentalSummary[] | null>(null);
  const [isSearchingRental, setIsSearchingRental] = useState(false);
  const [rentalSearchError, setRentalSearchError] = useState<string | null>(null);
  const [pickedRental, setPickedRental] = useState<RentalSummary | null>(null);
  const rentalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phone, setPhone] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    if (contactQuery.trim().length < 3) return;

    const controller = new AbortController();
    contactDebounceRef.current = setTimeout(async () => {
      setIsSearchingContact(true);
      setContactSearchError(null);
      try {
        const res = await fetch(
          `/wynajem/api/integrations/hubspot/contacts/search?q=${encodeURIComponent(contactQuery.trim())}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setContactSearchError(data?.message || "Wyszukiwanie kontaktów nie powiodło się.");
          setContactResults(null);
        } else {
          setContactResults(data?.contacts ?? []);
        }
      } catch {
        // Aborted by a newer keystroke — ignore.
      } finally {
        setIsSearchingContact(false);
      }
    }, 300);

    return () => {
      controller.abort();
      if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    };
  }, [contactQuery]);

  useEffect(() => {
    if (rentalDebounceRef.current) clearTimeout(rentalDebounceRef.current);
    if (rentalQuery.trim().length < 2) return;

    const controller = new AbortController();
    rentalDebounceRef.current = setTimeout(async () => {
      setIsSearchingRental(true);
      setRentalSearchError(null);
      try {
        const res = await fetch(`/wynajem/api/rentals/search?q=${encodeURIComponent(rentalQuery.trim())}`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setRentalSearchError(data?.message || "Wyszukiwanie wynajmów nie powiodło się.");
          setRentalResults(null);
        } else {
          setRentalResults(data?.rentals ?? []);
        }
      } catch {
        // Aborted by a newer keystroke — ignore.
      } finally {
        setIsSearchingRental(false);
      }
    }, 300);

    return () => {
      controller.abort();
      if (rentalDebounceRef.current) clearTimeout(rentalDebounceRef.current);
    };
  }, [rentalQuery]);

  function pickContact(c: ContactSummary) {
    setPickedContact(c);
    setPickedRental(null);
    setPhone(c.phone ?? "");
    setContactQuery("");
    setContactResults(null);
  }

  function clearContact() {
    setPickedContact(null);
    setPhone("");
  }

  function pickRental(r: RentalSummary) {
    setPickedRental(r);
    setPickedContact(null);
    setPhone(r.contactPhoneCache ?? "");
    setRentalQuery("");
    setRentalResults(null);
  }

  function clearRental() {
    setPickedRental(null);
    setPhone("");
  }

  function switchMode(next: ContextMode) {
    setMode(next);
    clearContact();
    clearRental();
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    const clientName = pickedRental
      ? pickedRental.contactNameCache
      : pickedContact
        ? [pickedContact.firstname, pickedContact.lastname].filter(Boolean).join(" ")
        : null;
    const substituted = applySmsPlaceholders(template.body, {
      clientName,
      deviceName: pickedRental?.device.name,
      startsAt: pickedRental?.startsAt,
      endsAt: pickedRental?.endsAt,
    });
    setMessage(substituted);
  }

  async function handleSend() {
    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      const res = await fetch("/wynajem/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message, rentalId: pickedRental?.id ?? null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSendError(data?.message || "Nie udało się wysłać wiadomości.");
        return;
      }
      setSendSuccess(true);
      setMessage("");
      setTemplateId("");
      clearContact();
      clearRental();
      router.refresh();
    } finally {
      setIsSending(false);
    }
  }

  const canSend = phone.trim().length > 0 && message.trim().length > 0 && !isSending;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Wyślij SMS</h2>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-sm text-gray-700">
          <div className="flex items-center justify-between">
            <span>Kontekst (opcjonalnie)</span>
            <div className="flex rounded-md border border-gray-300 text-xs">
              <button
                type="button"
                onClick={() => switchMode("contact")}
                className={`rounded-l-md px-2 py-1 font-medium ${
                  mode === "contact" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Kontakt
              </button>
              <button
                type="button"
                onClick={() => switchMode("rental")}
                className={`rounded-r-md px-2 py-1 font-medium ${
                  mode === "rental" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Wynajem
              </button>
            </div>
          </div>

          {mode === "contact" ? (
            pickedContact ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="text-sm text-gray-800">
                  <span className="font-medium">
                    {[pickedContact.firstname, pickedContact.lastname].filter(Boolean).join(" ") || "(bez nazwy)"}
                  </span>
                  {pickedContact.company && <span className="text-gray-500"> · {pickedContact.company}</span>}
                </span>
                <button
                  type="button"
                  onClick={clearContact}
                  className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Odepnij
                </button>
              </div>
            ) : (
              <div>
                <input
                  value={contactQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContactQuery(value);
                    if (value.trim().length < 3) {
                      setContactResults(null);
                      setContactSearchError(null);
                    }
                  }}
                  placeholder="Szukaj kontaktu w HubSpot (min. 3 znaki)…"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
                {isSearchingContact && <p className="mt-1 text-xs text-gray-400">Szukanie…</p>}
                {contactSearchError && <p className="mt-1 text-xs text-red-700">{contactSearchError}</p>}
                {contactResults && contactResults.length === 0 && !isSearchingContact && (
                  <p className="mt-1 text-xs text-gray-400">Brak wyników.</p>
                )}
                {contactResults && contactResults.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
                    {contactResults.map((c) => {
                      const name = [c.firstname, c.lastname].filter(Boolean).join(" ") || "(bez nazwy)";
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => pickContact(c)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          >
                            <span className="font-medium text-gray-900">{name}</span>
                            {c.company && <span className="text-gray-500"> · {c.company}</span>}
                            {c.phone && <span className="block text-xs text-gray-500">{c.phone}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )
          ) : pickedRental ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="text-sm text-gray-800">
                <span className="font-medium">{pickedRental.title}</span>
                <span className="text-gray-500">
                  {" "}
                  · {pickedRental.device.name} · {formatRange(pickedRental.startsAt, pickedRental.endsAt)}
                </span>
              </span>
              <button
                type="button"
                onClick={clearRental}
                className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Odepnij
              </button>
            </div>
          ) : (
            <div>
              <input
                value={rentalQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setRentalQuery(value);
                  if (value.trim().length < 2) {
                    setRentalResults(null);
                    setRentalSearchError(null);
                  }
                }}
                placeholder="Szukaj wynajmu po tytule, urządzeniu lub kliencie (min. 2 znaki)…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
              {isSearchingRental && <p className="mt-1 text-xs text-gray-400">Szukanie…</p>}
              {rentalSearchError && <p className="mt-1 text-xs text-red-700">{rentalSearchError}</p>}
              {rentalResults && rentalResults.length === 0 && !isSearchingRental && (
                <p className="mt-1 text-xs text-gray-400">Brak wyników.</p>
              )}
              {rentalResults && rentalResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
                  {rentalResults.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => pickRental(r)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{r.title}</span>
                        <span className="text-gray-500"> · {r.device.name}</span>
                        <span className="block text-xs text-gray-500">
                          {formatRange(r.startsAt, r.endsAt)}
                          {r.contactNameCache ? ` · ${r.contactNameCache}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Numer telefonu <span className="text-red-600">*</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="np. 500 100 200"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Wstaw gotowy szablon (opcjonalnie)
          <select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          >
            <option value="">— wpisz treść ręcznie —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Treść wiadomości
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>

        {sendError && <p className="text-sm text-red-700">{sendError}</p>}
        {sendSuccess && <p className="text-sm text-green-700">Wysłano.</p>}

        <div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isSending ? "Wysyłanie…" : "Wyślij SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}
