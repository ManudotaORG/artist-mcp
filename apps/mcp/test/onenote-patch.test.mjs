import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendCommand,
  extractElement,
  isGeneratedId,
  paragraph,
  preImage,
  readTargets,
  replaceCommand,
} from '../dist/onenote-patch.js';

const GUID = '33f8a242-7c33-4bb2-90c5-8425a68cc5bf';
const para = `p:{${GUID}}{40}`;
const nested = `div:{${GUID}}{42}:{${GUID}}{45}`;

test('generated ids are told apart from anything else', () => {
  assert.ok(isGeneratedId(para));
  assert.ok(isGeneratedId(nested), 'a div inside a div carries a doubled id');
  assert.ok(!isGeneratedId('intro'), 'an author-supplied data-id is not one');
  assert.ok(!isGeneratedId('#intro'));
  assert.ok(!isGeneratedId('body'), 'body is a keyword, not an element id');
  assert.ok(!isGeneratedId(`p:{${GUID}}`), 'the trailing index is part of the shape');
});

test('both kinds of target are read back, and kept apart', () => {
  // The page HTML as Graph returns it with includeIDs=true: our data-id
  // survives the round trip, and Graph adds its own id alongside it.
  const html = `<div data-id="intro" id="div:{${GUID}}{32}"><p data-id="fee" id="${para}">1200</p></div>`;
  const targets = readTargets(html);

  assert.deepEqual(targets.dataIds, ['intro', 'fee']);
  assert.deepEqual(targets.generatedIds, [`div:{${GUID}}{32}`, para]);
});

test('ids that are not Graph-generated are not offered as replace targets', () => {
  // Input HTML ids are discarded by the API, so an id like this in the output
  // is not a target and must not be mistaken for one.
  assert.deepEqual(readTargets('<p id="intro">x</p>').generatedIds, []);
});

test('a pre-image captures the whole element, children and all', () => {
  const html =
    `<div id="div:{${GUID}}{32}"><p>A</p><div id="${nested}"><p>B</p></div><p>C</p></div><p>after</p>`;

  assert.equal(
    extractElement(html, 'id', `div:{${GUID}}{32}`),
    `<div id="div:{${GUID}}{32}"><p>A</p><div id="${nested}"><p>B</p></div><p>C</p></div>`,
    'a lazy match would stop at the inner </div> and truncate the capture',
  );
  assert.equal(extractElement(html, 'id', nested), `<div id="${nested}"><p>B</p></div>`);
});

test('self-closing children do not unbalance the count', () => {
  const html = `<div id="div:{${GUID}}{32}"><img src="x"/><br/><p>A</p></div>`;
  assert.equal(extractElement(html, 'id', `div:{${GUID}}{32}`), html);
});

test('unbalanced markup yields nothing rather than a guess', () => {
  assert.equal(extractElement(`<div id="${nested}"><p>A</p>`, 'id', nested), undefined);
  assert.equal(extractElement('<p>A</p>', 'id', para), undefined);
});

test('a replace refuses to proceed when the pre-image cannot be captured', () => {
  // The whole basis of 0004: no capture, no write. This must throw rather than
  // return empty, so no caller can carry on with `?? ''`.
  assert.throws(() => preImage('<p>nothing matching</p>', para), /could not be read back/);
  assert.throws(() => preImage(`<p id="${para}">x</p>`, 'intro'), /not a generated element id/);
});

test('a captured pre-image is the element as it stood', () => {
  const html = `<div><p id="${para}">Fee: 1200</p></div>`;
  assert.equal(preImage(html, para), `<p id="${para}">Fee: 1200</p>`);
});

test('replace will not accept a data-id', () => {
  // Graph allows data-id for a replace on images and objects only. Translating
  // it silently would build a command that looks right and hits the wrong thing.
  assert.throws(() => replaceCommand('fee', paragraph('x')), /must name a generated element id/);
  assert.throws(() => replaceCommand('#fee', paragraph('x')), /must name a generated element id/);
  assert.deepEqual(replaceCommand(para, '<p>x</p>'), {
    target: para,
    action: 'replace',
    content: '<p>x</p>',
  });
});

test('append prefixes a data-id and leaves keywords and generated ids bare', () => {
  // The missing '#' is what produced 20134 for every element across two probe
  // runs, and 20134 reads as "this element cannot be edited".
  assert.equal(appendCommand('intro', '<p>x</p>').target, '#intro');
  assert.equal(appendCommand('#intro', '<p>x</p>').target, '#intro', 'idempotent');
  assert.equal(appendCommand('body', '<p>x</p>').target, 'body');
  assert.equal(appendCommand(nested, '<p>x</p>').target, nested);
  assert.throws(() => appendCommand('title', '<p>x</p>'), /cannot be appended to/);
});

test('text written into a page is escaped', () => {
  assert.equal(
    paragraph('Fee & rider <script>alert("x")</script>'),
    '<p>Fee &amp; rider &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>',
  );
  assert.equal(paragraph('line one\nline two'), '<p>line one<br/>line two</p>');
  assert.throws(() => paragraph('   '), /no text to write/);
});
