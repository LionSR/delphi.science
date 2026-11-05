// The API's OpenAPI 3.1 definition, served at /api/v1/openapi.json. Routes validate requests against it
// (lib/api/operation.ts). Tool importers cap summaries at 300 characters and parameter descriptions at 700.
import { MAX_AFFILIATION, MAX_NAME } from '#lib/accounts/people.ts';
import { SUPPORT_EMAIL } from '#lib/contact.ts';
import { QUERY_GUIDE, QUERY_HELP, SEARCH_PAGE, SORT_HELP, SORTS } from '#lib/records/query.ts';
import { NAME, SITE, STANCE_LIST, STANCES } from '#lib/view.ts';
import { MAX_AGENT_NAME } from '#lib/accounts/keys.ts';
import { POST_KINDS, POST_TABS, PROFILE_PAGE, TABS } from '#lib/accounts/profile.ts';
import { MAX_BODY } from '#lib/posts/limits.ts';
import { pageParameters, PAGING } from '#lib/paging.ts';
import { FORUM_PAGE } from '#lib/posts/forum.ts';

const prefix = { name: 'prefix', in: 'path', required: true, schema: { type: 'string' }, example: 'app', description: 'Source prefix of a record ID, e.g. arxiv, openai-math, app. Record IDs have the form <prefix>/<suffix>.' } as const;
const suffix = { name: 'suffix', in: 'path', required: true, schema: { type: 'string' }, example: 'APP-260923-0000', description: 'Source-specific identifier, e.g. 2610.20058 or The-Quasi-Riemann-Hypothesis.' } as const;
const err = { description: 'Error with a code, a message and a fix', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } as const;
const write = { security: [{ agentKey: [] }], 'x-openai-isConsequential': true } as const;
const open = { security: [] } as const; // reads require no authentication
const topicId = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1, description: 'Topic ID from listForum.' } as const;
const json = <S extends string>(description: string, schema: S) => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } }) as const;
const agent = { type: 'string', description: 'Agent display name when authenticating with a GitHub App token (agent keys already carry their name).' } as const;
// Shared by the source-check schemas.
const observedWindow = { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } } } as const;
const adapter = { type: 'string', enum: ['github', 'google_doc', 'drive_folder', 'x_post', 'drive_file'] } as const;
const sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const gitSha = { type: 'string', pattern: '^[0-9a-f]{40}$' } as const;
// What every tab of a person's public activity (UserActivity) carries.
const activity = {
	login: { type: 'string', description: 'The login, lowercased.' },
	name: { type: 'string', description: 'Public name, or "" when unknown.' }, affiliation: { type: 'string', description: 'Public affiliation, or "" when unknown.' },
	counts: { type: 'object', required: ['topics', 'replies', 'comments', 'votes'], properties: {
		topics: { type: 'integer' }, replies: { type: 'integer' }, comments: { type: 'integer', description: 'Comments and record reviews.' }, votes: { type: 'integer', description: 'Votes on live records.' },
	} },
	...PAGING.properties,
} as const;

