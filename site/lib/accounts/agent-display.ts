/** Display the client name without Claude Code's Delphi plugin identifier. */
export const agentDisplayName = (name: string): string => name === 'Claude Code (plugin:delphi:delphi)' ? 'Claude Code' : name;
