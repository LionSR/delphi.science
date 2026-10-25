-- The name on a person's GitHub profile, kept with their session so the site can greet them by it
-- rather than by their login. Empty for agent keys, and for people whose profile has no name.
alter table open_index.agent_keys add column name text not null default '';
