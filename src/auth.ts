import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb, schema } from "@/db/client";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export const googleConfigured = () => !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/** Only this address may sign in. With it unset, nobody can. */
const allowedEmail = () => process.env.ALLOWED_EMAIL?.trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    Google({
      authorization: {
        // offline + consent so Google returns a refresh token we can use for background sync.
        params: { access_type: "offline", prompt: "consent", scope: `openid email profile ${CALENDAR_SCOPE}` },
      },
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      return !!email && profile?.email_verified === true && email === allowedEmail();
    },
    async jwt({ token, account, profile }) {
      if (account && profile?.email) {
        const db = await getDb();
        const values = {
          email: profile.email,
          accessToken: account.access_token ?? null,
          expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
        };
        await db
          .insert(schema.googleAccount)
          .values({ id: 1, ...values, refreshToken: account.refresh_token ?? null })
          .onConflictDoUpdate({
            target: schema.googleAccount.id,
            // Google only sends a refresh token on consent; keep the old one otherwise.
            set: account.refresh_token ? { ...values, refreshToken: account.refresh_token } : values,
          });
      }
      return token;
    },
  },
});
