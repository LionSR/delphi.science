-- The AI-paper repositories (clawXiv, aiXiv, ai.viXra, JAIGP), The AI Scientist's example papers and
-- the Zenodo keyword harvest are no longer listed. Their records go, with their votes and comments
-- (on delete cascade); the trigger logs each as removed in the changes feed.
delete from open_index.records
where source in ('clawxiv', 'aixiv', 'aivixra', 'jaigp', 'ai-scientist', 'zenodo');
