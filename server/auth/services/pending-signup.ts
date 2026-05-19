import { nanoid } from "nanoid";
import type { AuthEnv } from "../env";
import { createAuth } from "../auth";
import { sendEmail } from "./email";
import {
  decryptPassword,
  encryptPassword,
  generateLinkToken,
  generateOtp,
  hashToken,
  verifyTokenHash,
} from "./pending-signup-crypto";
import { MUSEUM_NAME_MAX, MUSEUM_NAME_MIN } from "./museum-name";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

interface PendingRow {
  id: string;
  email: string;
  username: string;
  password_enc: string;
  otp_hash: string;
  link_token_hash: string;
  expires_at: number;
}

function baseUrl(env: AuthEnv): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

function verificationEmailHtml(handle: string, otp: string, verifyUrl: string): string {
  return (
    `<p>Hi ${handle},</p>` +
    `<p>Thanks for joining AoE2 Museum. Use this verification code:</p>` +
    `<p style="font-size:1.5rem;font-weight:bold;letter-spacing:0.2em">${otp}</p>` +
    `<p>Or click the link below to verify your email:</p>` +
    `<p><a href="${verifyUrl}">Verify email</a></p>` +
    `<p>This code and link expire in 10 minutes. If you did not sign up, ignore this email.</p>`
  );
}

async function sendPendingVerificationEmail(
  env: AuthEnv,
  email: string,
  username: string,
  otp: string,
  linkToken: string,
): Promise<void> {
  const verifyUrl = `${baseUrl(env)}/api/auth/museum/verify?token=${encodeURIComponent(linkToken)}`;
  await sendEmail(env, {
    to: email,
    subject: "Verify your AoE2 Museum account",
    html: verificationEmailHtml(username, otp, verifyUrl),
  });
}

async function deleteUnverifiedUser(env: AuthEnv, email: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id FROM "user" WHERE email = ? AND emailVerified = 0`,
  )
    .bind(email)
    .first<{ id: string }>();
  if (!row?.id) return;
  await env.DB.prepare(`DELETE FROM "user" WHERE id = ?`).bind(row.id).run();
}

async function emailInUse(env: AuthEnv, email: string): Promise<boolean> {
  const user = await env.DB.prepare(
    `SELECT id FROM "user" WHERE email = ? AND emailVerified = 1`,
  )
    .bind(email)
    .first<{ id: string }>();
  return Boolean(user?.id);
}

async function usernameInUse(env: AuthEnv, username: string): Promise<boolean> {
  const user = await env.DB.prepare(
    `SELECT id FROM "user" WHERE username = ? COLLATE NOCASE AND emailVerified = 1`,
  )
    .bind(username)
    .first<{ id: string }>();
  if (user?.id) return true;
  const pending = await env.DB.prepare(
    `SELECT id FROM pending_signup WHERE username = ? COLLATE NOCASE`,
  )
    .bind(username)
    .first<{ id: string }>();
  return Boolean(pending?.id);
}

async function getPendingByEmail(env: AuthEnv, email: string): Promise<PendingRow | null> {
  return env.DB.prepare(`SELECT * FROM pending_signup WHERE email = ?`)
    .bind(email)
    .first<PendingRow>();
}

async function getPendingByLinkToken(env: AuthEnv, token: string): Promise<PendingRow | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const row = await env.DB.prepare(
    `SELECT * FROM pending_signup WHERE id = ? AND expires_at > ?`,
  )
    .bind(id, Date.now())
    .first<PendingRow>();
  if (!row) return null;
  if (!(await verifyTokenHash(env.AUTH_SECRET, secret, row.link_token_hash))) return null;
  return row;
}

async function insertPending(
  env: AuthEnv,
  row: {
    email: string;
    username: string;
    password: string;
  },
): Promise<{ otp: string; linkToken: string }> {
  const id = nanoid();
  const otp = generateOtp();
  const linkSecret = generateLinkToken();
  const linkToken = `${id}.${linkSecret}`;
  const otpHash = await hashToken(env.AUTH_SECRET, otp);
  const linkHash = await hashToken(env.AUTH_SECRET, linkSecret);
  const passwordEnc = await encryptPassword(env.AUTH_SECRET, row.password);
  const now = Date.now();

  await env.DB.prepare(`DELETE FROM pending_signup WHERE email = ?`).bind(row.email).run();
  await deleteUnverifiedUser(env, row.email);

  await env.DB.prepare(
    `INSERT INTO pending_signup (id, email, username, password_enc, otp_hash, link_token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      row.email,
      row.username,
      passwordEnc,
      otpHash,
      linkHash,
      now + OTP_EXPIRY_MS,
      now,
    )
    .run();

  return { otp, linkToken };
}

