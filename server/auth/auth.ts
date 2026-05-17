import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import type { AuthEnv } from "./env";
import { createKysely } from "./db";
import { sendEmail } from "./services/email";
import { cascadeDeleteUser } from "./services/cascade-delete";
import { getMuseumUsername, MUSEUM_NAME_MAX, MUSEUM_NAME_MIN } from "./services/museum-name";

export function createAuth(env: AuthEnv) {
  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");

  return betterAuth({
    baseURL: baseUrl,
    secret: env.AUTH_SECRET,
    database: {
      db: createKysely(env.DB),
      type: "sqlite",
      transaction: false,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const handle = getMuseumUsername(user) ?? "there";
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your AoE2 Museum account",
          html: `<p>Hi ${handle},</p><p>Click to verify your email:</p><p><a href="${url}">${url}</a></p>`,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await cascadeDeleteUser(env, user.id);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const u = user as { username?: string; name?: string; displayUsername?: string };
            const handle = u.username?.trim();
            if (handle) {
              return {
                data: {
                  ...user,
                  name: handle,
                  displayUsername: handle,
                },
              };
            }
            return { data: user };
          },
        },
        update: {
          before: async (user) => {
            const u = user as { username?: string; name?: string; displayUsername?: string };
            if (u.username !== undefined) {
              const handle = u.username?.trim() ?? "";
              return {
                data: {
                  ...user,
                  name: handle,
                  displayUsername: handle,
                },
              };
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: MUSEUM_NAME_MIN,
        maxUsernameLength: MUSEUM_NAME_MAX,
        // Preserve casing for displayed uploader names and filename suffixes (e.g. Hunter2).
        usernameNormalization: false,
        displayUsernameNormalization: false,
      }),
    ],
    trustedOrigins: [baseUrl, "http://localhost:8787", "http://127.0.0.1:8787"],
  });
}