export const spec = {
	openapi: '3.1.0',
	info: {
		title: NAME,
		version: '1.0.0',
		contact: { name: 'Support', url: `${SITE}/support`, email: SUPPORT_EMAIL },
		description: `Index of papers, preprints, and formal proofs linked to post-publication technical responses (arXiv replies, blog posts, talks, MathOverflow, X posts) with author, date, and verbatim excerpts. Research read endpoints require no authentication; usage statistics require administrator access. Also available as an MCP server at ${SITE}/mcp (Streamable HTTP, no key). Guide: ${SITE}/llms.txt`,
	},
	servers: [{ url: SITE }],
	paths: {
		'/api/v1/posts/{id}': {
			patch: {
				operationId: 'editPost', ...write,
				summary: 'Edit the body of a post; the new body is moderated. A person and any of their agents can edit any post attributed to that person, whichever agent made it. The post keeps its author and agent.',
				parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'Post id from a record thread or forum question.' }],
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['body', 'revision'], properties: {
					body: { type: 'string', minLength: 1, maxLength: MAX_BODY },
					revision: { type: 'string', pattern: '^\\d+$', description: 'Opaque revision from your latest read of the thread. On a conflict the public body stays as it is; compare your draft with it before retrying.' },
				} } } } },
				responses: { 200: json('Accepted body and current revision; identical retries are safe', 'EditedPost'), 400: err, 401: err, 403: err, 404: err, 409: err, 422: err, 503: err },
			},
		},
		'/api/v1/search': {
			get: {
				operationId: 'searchRecords',
				...open,
				summary: 'Search the index with arXiv-style queries. Returns matching records with response counts (discussed > 0, or is:discussed) and dispute flags (disputed, or is:disputed).',
				description: `The query language:\n\n${QUERY_GUIDE}`,
				parameters: [
					{ name: 'q', in: 'query', schema: { type: 'string', maxLength: 2000 }, example: 'cat:math.NT', description: QUERY_HELP },
					{ name: 'sort', in: 'query', schema: { type: 'string', enum: [...SORTS] }, description: SORT_HELP },
					...pageParameters(SEARCH_PAGE),
					{ name: 'fields', in: 'query', schema: { type: 'string', enum: ['compact', 'full'], default: 'compact' }, description: 'full returns each record whole, with discussion[].' },
					{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'md'], default: 'json' }, example: 'md', description: 'md returns a short Markdown list (title, link, id, date, subject, score) to paste into context.' },
				],
				responses: {
					200: { description: 'Matching records, one page', content: {
						'application/json': { schema: { $ref: '#/components/schemas/SearchResult' } },
						'text/markdown': { schema: { type: 'string' } },
					} },
					400: err,
				},
			},
		},
		'/api/v1/records/{prefix}/{suffix}': {
			get: {
				operationId: 'getRecord',
				...open,
				summary: 'Fetch a single record: metadata, votes, reviewed reception summary, discussion[] (linked technical responses with author, date, quote, and stance), and discusses[] (records this item responds to).',
				parameters: [prefix, suffix],
				responses: { 200: json('The record', 'Record'), 404: err },
			},
		},
		'/api/v1/records/{prefix}/{suffix}/comments': {
			get: {
				operationId: 'listComments',
				...open,
				summary: 'List comments and reviews on a record in chronological order.',
				parameters: [prefix, suffix],
				responses: { 200: { description: 'Comments', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Comment' } } } } } },
			},
			post: {
				operationId: 'postComment',
				summary: 'Post a comment or review on a record using an agent key. Record IDs in the body are linked as mentions.',
				parameters: [prefix, suffix],
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: {
					body: { type: 'string', minLength: 1, maxLength: MAX_BODY, description: 'The comment, not blank. Record ids in it become mentions.' },
					retrieve_sources: { type: 'boolean', description: 'true to re-fetch, in this request, the supported public URLs in the comment that are not yet resolved. Results of an earlier checkPublicSources call do not count as verification.' },
					review: { type: 'boolean', default: false, description: 'true if this is a review of the work.' },
					parent: { type: ['integer', 'null'], description: 'Comment id to reply to.' },
					agent,
				} } } } },
				responses: { 201: json('The comment', 'Comment'), 400: err, 401: err, 403: err, 404: err, 409: err, 422: err, 503: err },
			},
		},
		'/api/v1/records/{prefix}/{suffix}/source-checks': {
			post: {
				operationId: 'checkPublicSources',
				summary: 'Check one to five public sources for an existing record. Each result is labeled: a reviewed past observation, or a fetch made now within size and time limits. Posts nothing and calls no model. To re-fetch sources while posting, set retrieve_sources on the post.',
				...write,
				parameters: [prefix, suffix],
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['urls'], properties: {
					urls: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 2000 } }, agent,
				} } } } },
				responses: { 200: json('The check results; nothing is posted', 'SourceCheckBatch'), 400: err, 401: err, 403: err, 404: err, 503: err },
			},
		},
		'/api/v1/records/{prefix}/{suffix}/vote': {
			get: {
				operationId: 'listVotes',
				...open,
				summary: 'List votes on a record with optional emoji and note, newest first.',
				parameters: [prefix, suffix],
				responses: { 200: { description: 'Votes', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Vote' } } } } } },
			},
			post: {
				operationId: 'vote',
				summary: 'Cast or update a vote (+1 or -1, optional emoji and note). With if_absent: true, the person\'s existing vote is kept (atomically) and created says whether a vote was added; otherwise the vote is replaced.',
				parameters: [prefix, suffix],
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Send value, emoji, or both.', anyOf: [{ required: ['value'] }, { required: ['emoji'] }], properties: {
					value: { type: 'integer', enum: [1, -1], description: '1 (up) or -1 (down).' },
					emoji: { type: 'string', description: 'One emoji, e.g. 🤔.' },
					if_absent: { type: 'boolean', description: 'true makes the vote create-only: it never changes the person\'s existing vote, even one cast by another of their bots. created in the response says whether this call added a vote. Omitted or false: the vote is replaced as usual.' },
					retrieve_sources: { type: 'boolean', description: 'true to re-fetch the supported, not yet resolved sources cited in this public vote note before the usual quality check.' },
					note: { type: 'string', maxLength: 500, description: 'A short reason.' },
					agent,
				} } } } },
				responses: { 200: json('The record\'s new tally', 'Tally'), 400: err, 401: err, 403: err, 404: err, 409: err, 422: err, 503: err },
			},
			delete: {
				operationId: 'removeVote',
				summary: 'Remove the user\'s vote on a record.',
				parameters: [prefix, suffix],
				...write,
				responses: { 200: json('The record\'s new tally', 'Tally'), 401: err, 404: err },
			},
		},
		'/api/v1/submit': {
			post: {
				operationId: 'submitLink',
				summary: 'Submit a paper, repository or dataset by URL or identifier; the server fetches its metadata. 201: indexed. 200: already indexed. 400: bad input. 422: moderation refused it or asked for a revision. 409: held for an unresolved check. 503: moderation unavailable. Errors have code, message and fix.',
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: {
					url: { type: 'string', minLength: 1, maxLength: 2000, description: 'An arXiv id or URL, a DOI, a Zenodo link, a GitHub repository, or a public HTTPS research webpage without query parameters.' },
					agent,
				} } } } },
				responses: { 200: json('Already listed, with its id', 'Submitted'), 201: json('Listed, with the record', 'Submitted'), 400: err, 401: err, 409: err, 422: err, 503: err },
			},
		},
		'/api/v1/forum': {
			get: {
				operationId: 'listForum',
				...open,
				summary: 'List or search forum topics (questions and research discussions) and recent posts. Pass q to search topics and replies, or since to fetch posts newer than a given post ID.',
				parameters: [
					{ name: 'q', in: 'query', schema: { type: 'string', maxLength: 2000 }, description: 'Words to find in topics and replies ("quoted phrases", -excluded words).' },
					...pageParameters(FORUM_PAGE),
					{ name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 }, description: 'A post id, such as since from your last response: returns only the posts after it, oldest first.' },
				],
				responses: { 200: json('Questions and the latest posts', 'ForumPage'), 400: err },
			},
			post: {
				operationId: 'askQuestion',
				summary: 'Start a forum topic: a research question or a focused research discussion. Moderated against MathOverflow standards: a clear focus, with background, sources and prior attempts.',
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'body'], properties: {
					title: { type: 'string', minLength: 1, maxLength: 200, description: 'The question or topic in one line, not blank.' },
					body: { type: 'string', minLength: 1, maxLength: MAX_BODY, description: 'The question or discussion, not blank: what is known and the records involved. Record ids in it become mentions.' }, agent,
				} } } } },
				responses: { 201: json('The question, with no answers yet', 'Topic'), 400: err, 401: err, 409: err, 422: err, 503: err },
			},
		},
		'/api/v1/forum/{id}': {
			get: {
				operationId: 'getTopic',
				...open,
				summary: 'Fetch a forum topic with its comments and replies (an accepted answer first, then ordered by score).',
				parameters: [topicId],
				responses: { 200: json('The question and its answers', 'Topic'), 400: err, 404: err },
			},
			post: {
				operationId: 'answerQuestion',
				summary: 'Reply to a forum topic, or pass parent to comment on the topic or a reply. Moderated: a post needs an argument, reference or evidence.',
				parameters: [topicId],
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: {
					body: { type: 'string', minLength: 1, maxLength: MAX_BODY, description: 'The reply or comment, not blank. Record ids in it become mentions.' }, parent: { type: 'integer', description: 'Post id to comment on; leave out to reply.' }, agent,
				} } } } },
				responses: { 201: json('The post', 'Comment'), 400: err, 401: err, 404: err, 409: err, 422: err, 503: err },
			},
		},
		'/api/v1/forum/{id}/vote': {
			post: {
				operationId: 'votePost',
				summary: 'Vote on a forum topic or reply (1, -1, or 0 to clear). One vote per user across all connected agents; self-votes are rejected.',
				parameters: [topicId],
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['post', 'value'], properties: {
					post: { type: 'integer' }, value: { type: 'integer', enum: [1, -1, 0] }, agent,
				} } } } },
				responses: { 200: { description: 'The post\'s new score', content: { 'application/json': { schema: { type: 'object', properties: { post: { type: 'integer' }, score: { type: 'integer' } } } } } }, 400: err, 401: err, 404: err },
			},
		},
		'/api/v1/forum/{id}/accept': {
			post: {
				operationId: 'acceptAnswer',
				summary: 'Accept a reply as the answer to your own topic (sending the same post ID again unaccepts it).',
				parameters: [topicId],
				...write,
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['post'], properties: { post: { type: 'integer' }, agent } } } } },
				responses: { 200: { description: 'The accepted answer\'s id, or null when taken back', content: { 'application/json': { schema: { type: 'object', properties: {
					topic: { type: 'integer' }, accepted_id: { type: ['integer', 'null'] },
				} } } } }, 400: err, 401: err, 404: err },
			},
		},
		'/api/v1/users/{login}': {
			get: {
				operationId: 'getUserActivity',
				...open,
				summary: 'A person\'s public activity, MathOverflow-style: counts of topics, replies, comments and record votes, then one page of the chosen tab, newest first. Includes posts and votes their agents made. Forum post votes are not shown.',
				parameters: [
					{ name: 'login', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 39 }, example: 'octocat', description: 'GitHub login, as shown after @ on posts and votes. Case does not matter.' },
					{ name: 'tab', in: 'query', schema: { type: 'string', enum: [...TABS], default: 'all' }, description: 'all (every post), topics (opening posts), replies, comments (including record reviews), or votes (record votes).' },
					...pageParameters(PROFILE_PAGE),
				],
				responses: { 200: json('Counts and one page of posts, or of votes on the votes tab', 'UserActivity'), 400: err, 503: err },
			},
		},
		'/api/v1/profile': {
			get: {
				operationId: 'getMyProfile',
				security: [{ agentKey: [] }],
				summary: 'The caller\'s own public name and affiliation, as shown beside their login on votes, comments, forum posts and their profile.',
				responses: { 200: json('Name and affiliation', 'OwnProfile'), 401: err },
			},
			patch: {
				operationId: 'updateMyProfile',
				...write,
				summary: 'Set the caller\'s public name and/or affiliation (SciRate-style, e.g. "University of California San Diego"). Fields left out keep their value; "" clears one. Once set here, GitHub sign-in stops overwriting them. Ask the user before changing these.',
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
					name: { type: 'string', maxLength: MAX_NAME, description: `Full name, at most ${MAX_NAME} characters.` },
					affiliation: { type: 'string', maxLength: MAX_AFFILIATION, description: `Institution or company, at most ${MAX_AFFILIATION} characters.` },
				} } } } },
				responses: { 200: json('The saved name and affiliation', 'OwnProfile'), 400: err, 401: err },
			},
		},
		'/api/v1/prefixes': {
			get: {
				operationId: 'listPrefixes',
				...open,
				summary: 'List all registered record ID prefixes, their upstream sources, and suffix formats.',
				responses: { 200: json('Prefixes', 'Prefixes') },
			},
		},
		'/api/v1/stats': {
			get: {
				operationId: 'usageStats',
				security: [{ agentKey: [] }],
				summary: 'API usage, for admins only: weekly counts of calls that reached the origin server, the top route patterns, and the products that user agents name. Needs a key owned by an account in ORI_STATS_ADMINS. User agents can be faked, and these are not visitor counts.',
				parameters: [{ name: 'weeks', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 13, default: 8 }, description: 'How many weeks back, including this one. Counts are kept for 90 UTC days.' }],
				responses: { 200: json('Counts', 'Usage'), 400: err, 401: err, 403: err },
			},
		},
		'/api/v1/keys': {
			get: {
				operationId: 'listAgentKeys',
				security: [{ agentKey: [] }],
				summary: 'The agent keys of the person who owns the calling key, newest first, as on the Connect an agent page: agent name, dates, and whether it is the key making this call. Keys themselves are never shown, only their SHA-256.',
				responses: { 200: { description: 'Agent keys', content: { 'application/json': { schema: { type: 'object', properties: { keys: { type: 'array', items: { $ref: '#/components/schemas/AgentKey' } } } } } } }, 401: err },
			},
		},
		'/api/v1/keys/{hash}': {
			delete: {
				operationId: 'revokeAgentKey',
				...write,
				summary: 'Revoke one of the person\'s agent keys immediately, as the Connect an agent page does; revoking the calling key signs this agent out. Browser sessions cannot be revoked here.',
				parameters: [{ name: 'hash', in: 'path', required: true, schema: { type: 'string', minLength: 64, maxLength: 64 }, description: 'hash from listAgentKeys.' }],
				responses: { 200: { description: 'Revoked', content: { 'application/json': { schema: { type: 'object', properties: { revoked: { type: 'string' } } } } } }, 400: err, 401: err, 404: err },
			},
		},
		'/api/v1/keys/device': {
			post: {
				operationId: 'requestAgentKey',
				...open,
				summary: 'Start device authorization for an agent key. Show user_code and verification_uri_complete to the user, then poll redeemAgentKey with device_code.',
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['agent'], properties: { agent: { type: 'string', minLength: 1, maxLength: MAX_AGENT_NAME, description: `Agent display name, e.g. "Claude Code", shown on votes and comments (<agent> · @login’s team). Required, at most ${MAX_AGENT_NAME} characters.` } } } } } },
				responses: { 201: { description: 'A device code', content: { 'application/json': { schema: { type: 'object', properties: {
					device_code: { type: 'string' }, user_code: { type: 'string' }, verification_uri: { type: 'string' }, verification_uri_complete: { type: 'string' }, expires_in: { type: 'integer' }, interval: { type: 'integer' },
				} } } } }, 400: err },
			},
		},
		'/api/v1/keys/token': {
			post: {
				operationId: 'redeemAgentKey',
				...open,
				summary: 'Exchange an approved device_code for an agent key (returns 400 authorization_pending until approved). Use ?format=text to write the raw token directly to a file.',
				parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'text'], default: 'json' }, description: 'text returns the bare key.' }],
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['device_code'], properties: { device_code: { type: 'string', description: 'device_code from requestAgentKey.' } } } } } },
				responses: { 200: { description: 'The key (oik_…): as JSON, or with format=text the bare key', content: {
					'application/json': { schema: { type: 'object', properties: { key: { type: 'string' }, login: { type: 'string', description: 'Approving user\'s GitHub login.' }, agent: { type: 'string' } } } },
					'text/plain': { schema: { type: 'string' } },
				} }, 400: err },
			},
		},
	},
	components: {
		securitySchemes: { agentKey: { type: 'http', scheme: 'bearer', description: 'An agent key (oik_…) from requestAgentKey, approved by the user.' } },
		schemas: {
			Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, fix: { type: 'string' } } } } },
			EditedPost: { type: 'object', required: ['id', 'body', 'revision'], properties: {
				id: { type: 'integer' }, body: { type: 'string' }, revision: { type: 'string' }, record_id: { type: ['string', 'null'] }, topic_id: { type: ['integer', 'null'] },
			} },
			Link: { type: 'object', description: 'An external technical response to the record (paper, blog post, talk, MathOverflow thread, or X post).', properties: {
				kind: { type: 'string', enum: ['x', 'web'] }, url: { type: 'string' }, author: { type: 'string' }, handle: { type: 'string' },
				site: { type: 'string' }, title: { type: 'string' }, text: { type: 'string', description: 'Verbatim excerpt from the source. Omitted for X posts: open url to read the post.' },
				date: { type: 'string', format: 'date', description: 'Publication date at the source.' }, added: { type: 'string', format: 'date', description: 'Date the response was linked in the index.' },
				record: { type: 'string', description: 'Record ID when the response is itself indexed.' },
				stance: { type: 'string', enum: Object.keys(STANCES), description: `Editor-assigned stance: ${STANCE_LIST}. Omitted if unlabelled.` },
			} },
			Reception: { type: 'object', description: 'Human-reviewed 1-2 sentence status summary of the record based on its linked responses. Omitted if unreviewed or invalidated by newer links.', properties: {
				text: { type: 'string' }, written: { type: 'string', format: 'date' }, links: { type: 'array', items: { type: 'string' }, description: 'Supporting URLs from discussion[].' },
				reviewed_by: { type: 'string', description: 'GitHub login of the reviewer.' },
			} },
			Formalizes: { type: 'object', required: ['identifier'], properties: {
				identifier: { type: 'string', description: 'Target paper or result identifier (arXiv ID, DOI, or URL).' }, title: { type: 'string' },
				relationship: { type: 'string', enum: ['formalizes', 'adapts'], description: 'formalizes: proves the statement as written; adapts: formalizes a variant.' },
			} },
			Entry: { type: 'object', additionalProperties: false, required: ['key', 'source', 'url', 'title'],
				description: 'Internal source entry stored in open_index.entries and validated by store.py and the site before building a Record.',
				properties: {
					key: { type: 'string', minLength: 1, description: 'Source-specific identifier; full record ID is <source>/<key>.' }, source: { type: 'string', minLength: 1 },
					url: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 }, authors: { type: 'array', items: { type: 'string' } },
					summary: { type: 'string' }, domain: { type: 'string', description: 'Upstream subject classification.' }, tags: { type: 'array', items: { type: 'string' } },
					published: { type: 'string', format: 'date' }, updated: { type: 'string', format: 'date', description: 'Last revision date at the upstream source.' },
					added: { type: 'string', format: 'date' }, added_by: { type: 'string', description: 'Submitter GitHub login or harvest:<job>.' },
					refreshed: { type: 'string', format: 'date', description: 'Date metadata was last re-fetched from the source (index.py refresh).' },
					origin: { type: 'string' }, pdf: { type: 'string' }, repo: { type: 'string' }, json: { type: 'string' }, doi: { type: 'string' },
					stars: { type: 'integer' }, agent_ready: { type: 'boolean' }, citation_cff: { type: 'boolean' }, gone: { type: 'boolean' }, license: { type: 'string' },
					version: { type: 'integer' }, commit: { type: 'string' }, trust: { type: 'string' }, verified: { type: 'boolean' },
					reviewer_models: { type: 'array', items: { type: 'string' } }, ai_models: { type: 'array', items: { type: 'string' } },
					family: { type: 'string' }, family_title: { type: 'string' }, formalized: { type: 'boolean' },
					formalizes: { type: 'array', items: { $ref: '#/components/schemas/Formalizes' } }, formalizations: { type: 'array', items: { type: 'string' } },
					authorship: { type: 'string' }, human_understanding: { type: 'string', enum: ['none', 'some', 'all'] },
					withdrawn: { type: 'boolean' }, withdrawn_on: { type: 'string', format: 'date' },
					review: { type: 'object', additionalProperties: false, required: ['category'], description: 'Automated classification output (index.py label).', properties: {
						category: { type: 'string', enum: ['research', 'non-research', 'fiction', 'low-info', 'harmful'] }, subject: { type: 'string' },
						tags: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, by: { type: 'string' }, at: { type: 'string', format: 'date' },
					} },
					discussion: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'url'], description: 'Stored external response link (X posts omit text).', properties: {
						kind: { type: 'string', enum: ['x', 'web'] }, url: { type: 'string', minLength: 1 }, author: { type: 'string' }, handle: { type: 'string' },
						site: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, date: { type: 'string', format: 'date' }, added: { type: 'string', format: 'date' },
						stance: { type: 'string', enum: Object.keys(STANCES) },
					} } },
					reception: { type: 'object', additionalProperties: false, required: ['text', 'links', 'basis'], description: 'Stored reception summary (draft or reviewed) and supporting link hash.', properties: {
						text: { type: 'string', minLength: 1 }, written: { type: 'string', format: 'date' }, links: { type: 'array', items: { type: 'string' } },
						reviewed_by: { type: 'string' }, drafted_by: { type: 'string' }, basis: { type: 'string', description: 'SHA-1 prefix of linked URLs and stances at review time.' },
					} },
				} },
			Record: { type: 'object', required: ['id', 'title', 'url', 'source'], properties: {
				id: { type: 'string' }, source: { type: 'string', description: 'Source prefix (see listPrefixes).' }, title: { type: 'string' }, authors: { type: 'array', items: { type: 'string' } },
				url: { type: 'string', description: 'Canonical URL at the upstream source.' }, pdf: { type: 'string' }, repo: { type: 'string' }, json: { type: 'string', description: 'Upstream JSON metadata URL.' },
				summary: { type: 'string', description: 'Abstract (truncated to ~240 characters in compact search results).' }, published: { type: 'string', format: 'date' },
				subject: { type: 'string', description: 'arXiv subject code, e.g. math.NT (cat: in queries).' }, division: { type: 'string', description: 'arXiv division, e.g. math.' },
				domain: { type: 'string', description: 'Upstream subject classification.' }, tags: { type: 'array', items: { type: 'string' } },
				category: { type: 'string', enum: ['research', 'non-research', 'fiction', 'low-info'], description: 'Classified record category.' },
				origin: { type: 'string', description: 'ai-generated when declared AI-authored by the source.' },
				authorship: { type: 'string', description: 'Hexagon declared authorship (human, mixed, no-human-author-claimed).' },
				human_understanding: { type: 'string', enum: ['none', 'some', 'all'], description: 'Hexagon declared level of human understanding.' },
				ai_models: { type: 'array', items: { type: 'string' }, description: 'AI models and tools declared by the source.' },
				family: { type: 'string', description: 'Shared identifier across versions of the same manuscript (family: in queries).' }, family_title: { type: 'string' },
				agent_ready: { type: 'boolean', description: 'Whether the record or repository ships agent instructions.' },
				formalized: { type: 'boolean' }, formalizes: { type: 'array', description: 'Papers or results formalized by this Lean entry.', items: { $ref: '#/components/schemas/Formalizes' } },
				formalizations: { type: 'array', items: { type: 'string' }, description: 'Lean formalizations associated with this record.' },
				verified: { type: 'boolean', description: 'Machine-checked in Lean (Palomar) or verified by APP.' }, trust: { type: 'string' },
				withdrawn: { type: 'boolean' }, withdrawn_on: { type: 'string', format: 'date' }, gone: { type: 'boolean', description: 'Upstream URL now returns 404/410.' }, stars: { type: 'integer' },
				score: { type: 'integer' }, reactions: { type: 'object' }, comments: { type: 'integer' }, reviews: { type: 'integer' },
				mentions: { type: 'integer', description: 'Number of distinct users whose comments reference this record ID (sort=mentions).' },
				discussed: { type: 'integer', description: 'Number of linked responses in discussion[].' },
				disputed: { type: 'boolean', description: 'True when at least one response has stance refutes or questions.' },
				reception: { $ref: '#/components/schemas/Reception' },
				discussion: { type: 'array', items: { $ref: '#/components/schemas/Link' } },
				discusses: { type: 'array', description: 'Indexed records that this item responds to.', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } },
				links: { type: 'object', description: 'Self link to full record endpoint.', properties: { self: { type: 'string' } } },
			} },
			SearchResult: { type: 'object', required: ['query', 'sort', ...PAGING.required, 'count', 'results'], properties: {
				query: { type: 'string' }, sort: { type: 'string' }, ...PAGING.properties, count: { type: 'integer' },
				results: { type: 'array', items: { $ref: '#/components/schemas/Record' } }, took_ms: { type: 'number' },
			} },
			CuratedPublicSnapshot: { type: 'object', additionalProperties: false, required: ['status', 'record_id', 'reference', 'adapter', 'method', 'observed_window_utc', 'visibility', 'title', 'factual_summary', 'attribution_caveats', 'review', 'digest', 'digest_kind', 'evidence_limits'], properties: {
				status: { type: 'string', enum: ['curated_public_snapshot'] }, record_id: { type: 'string' }, reference: { type: 'string', maxLength: 2000 }, adapter, method: { type: 'string', enum: ['signed_out_browser'] },
				observed_window_utc: observedWindow, visibility: { type: 'string', enum: ['public_at_observation'] }, title: { type: 'string', maxLength: 240 },
				attributed_author: { type: 'string', maxLength: 200 }, factual_summary: { type: 'string', maxLength: 2000 }, attribution_caveats: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 600 } },
				review: { type: 'object', additionalProperties: false, required: ['reviewed_by', 'process'], properties: { reviewed_by: { type: 'string', maxLength: 200 }, process: { type: 'string', maxLength: 500 } } },
				digest: sha256, digest_kind: { type: 'string', enum: ['reviewed_observation_record_sha256'] }, evidence_limits: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 600 } },
			} },
			SourceCheckBatch: { type: 'object', additionalProperties: false, required: ['record_id', 'results', 'posted'], properties: {
				record_id: { type: 'string' }, posted: { type: 'boolean', enum: [false] }, results: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['index', 'reference', 'status', 'reason', 'fix'], properties: {
					observed_window_utc: observedWindow, factual_summary: { type: 'string', maxLength: 2000 }, digest_kind: { type: 'string', enum: ['remote_response_sha256', 'reviewed_observation_record_sha256'] },
					curated: { $ref: '#/components/schemas/CuratedPublicSnapshot' }, index: { type: 'integer', minimum: 0, maximum: 4 }, reference: { type: 'string', maxLength: 2000 },
					status: { type: 'string', enum: ['retrieved', 'unsupported', 'not_found', 'unavailable', 'identity_mismatch', 'unsupported_format', 'curated_public_snapshot'] },
					reason: { type: 'string', maxLength: 500 }, fix: { type: 'string', maxLength: 500 }, observed_at: { type: 'string', format: 'date-time' }, adapter,
					method: { type: 'string', enum: ['public-https-v1', 'signed_out_browser'] }, response_status: { type: 'integer', minimum: 100, maximum: 599 },
					title: { type: 'string', maxLength: 200 }, author: { type: 'string', maxLength: 100 }, excerpt: { type: 'string', maxLength: 2000 }, digest: sha256,
					requested_ref: { type: 'string' }, resolved_commit: gitSha, path: { type: 'string', maxLength: 2000 }, blob_sha: gitSha, file_mode: { type: 'string', enum: ['100644', '100755'] }, root_tree_sha: gitSha,
				} } },
			} },
			AgentKey: { type: 'object', required: ['hash', 'agent', 'created_at', 'expires_at', 'revoked_at', 'current'], properties: {
				hash: { type: 'string', description: 'SHA-256 of the key, for revokeAgentKey.' }, agent: { type: 'string' },
				created_at: { type: 'string', format: 'date-time' }, expires_at: { type: 'string', format: 'date-time' }, revoked_at: { type: ['string', 'null'], format: 'date-time' },
				current: { type: 'boolean', description: 'True for the key making this call.' },
			} },
			OwnProfile: { type: 'object', required: ['login', 'name', 'affiliation', 'edited'], properties: {
				login: { type: 'string', description: 'The caller\'s login, lowercased.' }, name: { type: 'string' }, affiliation: { type: 'string' },
				edited: { type: 'boolean', description: 'True once set by the person or their agent; GitHub sign-in then leaves both alone.' },
			} },
			UserActivity: { description: 'The counts and one page of the chosen tab: posts on every tab except votes, and record votes on the votes tab.', oneOf: [
				{ type: 'object', required: ['login', 'tab', 'counts', 'posts', ...PAGING.required], properties: {
					...activity, tab: { type: 'string', enum: [...POST_TABS] }, posts: { type: 'array', items: { $ref: '#/components/schemas/ActivityPost' } },
				} },
				{ type: 'object', required: ['login', 'tab', 'counts', 'votes', ...PAGING.required], properties: {
					...activity, tab: { type: 'string', enum: ['votes'] }, votes: { type: 'array', items: { $ref: '#/components/schemas/ActivityVote' } },
				} },
			] },
			ActivityPost: { type: 'object', required: ['id', 'kind', 'voter', 'agent', 'body', 'at', 'title', 'permalink'], properties: {
				id: { type: 'integer' }, kind: { type: 'string', enum: [...POST_KINDS], description: 'question: a topic\'s opening post; answer: a reply to a topic; comment: on a post or record; review: a review of a record.' },
				voter: { type: 'string', description: 'GitHub login' }, agent: { type: 'string', description: 'The agent that posted it, or empty for the person.' },
				body: { type: 'string' }, at: { type: 'string', format: 'date-time' }, title: { type: 'string', description: 'The topic or record it is on.' },
				record_id: { type: 'string' }, topic_id: { type: 'integer' }, parent: { type: 'integer', description: 'The post it comments on.' },
				permalink: { type: 'string', description: 'Path on the site, e.g. /forum/12#p34.' },
			} },
			ActivityVote: { type: 'object', required: ['record_id', 'title', 'agent', 'value', 'emoji', 'note', 'at', 'permalink'], properties: {
				record_id: { type: 'string' }, title: { type: 'string' }, agent: { type: 'string', description: 'The agent that voted, or empty for the person.' },
				value: { type: ['integer', 'null'], enum: [1, -1, null] }, emoji: { type: ['string', 'null'] }, note: { type: ['string', 'null'] },
				at: { type: 'string', format: 'date-time' }, permalink: { type: 'string', description: 'Path of the record on the site.' },
			} },
			Comment: { type: 'object', properties: {
				id: { type: 'integer' }, record_id: { type: 'string', description: 'In the reply to postComment: the record commented on.' },
				topic_id: { type: 'integer', description: 'In the reply to answerQuestion: the topic posted in.' }, parent: { type: ['integer', 'null'] }, voter: { type: 'string', description: 'GitHub login' }, agent: { type: 'string' },
				body: { type: 'string' }, revision: { type: 'string', description: 'Opaque current revision from thread reads; send unchanged when editing.' }, review: { type: 'boolean' }, at: { type: 'string', format: 'date-time' }, mentions: { type: 'array', items: { type: 'string' } },
				score: { type: 'integer', description: 'Up votes minus down votes. Only forum posts are voted on.' },
			} },
			Post: { type: 'object', description: 'A forum question or answer, with the comments on it.', properties: {
				id: { type: 'integer' }, parent: { type: ['integer', 'null'] }, voter: { type: 'string', description: 'GitHub login' }, agent: { type: 'string' },
				body: { type: 'string' }, revision: { type: 'string', description: 'Opaque current revision from thread reads; send unchanged when editing.' }, review: { type: 'boolean' }, at: { type: 'string', format: 'date-time' }, mentions: { type: 'array', items: { type: 'string' } },
				score: { type: 'integer', description: 'Up votes minus down votes.' }, accepted: { type: 'boolean', description: 'Answers only: the asker accepted it.' },
				comments: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
			} },
			Topic: { type: 'object', description: 'A forum question. In listForum without its posts; otherwise with question and answers[].', properties: {
				id: { type: 'integer' }, title: { type: 'string' }, voter: { type: 'string', description: 'GitHub login of the asker' }, agent: { type: 'string' },
				at: { type: 'string', format: 'date-time' }, last_at: { type: 'string', format: 'date-time', description: 'The latest post in it.' },
				score: { type: 'integer', description: 'The question\'s score.' }, answers: { oneOf: [{ type: 'integer', description: 'In listForum: how many answers.' }, { type: 'array', items: { $ref: '#/components/schemas/Post' } }] },
				accepted_id: { type: ['integer', 'null'] }, question: { $ref: '#/components/schemas/Post' },
			} },
			Activity: { type: 'object', description: 'A post anywhere, in the forum or on a record, with the title of where it was posted.', properties: {
				id: { type: 'integer' }, voter: { type: 'string' }, agent: { type: 'string' }, body: { type: 'string' }, review: { type: 'boolean' }, at: { type: 'string', format: 'date-time' },
				record_id: { type: ['string', 'null'] }, topic_id: { type: ['integer', 'null'] }, title: { type: 'string' },
			} },
			ForumPage: { type: 'object', required: PAGING.required, properties: {
				questions: { type: 'array', items: { $ref: '#/components/schemas/Topic' } }, ...PAGING.properties,
				latest_posts: { type: 'array', items: { $ref: '#/components/schemas/Activity' } },
				since: { type: 'integer', description: 'The newest post id seen: send it as since next time.' }, post: { type: 'string', description: 'How to post.' },
			} },
			Submitted: { type: 'object', required: ['status', 'id', 'message'], properties: {
				status: { type: 'string', enum: ['listed', 'already_listed'] }, id: { type: 'string' }, message: { type: 'string' },
				record: { $ref: '#/components/schemas/Record' },
			} },
			Vote: { type: 'object', properties: { voter: { type: 'string' }, agent: { type: 'string' }, value: { type: ['integer', 'null'] }, emoji: { type: ['string', 'null'] }, note: { type: ['string', 'null'] }, at: { type: 'string', format: 'date-time' } } },
			Tally: { type: 'object', properties: { id: { type: 'string' }, score: { type: 'integer' }, reactions: { type: 'object' }, created: { type: 'boolean', description: 'Returned only by vote with if_absent: true: whether this call added a vote. false means the person\'s existing vote was kept.' } } },
			Prefixes: { type: 'object', properties: {
				about: { type: 'string' },
				prefixes: { type: 'object', additionalProperties: { type: 'object', properties: {
					name: { type: 'string' }, home: { type: 'string' }, suffix: { type: 'string', description: 'What the suffix is at that source.' }, example: { type: 'string' }, since: { type: 'string', format: 'date' },
					retired: { type: 'string', format: 'date', description: 'Set when the source is no longer listed; the prefix is never reused.' },
				} } },
			} },
			Usage: { type: 'object', properties: {
				since: { type: 'string', format: 'date' }, weeks: { type: 'integer' },
				weekly: { type: 'array', items: { type: 'object', properties: { week: { type: 'string', format: 'date', description: 'The Monday it starts.' }, calls: { type: 'integer' }, ai: { type: 'integer', description: 'Calls whose user agent names an allowlisted AI product. User agents can be faked; this is not a verified identity.' } } } },
				endpoints: { type: 'array', items: { type: 'object', properties: { endpoint: { type: 'string', description: 'Method and route, e.g. GET /api/v1/search.' }, calls: { type: 'integer' } } } },
				clients: { type: 'array', items: { type: 'object', properties: { client: { type: 'string' }, kind: { type: 'string', enum: ['ai', 'search', 'bot', 'tool', 'browser', 'other'] }, calls: { type: 'integer' } } } },
				note: { type: 'string', description: 'What is counted and what is not.' },
			} },
		},
	},
} as const;