async function finalizeSignup(
  env: AuthEnv,
  pending: PendingRow,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (Date.now() > pending.expires_at) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return { ok: false, error: "Verification expired. Sign up again.", status: 400 };
  }

  if (await emailInUse(env, pending.email)) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return { ok: false, error: "An account with this email already exists.", status: 409 };
  }

  const password = await decryptPassword(env.AUTH_SECRET, pending.password_enc);
  const auth = createAuth(env);

  try {
    await auth.api.signUpEmail({
      body: {
        email: pending.email,
        password,
        name: pending.username,
        username: pending.username,
      },
    });
  } catch (err) {
    console.error("[pending-signup] signUpEmail failed:", err);
    return { ok: false, error: "Could not create account. Try again.", status: 500 };
  }

  await env.DB.prepare(`UPDATE "user" SET emailVerified = 1 WHERE email = ?`)
    .bind(pending.email)
    .run();
  await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();

  return { ok: true };
}

export async function registerPendingSignup(
  env: AuthEnv,
  body: { email: string; username: string; password: string },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = body.email.trim().toLowerCase();
  const username = body.username.trim();
  const password = body.password;

  if (!email || !username || !password) {
    return { ok: false, error: "Email, username, and password are required.", status: 400 };
  }
  if (username.length < MUSEUM_NAME_MIN || username.length > MUSEUM_NAME_MAX) {
    return { ok: false, error: "Username must be 3–20 characters.", status: 400 };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: "Username must use letters, numbers, or underscores only.",
      status: 400,
    };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters.", status: 400 };
  }
  if (await emailInUse(env, email)) {
    return { ok: false, error: "An account with this email already exists.", status: 409 };
  }
  if (await usernameInUse(env, username)) {
    return { ok: false, error: "This username is already taken.", status: 409 };
  }

  const { otp, linkToken } = await insertPending(env, { email, username, password });
  try {
    await sendPendingVerificationEmail(env, email, username, otp, linkToken);
  } catch (err) {
    console.error("[pending-signup] send email failed:", err);
    await env.DB.prepare(`DELETE FROM pending_signup WHERE email = ?`).bind(email).run();
    return { ok: false, error: "Could not send verification email.", status: 503 };
  }

  return { ok: true };
}

export async function resendPendingVerification(
  env: AuthEnv,
  emailInput: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = emailInput.trim().toLowerCase();
  const pending = await getPendingByEmail(env, email);
  if (!pending) {
    return { ok: true };
  }
  if (Date.now() > pending.expires_at) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return {
      ok: false,
      error: "Verification expired. Please sign up again.",
      status: 400,
    };
  }

  const password = await decryptPassword(env.AUTH_SECRET, pending.password_enc);
  const { otp, linkToken } = await insertPending(env, {
    email: pending.email,
    username: pending.username,
    password,
  });

  try {
    await sendPendingVerificationEmail(env, email, pending.username, otp, linkToken);
  } catch (err) {
    console.error("[pending-signup] resend email failed:", err);
    return { ok: false, error: "Could not send verification email.", status: 503 };
  }

  return { ok: true };
}

export async function completePendingWithOtp(
  env: AuthEnv,
  emailInput: string,
  otp: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = emailInput.trim().toLowerCase();
  const code = otp.trim();
  const pending = await getPendingByEmail(env, email);
  if (!pending) {
    return { ok: false, error: "No pending sign-up for this email.", status: 400 };
  }
  if (!(await verifyTokenHash(env.AUTH_SECRET, code, pending.otp_hash))) {
    return { ok: false, error: "Invalid verification code.", status: 400 };
  }
  return finalizeSignup(env, pending);
}

export async function completePendingWithLinkToken(
  env: AuthEnv,
  token: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const pending = await getPendingByLinkToken(env, token.trim());
  if (!pending) {
    return { ok: false, error: "Invalid or expired verification link.", status: 400 };
  }
  return finalizeSignup(env, pending);
}
