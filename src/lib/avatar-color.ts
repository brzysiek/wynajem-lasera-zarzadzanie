// Deterministyczny kolor awatara z id użytkownika — ta sama osoba ma zawsze
// ten sam kolor wszędzie w aplikacji, bez ręcznego przypisywania.
// Paleta świadomie bez czerwieni i żółci — te kolory kodują pilność (chip
// terminu w liście zadań), awatar koduje tożsamość osoby.
const AVATAR_PALETTE = ["#1A73E8", "#7C3AED", "#0D9488", "#EA580C", "#DB2777", "#4B5563"];

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function avatarInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