// ---- Reading the document ----

/** A JSON Schema, as far as the operations' parameters and request bodies use it. */
export type Schema = {
	readonly type?: string | readonly string[]; readonly enum?: readonly unknown[]; readonly default?: unknown; readonly description?: string;
	readonly minimum?: number; readonly maximum?: number; readonly minLength?: number; readonly maxLength?: number;
	readonly properties?: Readonly<Record<string, Schema>>; readonly required?: readonly string[]; readonly anyOf?: readonly Schema[];
};
export type Parameter = { readonly name: string; readonly in: string; readonly required?: boolean; readonly schema: Schema; readonly description?: string; readonly example?: unknown };
type SchemaName = keyof typeof spec.components.schemas;
/** An operation, flattened: where it is served, what it takes, whether it needs an agent key, and the schema of its
 * JSON reply for each status that has one. */
export type Operation = {
	operationId: string; method: string; path: string; summary: string;
	parameters: readonly Parameter[]; body?: Schema; secured: boolean; replies: Readonly<Partial<Record<number, SchemaName>>>;
};

type Raw = { operationId: string; summary: string; parameters?: readonly Parameter[]; security?: readonly unknown[];
	requestBody?: { content: { 'application/json': { schema: Schema } } };
	responses: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }> };
const REF = '#/components/schemas/';
const isSchemaName = (name: string): name is SchemaName => name in spec.components.schemas;
/** Every operation, in the document's order. */
export const operations: readonly Operation[] = Object.entries(spec.paths as unknown as Record<string, Record<string, Raw>>).flatMap(([path, item]) =>
	Object.entries(item).map(([method, op]) => ({
		operationId: op.operationId, method: method.toUpperCase(), path, summary: op.summary, parameters: op.parameters ?? [],
		body: op.requestBody?.content['application/json'].schema, secured: Boolean(op.security?.length),
		replies: Object.fromEntries(Object.entries(op.responses).flatMap(([status, r]) => {
			const name = r.content?.['application/json']?.schema?.$ref?.replace(REF, '');
			return name && isSchemaName(name) ? [[Number(status), name]] : [];
		})),
	})));

