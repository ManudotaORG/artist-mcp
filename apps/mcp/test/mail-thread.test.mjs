import assert from 'node:assert/strict';
import test from 'node:test';

import { THREAD_BUDGET_CHARS, readThread, stripQuoted } from '../dist/mail.js';
import { createServer } from '../dist/server.js';

/**
 * read_thread exists for one failure (docs/scope.md, gap 6): a fee agreed in
 * the first message and revised three replies later reads as settled when the
 * messages are read one at a time. These pin the two halves of that — every
 * reply is reached, and each shows what its sender added rather than the
 * history it quotes — and the conservative direction of the stripper, since
 * cutting new text is worse than leaving a quote in.
 */

const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

const msg = (id, when, from, body, extra = {}) => ({
  id,
  threadId: 't1',
  internalDate: String(when),
  labelIds: extra.labelIds ?? ['INBOX'],
  snippet: extra.snippet,
  payload: {
    mimeType: extra.html ? 'text/html' : 'text/plain',
    headers: [
      { name: 'From', value: from },
      { name: 'To', value: 'ruben@example.test' },
      { name: 'Date', value: new Date(when).toUTCString() },
      { name: 'Subject', value: extra.subject ?? 'Honorar Mittersill' },
    ],
    body: { data: b64url(body) },
  },
});

const stubThread = (messages) => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ id: 't1', messages }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return seen;
};

test.afterEach(() => {
  delete globalThis.fetch;
});

test('a Gmail reply is cut at its English attribution, with the > lines', () => {
  const { text, removedLines } = stripQuoted(
    'Agreed, 4.500 € then.\n\nOn Mon, 3 Nov 2026 at 10:15, Agnes <agnes@example.test> wrote:\n> We offer 4.000 €.\n> Best',
  );
  assert.equal(text, 'Agreed, 4.500 € then.');
  // The attribution and both quoted lines; the blank line above them is trimmed.
  assert.equal(removedLines, 3);
});

test('a German attribution is a cut too', () => {
  const { text } = stripQuoted(
    'Passt, 18 Uhr.\n\nAm Mo., 3. Nov. 2026 um 10:15 Uhr schrieb Agnes <agnes@example.test>:\n> 17 Uhr?',
  );
  assert.equal(text, 'Passt, 18 Uhr.');
});

test('a wrapped attribution over two lines is still found', () => {
  const { text } = stripQuoted(
    'Yes.\n\nOn Mon, 3 Nov 2026 at 10:15, Agnes Example-Verylongname\n<agnes@example.test> wrote:\n> Question?',
  );
  assert.equal(text, 'Yes.');
});

test('a sentence about writing, with no date, is not mistaken for an attribution', () => {
  const body = 'Am Montag schrieb mir Agnes Folgendes:\nDas Honorar steigt auf 5.000 €.';
  assert.equal(stripQuoted(body).text, body);
});

test('an Outlook header block is a cut, rule of underscores included', () => {
  const { text } = stripQuoted(
    'Bitte 5.000 €.\n\n________________________________\nVon: Agnes <agnes@example.test>\nGesendet: Montag, 3. November 2026 10:15\nAn: Rubén\nBetreff: Honorar\n\nAlt.',
  );
  assert.equal(text, 'Bitte 5.000 €.');
});

test('a forward is kept, since what it carries is usually new to the thread', () => {
  const body =
    'Siehe unten.\n\n---------- Weitergeleitete Nachricht ---------\nVon: Agentur <a@example.test>\nDate: Mon, 3 Nov 2026\n\nVertrag: 5.000 €, 14. März.';
  const { text } = stripQuoted(body);
  assert.match(text, /Vertrag: 5\.000 €, 14\. März\./);
});

test('German Gmail puts the name first, wrapped over two lines — seen live', () => {
  const { text } = stripQuoted(
    'Super, danke!\n\nManuel Telleria <manuel@example.test> schrieb am Di., 27. Okt.\n2026, 22:19:\n\n> Bestätigung anbei.',
  );
  assert.equal(text, 'Super, danke!');
});

test('the sentence right above a name-first attribution is kept', () => {
  const { text } = stripQuoted(
    'Super, danke!\nManuel Telleria <manuel@example.test> schrieb am Di., 27. Okt. 2026, 22:19:\n> alt',
  );
  assert.equal(text, 'Super, danke!');
});

