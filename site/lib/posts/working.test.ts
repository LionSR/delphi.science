// Working on an open question (docs/working-on-a-question.md), on in-process Postgres: which topics are open, a
// space that names a topic, a space opened with invitations, and the questions an agent puts to its owner.
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Voter } from '#lib/accounts/keys.ts';
import { QueryError } from '#lib/errors.ts';
import { migratedDb } from '#lib/testing.ts';
import { post } from './comments.ts';
import { accept, startTopic, topicQuery, topics } from './forum.ts';
import { log } from './log.ts';
import { addMember, createSpace, MAX_INVITED_AT_OPENING, members, mySpaces, openQuestions, spacesOn, topicsNamed } from './spaces.ts';
import { FORUM } from './visibility.ts';

const person = (login: string): Voter => ({ login, agent: '' });
const alice = person('alice'), bob = person('bob'), eve = person('eve');
const aliceAgent: Voter = { login: 'alice', agent: 'Claude Code' };

let pg: PGlite;
const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;
before(async () => {
	process.env.DEEPSEEK_API_KEY = 'offline-working-fixture';
	globalThis.fetch = (async (url) => {
		assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'unexpected network call');
		return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'ACCEPT', verification_needed: false, reason: 'A scoped, checkable observation.', fix: '' }) } }] });
	}) as typeof fetch;
	pg = await migratedDb();
});
after(async () => {
	globalThis.fetch = priorFetch;
	if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
	await pg.close();
});

const titles = async (q: string) => (await topics(pg, null, { q, space: FORUM })).questions.map((t) => t.title).sort();
const paths = async (who: string | null, q: string, opts = {}) => (await log(pg, who, {}, { q, ...opts })).entries.map((e) => e.path);

describe('open and answered', () => {
	let open = 0, answered = 0;
	before(async () => {
		open = (await startTopic(pg, alice, { title: 'How wide a zero-free half-plane?', body: 'Find the smallest sigma.' })).id;
		const t = await startTopic(pg, alice, { title: 'Is the half-plane bound sharp for cubic fields?', body: 'A narrower question.' });
		answered = t.id;
		const reply = await post(pg, { topic: answered }, bob, { body: 'Yes: the trace inequality gives it.' });
		await accept(pg, answered, Number(reply.id), alice);
	});

	test('is:open and is:answered are terms of a forum search, with or without words', async () => {
		assert.deepEqual(topicQuery('is:open zero-free  half-plane'), { words: 'zero-free half-plane', state: 'open' });
		assert.deepEqual(topicQuery('half-plane IS:Answered'), { words: 'half-plane', state: 'answered' });
		assert.deepEqual(topicQuery('basis:open this:open'), { words: 'basis:open this:open', state: null }, 'only a whole term counts');
		assert.deepEqual(await titles(''), ['How wide a zero-free half-plane?', 'Is the half-plane bound sharp for cubic fields?']);
		assert.deepEqual(await titles('is:open'), ['How wide a zero-free half-plane?']);
		assert.deepEqual(await titles('is:answered'), ['Is the half-plane bound sharp for cubic fields?']);
		assert.deepEqual(await titles('half-plane'), ['How wide a zero-free half-plane?', 'Is the half-plane bound sharp for cubic fields?']);
		assert.deepEqual(await titles('is:open half-plane'), ['How wide a zero-free half-plane?']);
		assert.deepEqual(await titles('half-plane is:answered'), ['Is the half-plane bound sharp for cubic fields?']);
		assert.equal((await topics(pg, null, { q: 'is:open half-plane', space: FORUM })).total, 1, 'the count is of what matches');
	});

	test('in the log, a term about a topic is true of every post in it', async () => {
		const questions = await paths(null, 'kind:question is:open');
		assert.deepEqual(questions.map((p) => p.split('/').slice(0, 2).join('/')), [`forum/${open}`], 'the open question itself');
		assert.equal((await paths(null, 'is:answered')).length, 2, 'the question and its accepted answer');
		assert.deepEqual((await paths(null, 'is:answered')).map((p) => p.split('/').slice(0, 2).join('/')), [`forum/${answered}`, `forum/${answered}`]);
		assert.equal((await paths(null, 'NOT is:open')).every((p) => !p.startsWith(`forum/${open}/`)), true);
	});
});

