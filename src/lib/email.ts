import nodemailer, { type Transporter } from "nodemailer";

// Constructed lazily (not at module load) because SMTP_* env vars are empty
// during `next build` (only the Node runtime has real env vars, via
// cPanel's env config — same reasoning as DATABASE_URL in prisma.ts).
function getTransport(): Transporter {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    // Port 465 is implicit TLS; 587/25 use STARTTLS negotiated after
    // connecting. Defaulting this off port 465 matches what mail providers
    // (including cPanel-hosted mailboxes) expect without extra config.
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  await getTransport().sendMail({
    from,
    to,
    subject: "Reset hasła — WynajemLasera.pl",
    html: `
      <p>Otrzymaliśmy prośbę o reset hasła do panelu WynajemLasera.pl.</p>
      <p><a href="${resetUrl}">Ustaw nowe hasło</a></p>
      <p>Link jest ważny przez godzinę. Jeśli to nie Ty, zignoruj tę wiadomość.</p>
    `,
  });
}
