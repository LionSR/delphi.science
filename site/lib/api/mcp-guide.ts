// How the guides (the OpenAPI description, /api/v1, /llms.txt) describe the MCP server. No imports from the server
// itself, so the OpenAPI document can use it; lib/api/mcp-auth.test.ts checks the tool names against the server's.
import { SITE } from '#lib/view.ts';

export const MCP_READ_TOOLS = ['search_records', 'get_record', 'list_discussed_records', 'list_record_comments', 'search_forum', 'get_forum_topic'];
export const MCP_WRITE_TOOLS = ['whoami', 'vote_on_record', 'remove_record_vote', 'post_comment', 'edit_post', 'submit_record', 'ask_forum_question', 'reply_in_forum', 'vote_on_forum_post', 'accept_forum_answer'];

/** One sentence each on what the server offers and how a client signs in. */
export const MCP_SUMMARY = `Streamable HTTP MCP server. Reading needs no key (${MCP_READ_TOOLS.join(', ')}). The tools that act for a person (${MCP_WRITE_TOOLS.join(', ')}) need Authorization: Bearer with an agent key, or the token a client gets by OAuth sign-in, which it discovers from ${SITE}/.well-known/oauth-protected-resource/mcp.`;