describe('a space that works on a topic', () => {
	test('the paths a text names', () => {
		assert.deepEqual(topicsNamed('Working on forum/12.'), [12]);
		assert.deepEqual(topicsNamed('Working on [forum/12](/forum/12), after forum/7 and forum/12 again'), [12, 7]);
		assert.deepEqual(topicsNamed('platforum/12, forum/0, forum/x, forum/3x, https://example.org/forum/3 and /x/forum/4'), []);
		assert.deepEqual(topicsNamed('See https://delphi.science/forum/5 and [the other](/forum/6).'), [5, 6]);
		assert.deepEqual(topicsNamed('about forum/120'), [120], 'not forum/12');
	});

	test('a topic\'s page lists a member\'s spaces that name it, and nobody else\'s', async () => {
		const topic = (await startTopic(pg, bob, { title: 'An open problem about traces', body: 'What is the sharp constant?' })).id;
		const s = await createSpace(pg, alice, { title: 'Traces', about: `Working on [forum/${topic}](/forum/${topic}).` });
		await createSpace(pg, alice, { title: 'Something else', about: `Working on forum/${topic}0, not that one.` });
		assert.deepEqual(await spacesOn(pg, 'alice', topic), [{ id: s.id, title: 'Traces' }]);
		assert.deepEqual(await spacesOn(pg, 'ALICE', topic), [{ id: s.id, title: 'Traces' }]);
		assert.deepEqual(await spacesOn(pg, 'bob', topic), [], 'the asker learns nothing of it');
		assert.deepEqual(await spacesOn(pg, 'eve', topic), []);
		// Invited is not a member: the list is of the spaces a person can read.
		await addMember(pg, s.id, alice, 'bob');
		assert.deepEqual(await spacesOn(pg, 'bob', topic), []);
		await addMember(pg, s.id, bob, 'bob');
		assert.deepEqual(await spacesOn(pg, 'bob', topic), [{ id: s.id, title: 'Traces' }]);
	});
});

describe('a space opened with invitations', () => {
	test('each login is invited, once, and each invitation is a line of that person\'s log', async () => {
		const mark = (await log(pg, 'bob')).since;
		const s = await createSpace(pg, alice, { title: 'Reading group', invite: ['@Bob', 'bob', 'eve', 'ALICE'] });
		assert.deepEqual((await members(pg, s.id, 'alice'))!.map((m) => [m.login, m.accepted_at !== null, m.invited_by]),
			[['alice', true, 'alice'], ['bob', false, 'alice'], ['eve', false, 'alice']]);
		assert.deepEqual((await log(pg, 'bob', {}, { since: mark })).entries.map((e) => [e.path, e.by]), [[`ws/${s.id}/members/bob`, 'alice']]);
		assert.equal((await mySpaces(pg, 'eve')).some((m) => m.id === s.id && m.accepted_at === null), true);
	});

	test('a login that cannot be one opens no space, and neither do too many', async () => {
		const before = (await mySpaces(pg, 'alice')).length;
		await assert.rejects(createSpace(pg, alice, { title: 'Not opened', invite: ['bob', 'not a login'] }), (e) => e instanceof QueryError && /"not a login" is not a GitHub login/.test(e.message));
		const many = Array.from({ length: MAX_INVITED_AT_OPENING + 1 }, (_, n) => `person${n}`);
		await assert.rejects(createSpace(pg, alice, { title: 'Not opened', invite: many }), (e) => e instanceof QueryError && /at most 10 invitations/.test(e.message));
		assert.equal((await mySpaces(pg, 'alice')).length, before);
		assert.equal((await mySpaces(pg, 'bob')).some((m) => m.title === 'Not opened'), false);
	});
});

