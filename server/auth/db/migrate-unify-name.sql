-- Unify legacy rows: one public name in username (and mirrored to name for better-auth).
-- Safe to re-run.

UPDATE "user"
SET name = username,
    displayUsername = username
WHERE username IS NOT NULL
  AND TRIM(username) != ''
  AND (name IS NULL OR TRIM(name) = '' OR name != username);

UPDATE "user"
SET username = TRIM(name),
    displayUsername = TRIM(name)
WHERE (username IS NULL OR TRIM(username) = '')
  AND name IS NOT NULL
  AND TRIM(name) != '';
