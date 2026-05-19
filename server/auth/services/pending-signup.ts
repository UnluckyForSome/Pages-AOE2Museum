import { nanoid } from "nanoid";
import type { AuthEnv } from "../env";
import { createAuth } from "../auth";
import { PRODUCTION_SITE_URL } from "../../site";
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
const RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MS = 15 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

interface PendingRow {
  id: string;
  email: string;
  username: string;
  password_enc: string;
  otp_hash: string;
  link_token_hash: string | null;
  expires_at: number;
  otp_attempts: number;
  otp_locked_until: number | null;
  last_sent_at: number | null;
}

interface VerificationSecrets {
  otp: string;
  linkToken: string;
  otpHash: string;
  linkHash: string;
}

function nowMs(): number {
  return Date.now();
}

function isSqliteConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /SQLITE_CONSTRAINT|UNIQUE constraint failed/i.test(msg);
}

function signUpConflictMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/username/i.test(msg)) return "This username is already taken.";
  if (/email/i.test(msg)) return "An account with this email already exists.";
  return null;
}

function buildVerifyLinkUrl(env: AuthEnv, email: string, linkToken: string): string {
  const base = (env.PUBLIC_BASE_URL || PRODUCTION_SITE_URL).replace(/\/$/, "");
  const url = new URL("/", base);
  url.searchParams.set("museum-auth", "verify-link");
  url.searchParams.set("email", email);
  url.searchParams.set("token", linkToken);
  return url.toString();
}

function verificationEmailHtml(handle: string, otp: string, verifyUrl: string): string {
  return (
    `<p>Hi ${handle},</p>` +
    `<p>Thanks for joining AoE2 Museum. Verify your account using either option below:</p>` +
    `<p><strong>Option 1 — code:</strong> Enter this 6-digit code in the sign-up dialog:</p>` +
    `<p style="font-size:1.5rem;font-weight:bold;letter-spacing:0.2em">${otp}</p>` +
    `<p><strong>Option 2 — link:</strong> <a href="${verifyUrl}">Verify your email</a></p>` +
    `<p>Both expire in 10 minutes. If your code expired, sign up again with the same email to get a new one.</p>` +
    `<p>If you did not sign up, ignore this email.</p>`
  );
}

async function purgeExpiredPending(env: AuthEnv): Promise<void> {
  await env.DB.prepare(`DELETE FROM pending_signup WHERE expires_at <= ?`).bind(nowMs()).run();
}

