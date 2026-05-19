import { describe, expect, it } from "vitest";
import {
  generateLinkToken,
  generateOtp,
  hashToken,
  verifyTokenHash,
} from "./pending-signup-crypto";

const SECRET = "test-secret-for-pending-signup";

describe("pending-signup-crypto", () => {
  it("generateOtp returns 6 digits", () => {
    expect(generateOtp()).toMatch(/^[0-9]{6}$/);
  });

  it("generateLinkToken returns distinct url-safe tokens", () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifyTokenHash accepts matching OTP and link tokens", async () => {
    const otp = "123456";
    const link = generateLinkToken();
    const otpHash = await hashToken(SECRET, otp);
    const linkHash = await hashToken(SECRET, link);
    expect(await verifyTokenHash(SECRET, otp, otpHash)).toBe(true);
    expect(await verifyTokenHash(SECRET, link, linkHash)).toBe(true);
    expect(await verifyTokenHash(SECRET, "000000", otpHash)).toBe(false);
  });
});
