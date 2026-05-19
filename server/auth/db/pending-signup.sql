-- Pending registrations (account is created only after email verification).
CREATE TABLE IF NOT EXISTS pending_signup (
    id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    link_token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_signup_username_idx ON pending_signup(username COLLATE NOCASE);
