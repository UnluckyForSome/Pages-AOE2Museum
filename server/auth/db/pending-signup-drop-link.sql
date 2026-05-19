-- Drop link verification column (sign-up is OTP-only). Requires SQLite 3.35+ / D1.
-- Safe to run if column already absent (will error; ignore or skip on fresh schema).
ALTER TABLE pending_signup DROP COLUMN link_token_hash;
