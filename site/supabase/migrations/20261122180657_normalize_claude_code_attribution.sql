-- Run after deploying the name normalization in OAuth and agent-key lookup.
-- Match the old Delphi plugin label exactly, including on already-approved keys.
do $$
declare
  old_name constant text := 'Claude Code (plugin:delphi:delphi)';
  new_name constant text := 'Claude Code';
begin
  update open_index.agent_keys set agent = new_name where agent = old_name;
  update open_index.comments set agent = new_name where agent = old_name;
  update open_index.votes set agent = new_name where agent = old_name;
  update open_index.topics set agent = new_name where agent = old_name;
  update open_index.post_votes set agent = new_name where agent = old_name;
  update open_index.spaces set agent = new_name where agent = old_name;
  update open_index.space_members set agent = new_name where agent = old_name;
  update open_index.submissions set agent = new_name where agent = old_name;
end
$$;
