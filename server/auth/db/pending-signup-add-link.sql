-- Restore link verification + OTP lockout / resend cooldown columns.
ALTER TABLE pending_signup ADD COLUMN link_token_hash TEXT;
ALTER TABLE pending_signup ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_signup ADD COLUMN otp_locked_until INTEGER;
ALTER TABLE pending_signup ADD COLUMN last_sent_at INTEGER;
