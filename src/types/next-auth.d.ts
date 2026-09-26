import type { DefaultSession } from "next-auth";

type AppRole = "ADMIN" | "STAFF" | "KIEROWCA" | "AGENT";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      canActAsDriver: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: AppRole;
    canActAsDriver: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: AppRole;
    canActAsDriver?: boolean;
  }
}