describe('a question put to a space reaches its people', () => {
	let slug = '', topic = 0, asked = '', poll = '', own = '';
	before(async () => {
		const s = await createSpace(pg, alice, { title: 'Notebook with Bob', invite: ['bob'] });
		slug = s.id;
		await addMember(pg, slug, bob, 'bob');
		topic = (await startTopic(pg, alice, { title: 'Review of the half-plane paper', body: 'Draft notes.', space: slug })).id;
		// Alice's agent asks her; Bob asks the group; Alice herself asks the group; and a post that only looks like one.
		asked = `ws/${slug}/${topic}/${(await post(pg, { topic, space: slug }, aliceAgent, { body: 'Options: Yes, post it | Not yet\n\nShall I post the review?' })).id}`;
		poll = `ws/${slug}/${topic}/${(await post(pg, { topic, space: slug }, bob, { body: 'options: Thursday | Friday\n\nWhen do we meet?' })).id}`;
		own = `ws/${slug}/${topic}/${(await post(pg, { topic, space: slug }, alice, { body: 'Options: a | b\n\nWhich one, Bob?' })).id}`;
		await post(pg, { topic, space: slug }, aliceAgent, { body: 'The options: a | b were considered above.' });
	});

	test('to:@me holds the question her own agent asked her, though the agent posts as her', async () => {
		const inbox = await paths('alice', 'to:@me');
		assert.equal(inbox.includes(asked), true, 'her agent\'s question');
		assert.equal(inbox.includes(poll), true, 'Bob\'s question to the space');
		assert.equal(inbox.includes(own), false, 'what she wrote herself is not addressed to her');
		assert.equal(inbox.filter((p) => p.startsWith(`ws/${slug}/${topic}/`)).length, 2 + 0, 'an agent\'s ordinary note is not in her inbox');
		// Bob's inbox: both questions that he did not write, and Alice's posts in... nothing else of this topic, which she started.
		const bobs = await paths('bob', 'to:@me');
		assert.deepEqual([bobs.includes(asked), bobs.includes(own), bobs.includes(poll)], [true, true, false]);
	});

	test('only the space\'s members read them, whoever is named', async () => {
		for (const reader of [null, 'eve']) {
			assert.equal((await paths(reader, 'to:@alice')).some((p) => p.startsWith('ws/')), false, `${reader ?? 'nobody'} reads nothing private`);
			assert.equal((await paths(reader, 'to:@bob')).some((p) => p.startsWith('ws/')), false);
		}
		assert.equal((await paths('alice', 'to:@me', { publicOnly: true })).some((p) => p.startsWith('ws/')), false, 'the MCP server, while spaces are closed to it');
		assert.equal((await paths('bob', 'to:@alice')).includes(asked), true, 'a fellow member may ask what is addressed to her there');
	});

	test('the list of questions waiting for an answer, until somebody chooses', async () => {
		const waiting = async (login: string) => (await openQuestions(pg, login)).map((q) => `ws/${q.space}/${q.topic}/${q.id}`);
		assert.deepEqual(await waiting('alice'), [poll, asked], 'newest first, without her own');
		assert.deepEqual(await waiting('bob'), [own, asked]);
		assert.deepEqual(await waiting('eve'), []);
		const [first] = await openQuestions(pg, 'alice');
		assert.deepEqual([first.options, first.text, first.voter, first.agent, first.topic_title, first.space_title], [['Thursday', 'Friday'], 'When do we meet?', 'bob', '', 'Review of the half-plane paper', 'Notebook with Bob']);
		// A reply that is not one of the options answers nothing; the option does, for everyone.
		const id = Number(asked.split('/').pop());
		await post(pg, { topic, space: slug }, alice, { body: 'Let me think.', parent: id });
		assert.equal((await waiting('alice')).includes(asked), true);
		await post(pg, { topic, space: slug }, alice, { body: 'Not yet', parent: id });
		assert.deepEqual(await waiting('alice'), [poll]);
		assert.deepEqual(await waiting('bob'), [own]);
	});
});
