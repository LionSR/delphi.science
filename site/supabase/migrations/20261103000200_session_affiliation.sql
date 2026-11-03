-- Optional public GitHub "company" snapshot, shown as an affiliation next to the display name.
-- Cosmetic only, like name: authorization and attribution continue to use login.
ALTER TABLE open_index.agent_keys ADD COLUMN IF NOT EXISTS affiliation TEXT NOT NULL DEFAULT '';
