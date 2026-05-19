import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "../env";
import {
  encryptPassword,
  generateOtp,
  hashToken,
} from "./pending-signup-crypto";
import {
  completePendingWithLink,
  completePendingWithOtp,
  registerPendingSignup,
} from "./pending-signup";

const SECRET = "museum-test-auth-secret-32chars!!";

type PendingRow = {
  id: string;
  email: string;
  username: string;
  password_enc: string;
  otp_hash: string;
  link_token_hash: string | null;
  expires_at: number;
  created_at: number;
  otp_attempts: number;
  otp_locked_until: number | null;
  last_sent_at: number | null;
};

type UserRow = {
  id: string;
  email: string;
  username: string;
  emailVerified: number;
};

function createMockEnv() {
  const pending: PendingRow[] = [];
  const users: UserRow[] = [];
  let idSeq = 0;

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const now = Date.now();
              if (sql.includes('FROM "user"') && sql.includes("email = ?") && sql.includes("emailVerified = 1")) {
                const email = args[0] as string;
                const row = users.find((u) => u.email === email && u.emailVerified === 1);
                return (row ? { id: row.id } : null) as T;
              }
              if (sql.includes('FROM "user"') && sql.includes("emailVerified = 0")) {
                const email = args[0] as string;
                const row = users.find((u) => u.email === email && u.emailVerified === 0);
                return (row ? { id: row.id } : null) as T;
              }
              if (sql.includes('FROM "user"') && sql.includes("username = ?")) {
                const username = args[0] as string;
                const row = users.find(
                  (u) => u.username.toLowerCase() === String(username).toLowerCase() && u.emailVerified === 1,
                );
                return (row ? { id: row.id } : null) as T;
              }
              if (sql.includes("FROM pending_signup WHERE email = ?") && sql.includes("otp_hash")) {
                const email = args[0] as string;
                const row = pending.find((p) => p.email === email);
                return (row ?? null) as T;
              }
              if (sql.includes("FROM pending_signup WHERE username = ?") && sql.includes("expires_at > ?")) {
                const username = args[0] as string;
                const t = args[1] as number;
                const excludeId = args[2] as string | undefined;
                const row = pending.find(
                  (p) =>
                    p.username.toLowerCase() === String(username).toLowerCase() &&
                    p.expires_at > t &&
                    p.id !== excludeId,
                );
                return (row ? { id: row.id } : null) as T;
              }
              if (sql.includes("FROM pending_signup WHERE email = ?")) {
                const email = args[0] as string;
                const row = pending.find((p) => p.email === email);
                return (row ?? null) as T;
              }
              return null;
            },
            async run() {
              const now = Date.now();
              if (sql.includes("DELETE FROM pending_signup WHERE expires_at <= ?")) {
                const t = args[0] as number;
                const before = pending.length;
                for (let i = pending.length - 1; i >= 0; i--) {
                  if (pending[i].expires_at <= t) pending.splice(i, 1);
                }
                return { meta: { changes: before - pending.length } };
              }
              if (sql.includes("DELETE FROM pending_signup WHERE email = ?")) {
                const email = args[0] as string;
                const idx = pending.findIndex((p) => p.email === email);
                if (idx >= 0) pending.splice(idx, 1);
                return { meta: { changes: idx >= 0 ? 1 : 0 } };
              }
              if (sql.includes("DELETE FROM pending_signup WHERE id = ?") && sql.includes("otp_hash")) {
                const [id, t, otpHash] = args as [string, number, string];
                const idx = pending.findIndex(
                  (p) => p.id === id && p.expires_at > t && p.otp_hash === otpHash,
                );
                if (idx >= 0) pending.splice(idx, 1);
                return { meta: { changes: idx >= 0 ? 1 : 0 } };
              }
              if (sql.includes("DELETE FROM pending_signup WHERE id = ?") && sql.includes("link_token_hash")) {
                const [id, t, linkHash] = args as [string, number, string];
                const idx = pending.findIndex(
                  (p) => p.id === id && p.expires_at > t && p.link_token_hash === linkHash,
                );
                if (idx >= 0) pending.splice(idx, 1);
                return { meta: { changes: idx >= 0 ? 1 : 0 } };
              }
              if (sql.includes("DELETE FROM pending_signup WHERE id = ?")) {
                const id = args[0] as string;
                const idx = pending.findIndex((p) => p.id === id);
                if (idx >= 0) pending.splice(idx, 1);
                return { meta: { changes: idx >= 0 ? 1 : 0 } };
              }
              if (sql.includes('DELETE FROM "user" WHERE id = ?')) {
                const id = args[0] as string;
                const idx = users.findIndex((u) => u.id === id);
                if (idx >= 0) users.splice(idx, 1);
                return { meta: { changes: idx >= 0 ? 1 : 0 } };
              }
              if (sql.includes("INSERT INTO pending_signup")) {
                const [
                  id,
                  email,
                  username,
                  passwordEnc,
                  otpHash,
                  linkHash,
                  expiresAt,
                  createdAt,
                  lastSent,
                ] = args as [string, string, string, string, string, string, number, number, number];
                if (pending.some((p) => p.email === email || p.username.toLowerCase() === username.toLowerCase())) {
                  throw new Error("UNIQUE constraint failed: pending_signup.email");
                }
                pending.push({
                  id,
                  email,
                  username,
                  password_enc: passwordEnc,
                  otp_hash: otpHash,
                  link_token_hash: linkHash,
                  expires_at: expiresAt,
                  created_at: createdAt,
                  otp_attempts: 0,
                  otp_locked_until: null,
                  last_sent_at: lastSent,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE pending_signup SET")) {
                const [otpHash, linkHash, expiresAt, sentAt, id, t] = args as [
                  string,
                  string,
                  number,
                  number,
                  string,
                  number,
                ];
                const row = pending.find((p) => p.id === id && p.expires_at > t);
                if (!row) return { meta: { changes: 0 } };
                row.otp_hash = otpHash;
                row.link_token_hash = linkHash;
                row.expires_at = expiresAt;
                row.otp_attempts = 0;
                row.otp_locked_until = null;
                row.last_sent_at = sentAt;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE pending_signup SET otp_attempts")) {
                const [attempts, lockedUntil, id] = args as [number, number | null, string];
                const row = pending.find((p) => p.id === id);
                if (row) {
                  row.otp_attempts = attempts;
                  row.otp_locked_until = lockedUntil;
                }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes('UPDATE "user" SET emailVerified = 1')) {
                const email = args[0] as string;
                const row = users.find((u) => u.email === email);
                if (row) row.emailVerified = 1;
                return { meta: { changes: row ? 1 : 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  const signUpEmail = vi.fn(async ({ body }: { body: { email: string; username: string } }) => {
    if (users.some((u) => u.email === body.email)) {
      throw new Error("email already exists");
    }
    if (users.some((u) => u.username.toLowerCase() === body.username.toLowerCase())) {
      throw new Error("username already exists");
    }
    users.push({
      id: "user-" + ++idSeq,
      email: body.email,
      username: body.username,
      emailVerified: 0,
    });
  });

  const env = {
    AUTH_SECRET: SECRET,
    PUBLIC_BASE_URL: "https://aoe2museum.com",
    DB: db,
  } as unknown as AuthEnv;

  return { env, pending, users, signUpEmail };
}

vi.mock("../auth", () => ({
  createAuth: vi.fn(),
}));

vi.mock("./email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { createAuth } from "../auth";

describe("pending-signup service", () => {
  beforeEach(() => {
    vi.mocked(createAuth).mockReset();
  });

  it("releases expired username on register after purge", async () => {
    const { env, pending, signUpEmail } = createMockEnv();
    vi.mocked(createAuth).mockReturnValue({ api: { signUpEmail } } as never);

    const passwordEnc = await encryptPassword(SECRET, "password1");
    const otpHash = await hashToken(SECRET, "111111");
    pending.push({
      id: "old",
      email: "other@example.com",
      username: "taken_name",
      password_enc: passwordEnc,
      otp_hash: otpHash,
      link_token_hash: null,
      expires_at: Date.now() - 1000,
      created_at: Date.now() - 2000,
      otp_attempts: 0,
      otp_locked_until: null,
      last_sent_at: null,
    });

    const result = await registerPendingSignup(env, {
      email: "new@example.com",
      username: "taken_name",
      password: "password12",
    });
    expect(result.ok).toBe(true);
    expect(pending.some((p) => p.username === "taken_name" && p.email === "new@example.com")).toBe(true);
  });

  it("allows re-registering same email after expiry", async () => {
    const { env, pending, signUpEmail } = createMockEnv();
    vi.mocked(createAuth).mockReturnValue({ api: { signUpEmail } } as never);

    pending.push({
      id: "expired",
      email: "user@example.com",
      username: "player1",
      password_enc: await encryptPassword(SECRET, "password12"),
      otp_hash: await hashToken(SECRET, "111111"),
      link_token_hash: null,
      expires_at: Date.now() - 1000,
      created_at: Date.now() - 2000,
      otp_attempts: 0,
      otp_locked_until: null,
      last_sent_at: null,
    });

    const result = await registerPendingSignup(env, {
      email: "user@example.com",
      username: "player1",
      password: "password12",
    });
    expect(result.ok).toBe(true);
    expect(pending.length).toBe(1);
    expect(pending[0].expires_at).toBeGreaterThan(Date.now());
  });

  it("completes signup with OTP and rejects second use", async () => {
    const { env, pending, users, signUpEmail } = createMockEnv();
    vi.mocked(createAuth).mockReturnValue({ api: { signUpEmail } } as never);

    const otp = generateOtp();
    pending.push({
      id: "p1",
      email: "user@example.com",
      username: "player1",
      password_enc: await encryptPassword(SECRET, "password12"),
      otp_hash: await hashToken(SECRET, otp),
      link_token_hash: await hashToken(SECRET, "link-token-abc"),
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
      otp_attempts: 0,
      otp_locked_until: null,
      last_sent_at: Date.now(),
    });

    const ok = await completePendingWithOtp(env, "user@example.com", otp);
    expect(ok.ok).toBe(true);
    expect(users.some((u) => u.email === "user@example.com" && u.emailVerified === 1)).toBe(true);
    expect(pending.length).toBe(0);

    const again = await completePendingWithOtp(env, "user@example.com", otp);
    expect(again.ok).toBe(false);
  });

  it("verifies via link token once", async () => {
    const { env, pending, users, signUpEmail } = createMockEnv();
    vi.mocked(createAuth).mockReturnValue({ api: { signUpEmail } } as never);

    const linkToken = "link-token-xyz";
    pending.push({
      id: "p2",
      email: "link@example.com",
      username: "linkuser",
      password_enc: await encryptPassword(SECRET, "password12"),
      otp_hash: await hashToken(SECRET, "999999"),
      link_token_hash: await hashToken(SECRET, linkToken),
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
      otp_attempts: 0,
      otp_locked_until: null,
      last_sent_at: Date.now(),
    });

    const ok = await completePendingWithLink(env, "link@example.com", linkToken);
    expect(ok.ok).toBe(true);
    expect(users.some((u) => u.email === "link@example.com" && u.emailVerified === 1)).toBe(true);

    const again = await completePendingWithLink(env, "link@example.com", linkToken);
    expect(again.ok).toBe(false);
  });

  it("returns 409 when username was taken at verify time", async () => {
    const { env, pending, users, signUpEmail } = createMockEnv();
    vi.mocked(createAuth).mockReturnValue({ api: { signUpEmail } } as never);

    users.push({
      id: "verified",
      email: "other@example.com",
      username: "sniped",
      emailVerified: 1,
    });

    const otp = generateOtp();
    pending.push({
      id: "late",
      email: "late@example.com",
      username: "sniped",
      password_enc: await encryptPassword(SECRET, "password12"),
      otp_hash: await hashToken(SECRET, otp),
      link_token_hash: null,
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
      otp_attempts: 0,
      otp_locked_until: null,
      last_sent_at: Date.now(),
    });

    const result = await completePendingWithOtp(env, "late@example.com", otp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/username/i);
    }
    expect(pending.length).toBe(0);
  });
});
