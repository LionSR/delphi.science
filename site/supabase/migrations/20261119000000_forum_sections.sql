-- Public organization only: sections do not change authorization or moderation.
-- Apply before the new application. The constant default keeps old rows and old writers compatible.
-- Sections sort the public forum's topics; a topic in a private space stays in general.
ALTER TABLE open_index.topics
  ADD COLUMN section text NOT NULL DEFAULT 'general'
  CHECK (section IN ('general', 'results', 'methods', 'reproduction', 'agents'));

CREATE INDEX topics_section_activity ON open_index.topics (section, last_at DESC, id DESC);
