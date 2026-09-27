// Źródła rejestrowe / dokumentowe = dane potwierdzone (✓ zielone na karcie);
// wpis z panelu lub od agenta bez dowodu — neutralny.
const CONFIRMING = /^(ceidg|bialalista|biała lista|fakturownia|krs|gus|faktury)$/i;
export const isConfirmingSource = (s: string) => s.split(/\s*[·,+;]\s*/).some((p) => CONFIRMING.test(p.trim()));
