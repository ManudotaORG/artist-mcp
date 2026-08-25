import assert from 'node:assert/strict';
import test from 'node:test';

import { browserOpener } from '../dist/oauth.js';

/**
 * The consent URL is built by URLSearchParams, so it is full of `&`.
 *
 * On Windows this used to run through `cmd /c start <url>`, where `&` is a
 * command separator: the browser received everything up to the first parameter
 * and nothing after it — no scope, no response_type, no redirect_uri — and
 * Microsoft answered AADSTS900144. Reported from a real Windows install; no
 * test in this suite runs on Windows, which is why the platform decision is now
 * a value that can be asserted from anywhere.
 */
const URL_WITH_PARAMS =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
  '?client_id=abc&response_type=code&scope=offline_access%20Notes.Read&state=xyz';

test('no platform hands the URL to a shell', () => {
  for (const os of ['win32', 'darwin', 'linux', 'freebsd']) {
    const { command } = browserOpener(os, URL_WITH_PARAMS);
    assert.ok(
      !/^(cmd|start|sh|bash|powershell)$/i.test(command),
      `${os} opens the browser through ${command}, which parses the URL`,
    );
  }
});

test('the whole URL survives as one argument, ampersands included', () => {
  for (const os of ['win32', 'darwin', 'linux']) {
    const { args } = browserOpener(os, URL_WITH_PARAMS);
    assert.ok(
      args.includes(URL_WITH_PARAMS),
      `${os} does not pass the URL intact: ${JSON.stringify(args)}`,
    );
    // The parameters that were lost. Their absence is what the user saw.
    const passed = args.find((a) => a.startsWith('https://'));
    assert.match(passed, /scope=/);
    assert.match(passed, /response_type=/);
  }
});

test('Windows opens the default handler directly', () => {
  const { command, args } = browserOpener('win32', URL_WITH_PARAMS);
  assert.equal(command, 'rundll32');
  assert.equal(args[0], 'url.dll,FileProtocolHandler');
});

test('macOS and Linux keep the openers they had', () => {
  assert.equal(browserOpener('darwin', 'x').command, 'open');
  assert.equal(browserOpener('linux', 'x').command, 'xdg-open');
});