async function sendPendingVerificationEmail(
  env: AuthEnv,
  email: string,
  username: string,
  secrets: VerificationSecrets,
): Promise<void> {
  const verifyUrl = buildVerifyLinkUrl(env, email, secrets.linkToken);
  await sendEmail(env, {
    to: email,
    subject: "Verify your AoE2 Museum account",
    html: verificationEmailHtml(username, secrets.otp, verifyUrl),
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

async function usernameInUse(
  env: AuthEnv,
  username: string,
  excludePendingId?: string,
): Promise<boolean> {
  const user = await env.DB.prepare(
    `SELECT id FROM "user" WHERE username = ? COLLATE NOCASE AND emailVerified = 1`,
  )
    .bind(username)
    .first<{ id: string }>();
  if (user?.id) return true;

  const t = nowMs();
  let sql = `SELECT id FROM pending_signup WHERE username = ? COLLATE NOCASE AND expires_at > ?`;
  const binds: (string | number)[] = [username, t];
  if (excludePendingId) {
    sql += ` AND id != ?`;
    binds.push(excludePendingId);
  }
  const pending = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ id: string }>();
  return Boolean(pending?.id);
}

async function getPendingByEmail(env: AuthEnv, email: string): Promise<PendingRow | null> {
  return env.DB.prepare(
    `SELECT id, email, username, password_enc, otp_hash, link_token_hash, expires_at,
            otp_attempts, otp_locked_until, last_sent_at
     FROM pending_signup WHERE email = ?`,
  )
    .bind(email)
    .first<PendingRow>();
}

async function createVerificationSecrets(env: AuthEnv): Promise<VerificationSecrets> {
  const otp = generateOtp();
  const linkToken = generateLinkToken();
  const otpHash = await hashToken(env.AUTH_SECRET, otp);
  const linkHash = await hashToken(env.AUTH_SECRET, linkToken);
  return { otp, linkToken, otpHash, linkHash };
}

async function insertPending(
  env: AuthEnv,
  row: {
    email: string;
    username: string;
    password: string;
  },
): Promise<VerificationSecrets> {
  const id = nanoid();
  const secrets = await createVerificationSecrets(env);
  const passwordEnc = await encryptPassword(env.AUTH_SECRET, row.password);
  const created = nowMs();
  const expiresAt = created + OTP_EXPIRY_MS;

  await env.DB.prepare(`DELETE FROM pending_signup WHERE email = ?`).bind(row.email).run();
  await deleteUnverifiedUser(env, row.email);

  await env.DB.prepare(
    `INSERT INTO pending_signup (
       id, email, username, password_enc, otp_hash, link_token_hash,
       expires_at, created_at, otp_attempts, otp_locked_until, last_sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
  )
    .bind(
      id,
      row.email,
      row.username,
      passwordEnc,
      secrets.otpHash,
      secrets.linkHash,
      expiresAt,
      created,
      created,
    )
    .run();

  return secrets;
}

async function applyCredentialRotation(
  env: AuthEnv,
  pendingId: string,
  secrets: VerificationSecrets,
): Promise<boolean> {
  const expiresAt = nowMs() + OTP_EXPIRY_MS;
  const sentAt = nowMs();
  const result = await env.DB.prepare(
    `UPDATE pending_signup SET
       otp_hash = ?, link_token_hash = ?, expires_at = ?,
       otp_attempts = 0, otp_locked_until = NULL, last_sent_at = ?
     WHERE id = ? AND expires_at > ?`,
  )
    .bind(secrets.otpHash, secrets.linkHash, expiresAt, sentAt, pendingId, nowMs())
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function recordFailedOtpAttempt(env: AuthEnv, pending: PendingRow): Promise<void> {
  const attempts = (pending.otp_attempts ?? 0) + 1;
  const lockedUntil = attempts >= OTP_MAX_ATTEMPTS ? nowMs() + OTP_LOCK_MS : null;
  await env.DB.prepare(
    `UPDATE pending_signup SET otp_attempts = ?, otp_locked_until = ? WHERE id = ?`,
  )
    .bind(attempts, lockedUntil, pending.id)
    .run();
}

function isOtpLocked(pending: PendingRow): boolean {
  return Boolean(pending.otp_locked_until && pending.otp_locked_until > nowMs());
}

async function claimPendingByOtpHash(env: AuthEnv, pending: PendingRow): Promise<boolean> {
  const result = await env.DB.prepare(
    `DELETE FROM pending_signup WHERE id = ? AND expires_at > ? AND otp_hash = ?`,
  )
    .bind(pending.id, nowMs(), pending.otp_hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function claimPendingByLinkHash(env: AuthEnv, pending: PendingRow): Promise<boolean> {
  if (!pending.link_token_hash) return false;
  const result = await env.DB.prepare(
    `DELETE FROM pending_signup WHERE id = ? AND expires_at > ? AND link_token_hash = ?`,
  )
    .bind(pending.id, nowMs(), pending.link_token_hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function finalizeSignup(
  env: AuthEnv,
  pending: PendingRow,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (nowMs() > pending.expires_at) {
    return { ok: false, error: "Verification expired. Sign up again.", status: 400 };
  }

  if (await emailInUse(env, pending.email)) {
    return { ok: false, error: "An account with this email already exists.", status: 409 };
  }

  if (await usernameInUse(env, pending.username)) {
    return {
      ok: false,
      error: "This username was just taken. Choose another and sign up again.",
      status: 409,
    };
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
    const conflict = signUpConflictMessage(err);
    if (conflict) {
      return { ok: false, error: conflict, status: 409 };
    }
    return { ok: false, error: "Could not create account. Try again.", status: 500 };
  }

  await env.DB.prepare(`UPDATE "user" SET emailVerified = 1 WHERE email = ?`)
    .bind(pending.email)
    .run();

  return { ok: true };
}

export async function registerPendingSignup(
  env: AuthEnv,
  body: { email: string; username: string; password: string },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  await purgeExpiredPending(env);

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

  let secrets: VerificationSecrets;
  try {
    secrets = await insertPending(env, { email, username, password });
  } catch (err) {
    if (isSqliteConstraintError(err)) {
      return { ok: false, error: "This username or email is already taken.", status: 409 };
    }
    throw err;
  }

  try {
    await sendPendingVerificationEmail(env, email, username, secrets);
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
  await purgeExpiredPending(env);

  const email = emailInput.trim().toLowerCase();
  const pending = await getPendingByEmail(env, email);
  if (!pending) {
    return { ok: true };
  }
  if (nowMs() > pending.expires_at) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return {
      ok: false,
      error: "Verification expired. Sign up again to get a new code (same email is fine).",
      status: 400,
    };
  }

  if (
    pending.last_sent_at &&
    nowMs() - pending.last_sent_at < RESEND_COOLDOWN_MS
  ) {
    return {
      ok: false,
      error: "Please wait a minute before requesting another code.",
      status: 429,
    };
  }

  const secrets = await createVerificationSecrets(env);
  try {
    await sendPendingVerificationEmail(env, email, pending.username, secrets);
  } catch (err) {
    console.error("[pending-signup] resend email failed:", err);
    return { ok: false, error: "Could not send verification email.", status: 503 };
  }

  const updated = await applyCredentialRotation(env, pending.id, secrets);
  if (!updated) {
    return {
      ok: false,
      error: "Verification expired. Sign up again to get a new code (same email is fine).",
      status: 400,
    };
  }

  return { ok: true };
}

export async function completePendingWithOtp(
  env: AuthEnv,
  emailInput: string,
  otp: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  await purgeExpiredPending(env);

  const email = emailInput.trim().toLowerCase();
  const code = otp.trim();
  const pending = await getPendingByEmail(env, email);
  if (!pending) {
    return { ok: false, error: "No pending sign-up for this email.", status: 400 };
  }
  if (nowMs() > pending.expires_at) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return {
      ok: false,
      error: "Verification expired. Sign up again to get a new code (same email is fine).",
      status: 400,
    };
  }
  if (isOtpLocked(pending)) {
    return {
      ok: false,
      error: "Too many attempts. Try again later or use the link in your email.",
      status: 429,
    };
  }
  if (!(await verifyTokenHash(env.AUTH_SECRET, code, pending.otp_hash))) {
    await recordFailedOtpAttempt(env, pending);
    return { ok: false, error: "Invalid verification code.", status: 400 };
  }

  if (!(await claimPendingByOtpHash(env, pending))) {
    return {
      ok: false,
      error: "Verification expired or already used. Sign up again.",
      status: 400,
    };
  }

  return finalizeSignup(env, pending);
}

export async function completePendingWithLink(
  env: AuthEnv,
  emailInput: string,
  linkToken: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  await purgeExpiredPending(env);

  const email = emailInput.trim().toLowerCase();
  const token = linkToken.trim();
  if (!email || !token) {
    return { ok: false, error: "Invalid verification link.", status: 400 };
  }

  const pending = await getPendingByEmail(env, email);
  if (!pending) {
    return { ok: false, error: "No pending sign-up for this email.", status: 400 };
  }
  if (nowMs() > pending.expires_at) {
    await env.DB.prepare(`DELETE FROM pending_signup WHERE id = ?`).bind(pending.id).run();
    return {
      ok: false,
      error: "Verification expired. Sign up again to get a new code (same email is fine).",
      status: 400,
    };
  }
  if (!pending.link_token_hash) {
    return { ok: false, error: "Invalid verification link.", status: 400 };
  }
  if (!(await verifyTokenHash(env.AUTH_SECRET, token, pending.link_token_hash))) {
    return { ok: false, error: "Invalid verification link.", status: 400 };
  }

  if (!(await claimPendingByLinkHash(env, pending))) {
    return {
      ok: false,
      error: "Verification expired or already used. Sign up again.",
      status: 400,
    };
  }

  return finalizeSignup(env, pending);
}
