-- Restore the optional public GitHub display-name snapshot from PR22.
-- Cosmetic only: authorization and attribution continue to use login.
-- Existing sessions fall back to login; profile changes require a fresh sign-in.
ALTER TABLE open_index.agent_keys ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
