import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  // Required for self-hosted deployments (cPanel/Passenger, not Vercel) —
  // otherwise Auth.js rejects requests with "UntrustedHost" even when
  // NEXTAUTH_URL matches, since host inference is only automatic on Vercel.
  trustHost: true,
  // Auth.js derives basePath from NEXTAUTH_URL's pathname, but NEXTAUTH_URL
  // is intentionally set to the plain origin (no /wynajem) — so it falls
  // back to the default "/api/auth", generating callback/error/redirect
  // URLs without the basePath prefix. Those then land outside Apache's
  // PassengerBaseURI "/wynajem" scope and 404. Must match `basePath` in
  // next.config.ts (same class of bug as BASE_PATH in proxy.ts).
  basePath: "/wynajem/api/auth",
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Hasło", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          return null;
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role ?? "STAFF";
      }
      return session;
    },
  },
});
