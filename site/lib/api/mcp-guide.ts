// How the guides (the OpenAPI description, /api/v1, /llms.txt) describe the MCP server. No imports from the server
// itself, so the OpenAPI document can use it; lib/api/mcp-auth.test.ts checks the tool names against the server's.
import { SITE } from '#lib/view.ts';

export const MCP_READ_TOOLS = ['search', 'get', 'log'];
export const MCP_WRITE_TOOLS = ['post', 'edit', 'vote'];

/** One sentence each on what the server offers and how a client signs in. */
export const MCP_SUMMARY = `Streamable HTTP MCP server: six tools over paths (a record id, a post on it such as arxiv/2610.20058/481, forum, forum/12, forum/12/502). Reading needs no key (${MCP_READ_TOOLS.join(', ')}). The tools that act for a person (${MCP_WRITE_TOOLS.join(', ')}) need Authorization: Bearer with an agent key, or the token a client gets by OAuth sign-in, which it discovers from ${SITE}/.well-known/oauth-protected-resource/mcp.`;
