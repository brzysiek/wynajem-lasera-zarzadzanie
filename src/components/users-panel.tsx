"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function isPending(user: User) {
  return Boolean(user.invitedAt) && !user.activatedAt;
}

function InviteForm({
  onInvited,
  onCancel,
}: {
  onInvited: (warning?: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const { ok, data } = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ name, email, role }),
    });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zaprosić użytkownika.");
      return;
    }
    onInvited(
      data?.emailSent === false
        ? "Konto utworzone, ale nie udało się wysłać e-maila z zaproszeniem. Spróbuj wysłać je ponownie z listy."
        : undefined,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Imię
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Rola
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          >
            <option value="STAFF">Pracownik</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Wysyłanie…" : "Wyślij zaproszenie"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

function EditForm({
  user,
  isSelf,
  onSaved,
  onCancel,
}: {
  user: User;
  isSelf: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (changingPassword) {
      if (password.length < 8) {
        setError("Hasło musi mieć co najmniej 8 znaków.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Hasła nie są identyczne.");
        return;
      }
    }

    setIsSaving(true);
    const body: { name?: string; email?: string; password?: string; role?: "ADMIN" | "STAFF" } = {};
    if (name !== user.name) body.name = name;
    if (email !== user.email) body.email = email;
    if (!isSelf && role !== user.role) body.role = role;
    if (changingPassword) body.password = password;

    const { ok, data } = await api(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać zmian.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Imię
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Rola
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")}
            disabled={isSelf}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="STAFF">Pracownik</option>
            <option value="ADMIN">Administrator</option>
          </select>
          {isSelf && <span className="text-xs text-gray-400">Nie możesz zmienić własnej roli.</span>}
        </label>
      </div>

      <div className="mt-3">
        {changingPassword ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Nowe hasło
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Powtórz nowe hasło
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChangingPassword(true)}
            className="text-sm font-medium text-gray-700 hover:underline"
          >
            Zmień hasło
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: User;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDelete() {
    setIsDeleting(true);
    const { ok, data } = await api(`/api/users/${user.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (!ok) {
      setMessage(data?.message || "Nie udało się usunąć użytkownika.");
      return;
    }
    onChanged();
  }

  async function handleResendInvite() {
    setIsResending(true);
    setMessage(null);
    const { ok, data } = await api(`/api/users/${user.id}/invite`, { method: "POST" });
    setIsResending(false);
    setMessage(ok ? "Zaproszenie wysłane ponownie." : data?.message || "Nie udało się wysłać zaproszenia.");
  }

  if (isEditing) {
    return (
      <div className="py-3">
        <EditForm
          user={user}
          isSelf={isSelf}
          onSaved={() => {
            setIsEditing(false);
            onChanged();
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  const pending = isPending(user);

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium text-gray-900">
          {user.name}
          {isSelf && <span className="ml-2 text-xs text-gray-400">(Ty)</span>}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {user.role === "ADMIN" ? "Administrator" : "Pracownik"}
          </span>
          {pending && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              zaproszenie oczekujące
            </span>
          )}
        </p>
        <p className="text-xs text-gray-500">{user.email}</p>
      </div>

      <div className="min-w-[9rem] text-xs text-gray-500">
        {pending ? (
          <p>Zaproszono: {formatDateTime(user.invitedAt!)}</p>
        ) : (
          <p>Dołączył: {formatDateTime(user.createdAt)}</p>
        )}
        {message && <p className="text-gray-600">{message}</p>}
      </div>

      <div className="flex flex-none flex-wrap gap-2">
        {pending && (
          <button
            type="button"
            onClick={handleResendInvite}
            disabled={isResending}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isResending ? "Wysyłanie…" : "Wyślij zaproszenie ponownie"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Edytuj
        </button>
        {!isSelf &&
          (confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Na pewno?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? "Usuwanie…" : "Tak, usuń"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-sm text-gray-500 hover:underline"
              >
                Anuluj
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Usuń
            </button>
          ))}
      </div>
    </div>
  );
}

export function UsersPanel({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [isInviting, setIsInviting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();

  function reload() {
    router.refresh();
  }

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Użytkownicy ({users.length})</h2>
        {!isInviting && (
          <button
            type="button"
            onClick={() => {
              setWarning(null);
              setIsInviting(true);
            }}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Zaproś użytkownika
          </button>
        )}
      </div>

      {warning && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>
      )}

      {isInviting && (
        <div className="mb-4">
          <InviteForm
            onInvited={(warningMessage) => {
              setIsInviting(false);
              setWarning(warningMessage ?? null);
              reload();
            }}
            onCancel={() => setIsInviting(false)}
          />
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {users.map((user) => (
          <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} onChanged={reload} />
        ))}
        {users.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Brak użytkowników.</p>}
      </div>
    </div>
  );
}