test('an attribution wrapped after "<" is found — seen live', () => {
  const { text } = stripQuoted(
    'Thanks.\n\nOn Tue, 27 Oct 2026, 19:32 Fitzrovia Hotel Reservations, <\nfitzrovia@example.test> wrote:\n\nDear Manuel,',
  );
  assert.equal(text, 'Thanks.');
});

test('a forward keeps its header and body but not the history it quotes — seen live', () => {
  const body = [
    'Agnes, see below.',
    '',
    '---------- Forwarded message ---------',
    'From: Hotel <hotel@example.test>',
    'Date: Tue, 27 Oct 2026, 21:51',
    'Subject: Confirmation',
    'To: Manuel <manuel@example.test>',
    '',
    'Group ID 050127AK, 7 rooms held.',
    '',
    'On Tue, 27 Oct 2026, 20:47 Manuel <manuel@example.test> wrote:',
    '',
    'We would like to go ahead.',
  ].join('\n');
  const { text } = stripQuoted(body);
  assert.match(text, /From: Hotel/);
  assert.match(text, /Group ID 050127AK, 7 rooms held\./);
  assert.doesNotMatch(text, /go ahead/);
});

test('a signature after the delimiter is cut', () => {
  assert.equal(stripQuoted('Done.\n-- \nAgnes\n+49 123').text, 'Done.');
});

