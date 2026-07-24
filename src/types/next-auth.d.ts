import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "STAFF";
    } & DefaultSession["user"];
  }

  interface User {
    role: "ADMIN" | "STAFF";
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "ADMIN" | "STAFF";
  }
}