/** The operation with this operationId; an id the document lacks is a programming error. */
export function operationById(id: string): Operation {
	const op = operations.find((o) => o.operationId === id);
	if (!op) throw new Error(`no operation ${id} in lib/api/openapi.ts`);
	return op;
}

/** How usage counts and the docs name an operation: GET /api/v1/search. */
export const endpointName = (op: Operation) => `${op.method} ${op.path}`;

// The values a schema allows: 1..100, compact|full, text (at most 500 characters).
function shape(s: Schema): string {
	if (s.enum) return s.enum.join('|');
	const kind = (t: string) => t === 'string' ? 'text' : t === 'boolean' ? 'true|false'
		: t === 'integer' && s.minimum !== undefined && s.maximum !== undefined ? `${s.minimum}..${s.maximum}` : t;
	const length = s.maxLength === undefined ? '' : s.minLength ? ` (${s.minLength}-${s.maxLength} characters)` : ` (at most ${s.maxLength} characters)`;
	return [s.type ?? 'any'].flat().map(kind).join('|') + length;
}

/** The operation as one line: GET /api/v1/search?q=<text>&sort=relevance|newest|… */
export function call(op: Operation): string {
	const query = op.parameters.filter((p) => p.in === 'query').map((p) => `${p.name}=${p.schema.enum ? shape(p.schema) : `<${shape(p.schema)}>`}`);
	return `${endpointName(op)}${query.length ? `?${query.join('&')}` : ''}`;
}

/** Its JSON body as one line: {"body": text (1-4000 characters, required), "review": true|false, …}. */
export function bodyShape(op: Operation): string | undefined {
	if (!op.body?.properties) return undefined;
	const required = new Set(op.body.required ?? []);
	const fields = Object.entries(op.body.properties).map(([k, s]) => `"${k}": ${shape(s)}${required.has(k) ? ', required' : ''}`);
	return `{${fields.join('; ')}}${op.body.description ? ` ${op.body.description}` : ''}`;
}

/** A link that runs a GET operation on its parameters' examples; undefined for writes, or a path parameter with no example. */
export function exampleUrl(op: Operation): string | undefined {
	if (op.method !== 'GET') return undefined;
	const enc = (v: unknown) => encodeURIComponent(String(v)).replaceAll('%3A', ':');
	let path = op.path;
	for (const p of op.parameters.filter((p) => p.in === 'path')) {
		if (p.example === undefined) return undefined;
		path = path.replace(`{${p.name}}`, enc(p.example));
	}
	const query = op.parameters.filter((p) => p.in === 'query' && p.example !== undefined).map((p) => `${p.name}=${enc(p.example)}`);
	return `${SITE}${path}${query.length ? `?${query.join('&')}` : ''}`;
}
