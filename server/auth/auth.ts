import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import type { AuthEnv } from "./env";
import { createKysely } from "./db";
import { sendEmail } from "./services/email";
import { cascadeDeleteUser } from "./services/cascade-delete";
import { getMuseumUsername, MUSEUM_NAME_MAX, MUSEUM_NAME_MIN } from "./services/museum-name";
import { PRODUCTION_SITE_ORIGINS } from "../site";

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
      sendResetPassword: async ({ user, url }) => {
        const handle = getMuseumUsername(user) ?? "there";
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your AoE2 Museum password",
          html:
            `<p>Hi ${handle},</p>` +
            `<p><a href="${url}">Reset your password</a></p>` +
            `<p>If you did not request this, you can ignore this email.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        const handle = getMuseumUsername(user) ?? "there";
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your AoE2 Museum account",
          html:
            `<p>Hi ${handle},</p>` +
            `<p>Thanks for joining AoE2 Museum. Click the button below to verify your email address:</p>` +
            `<p><a href="${url}">Verify email</a></p>` +
            `<p>If you did not create an account, you can ignore this message.</p>`,
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
    trustedOrigins: [
      ...new Set([baseUrl, ...PRODUCTION_SITE_ORIGINS, "http://localhost:8787", "http://127.0.0.1:8787"]),
    ],
  });
}