test('the thread is read oldest first, and only replies are stripped', async () => {
  const seen = stubThread([
    // Out of order on purpose: Gmail's order is not relied on.
    msg('m3', 3000, 'Agnes', 'Then 4.800 €, final.\n\nOn Tue, 4 Nov 2026 at 09:00, Rubén wrote:\n> 5.000?'),
    msg('m1', 1000, 'Agnes', 'Our offer: 4.000 €.\n\nOn Sun, 2 Nov 2026 at 08:00, Agency wrote:\n> outside history'),
    msg('m2', 2000, 'Rubén', '5.000?\n\nOn Mon, 3 Nov 2026 at 10:15, Agnes wrote:\n> Our offer: 4.000 €.'),
  ]);

  const thread = await readThread('tok', 't1');
  assert.match(seen[0], /\/users\/me\/threads\/t1\?format=full$/);
  assert.deepEqual(thread.messages.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(thread.total, 3);
  assert.equal(thread.next_message, null);

  // The first message keeps what it quotes: it is history from outside the
  // thread, and nothing else here would show it.
  assert.match(thread.messages[0].text, /outside history/);
  assert.equal(thread.messages[1].text, '5.000?');
  // The revision the whole tool exists to show, without the history around it.
  assert.equal(thread.messages[2].text, 'Then 4.800 €, final.');
  assert.ok(thread.messages[2].quoted_lines_removed > 0);
});

test('a draft is marked, because an unsent reply settles nothing', async () => {
  stubThread([
    msg('m1', 1000, 'Agnes', 'Offer: 4.000 €.'),
    msg('m2', 2000, 'Rubén', 'Accepted.', { labelIds: ['DRAFT'] }),
  ]);
  const thread = await readThread('tok', 't1');
  assert.equal(thread.messages[1].draft, true);
  assert.equal(thread.messages[0].draft, false);
});

test('an HTML-only reply is cut at the Gmail quote container', async () => {
  stubThread([
    msg('m1', 1000, 'Agnes', 'Offer'),
    msg(
      'm2',
      2000,
      'Rubén',
      '<div>Accepted at 4.500 €.</div><div class="gmail_quote"><div>On Mon, 3 Nov 2026, Agnes wrote:</div><blockquote>Offer</blockquote></div>',
      { html: true },
    ),
  ]);
  const thread = await readThread('tok', 't1');
  assert.equal(thread.messages[1].text, 'Accepted at 4.500 €.');
});

test('an HTML forward inside a quote container is kept', async () => {
  stubThread([
    msg('m1', 1000, 'Agnes', 'Offer'),
    msg(
      'm2',
      2000,
      'Rubén',
      '<div>FYI</div><div class="gmail_quote"><div>---------- Forwarded message ---------</div><div>Contract: 14 March</div></div>',
      { html: true },
    ),
  ]);
  const thread = await readThread('tok', 't1');
  assert.match(thread.messages[1].text, /Contract: 14 March/);
});

test('a long thread comes back in parts and says where to continue', async () => {
  const long = 'x'.repeat(Math.ceil(THREAD_BUDGET_CHARS / 3));
  stubThread([1, 2, 3, 4, 5].map((n) => msg(`m${n}`, n * 1000, 'Agnes', `${n} ${long}`)));

  const firstRead = await readThread('tok', 't1');
  assert.ok(firstRead.messages.length < 5);
  assert.equal(firstRead.next_message, firstRead.messages.length + 1);

  // Following next_message reaches every message exactly once.
  const positions = firstRead.messages.map((m) => m.position);
  let next = firstRead.next_message;
  while (next !== null) {
    const part = await readThread('tok', 't1', next);
    assert.equal(part.messages[0].position, next);
    positions.push(...part.messages.map((m) => m.position));
    next = part.next_message;
  }
  assert.deepEqual(positions, [1, 2, 3, 4, 5]);
});

test('one message longer than the budget is still returned, so paging advances', async () => {
  stubThread([msg('m1', 1000, 'Agnes', 'y'.repeat(THREAD_BUDGET_CHARS * 2))]);
  const thread = await readThread('tok', 't1');
  assert.equal(thread.messages.length, 1);
});

test('a malformed thread id is refused before any request is made', async () => {
  const seen = stubThread([]);
  await assert.rejects(readThread('tok', '../messages'), /thread_id/);
  assert.equal(seen.length, 0);
});

// --- What the tools say, where the rule is carried by the output ------------

const toolText = async (results, tool, args) => {
  const server = await createServer(async (op) => {
    if (op in results) return results[op];
    throw new Error(`unexpected ${op}`);
  }, []);
  return (await server._registeredTools[tool].handler(args)).content.map((c) => c.text).join('');
};

const threadMsg = (position, extra = {}) => ({
  position,
  id: `m${position}`,
  from: 'Agnes',
  to: 'Rubén',
  cc: null,
  date: `${position} Nov 2026`,
  draft: false,
  trashed: false,
  text: `message ${position}`,
  quoted_lines_removed: 0,
  attachments: [],
  ...extra,
});

test('a partial read says the rest may revise it, and where to continue', async () => {
  const text = await toolText(
    {
      read_thread: {
        id: 't1',
        subject: 'Honorar',
        total: 9,
        messages: [threadMsg(1), threadMsg(2)],
        next_message: 3,
      },
    },
    'read_thread',
    { thread_id: 't1' },
  );
  assert.match(text, /messages 1–2 of 9/);
  assert.match(text, /Not read yet: messages 3–9/);
  assert.match(text, /from_message 3/);
});

test('a whole read carries no continuation, and flags drafts and quote-only replies', async () => {
  const text = await toolText(
    {
      read_thread: {
        id: 't1',
        subject: 'Honorar',
        total: 2,
        messages: [threadMsg(1, { draft: true }), threadMsg(2, { text: '', quoted_lines_removed: 4 })],
        next_message: null,
      },
    },
    'read_thread',
    { thread_id: 't1' },
  );
  assert.match(text, /^# Honorar\n\n2 message\(s\)/);
  assert.match(text, /draft — never sent/);
  assert.match(text, /only quotes earlier messages/);
  assert.doesNotMatch(text, /Not read yet/);
});

const email = (id, thread_id) => ({
  id,
  thread_id,
  subject: 'Honorar',
  from: 'Agnes',
  to: 'Rubén',
  cc: null,
  date: '3 Nov 2026',
  snippet: null,
  text: 'Agreed.',
  attachments: [],
});

test('read_email points a reply at its thread, and a first message at nothing', async () => {
  const reply = await toolText({ read_email: email('m2', 't1') }, 'read_email', { email_id: 'm2' });
  assert.match(reply, /read_thread with thread_id t1/);

  const first = await toolText({ read_email: email('t1', 't1') }, 'read_email', { email_id: 't1' });
  assert.doesNotMatch(first, /read_thread/);
});

test('list_emails names the thread only for replies', async () => {
  const text = await toolText(
    { list_emails: { emails: [email('m2', 't1'), email('t9', 't9')] } },
    'list_emails',
    {},
  );
  assert.match(text, /id: m2 — reply in thread t1/);
  assert.match(text, /id: t9\n|id: t9$/);
  assert.doesNotMatch(text, /reply in thread t9/);
});
