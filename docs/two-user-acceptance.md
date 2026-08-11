# Two-user acceptance test

This is the final MVP gate. It must use two real Microsoft accounts and two
separate machines. A database fixture cannot prove that Microsoft Graph returns
the correct person's OneNote pages or that the published package works outside
the maintainer checkout.

Do not paste connection keys, Microsoft tokens, private note titles, page IDs,
or note contents into GitHub, chat, screenshots, or the evidence record.

## People and test notes

- **User A:** the existing production user and machine.
- **User B:** Manu or another tester, using a separate machine and their own
  Supabase and Microsoft accounts.
- Each user creates one private OneNote page with a unique marker known only to
  that user. Do not share either page between the Microsoft accounts.

The marker can be a harmless sentence created only for this test. Record only
whether it was found, never the marker itself.

## User A baseline

On User A's machine:

1. Open [artist-mcp production](https://artist-mcp.vercel.app/), confirm
   Microsoft is connected, and generate a fresh connection key if needed.
2. Run the installed MCP in Claude Desktop or Codex.
3. Ask it to list OneNote pages and read User A's private test page.
4. Keep User A's private page ID available locally for the negative test. Do
   not send it through chat or store it in the repository.

Expected: User A sees and reads User A's marker.

## User B clean-machine install

On User B's separate machine:

1. Open [artist-mcp production](https://artist-mcp.vercel.app/) and sign in
   with User B's own email.
2. Connect User B's own Microsoft account and generate a connection key.
3. From a directory that does not contain this repository, verify the stable
   package and initialize it:

   ```bash
   npm view @manudota/artist-mcp version
   npx @manudota/artist-mcp@latest init
   ```

4. Restart Claude Desktop, or register the same package with Codex using the
   production commands shown on the website.
5. Ask the client to list OneNote pages and read User B's private test page.

Expected:

- `npm view` reports the current production version.
- The package installs without a repository checkout.
- User B sees and reads User B's marker.
- User B does not see User A's private page title or marker.

## Cross-account negative read

User A privately gives User B the private page ID only for the duration of this
test. User B invokes `read_note` with that exact ID through their own MCP
connection.

Expected: the read fails. It must not return User A's title, marker, or any page
content. A not-found response surfaced as a Graph error is a pass; returned
content is a release-blocking isolation failure.

Delete the copied page ID immediately after recording the result.

## Evidence record

Add this record to the verification section of `docs/mvp-brief.md` without
including private data:

```text
Date and timezone:
Production version:
User A machine/client:
User B machine/client:
User A own-page read: PASS / FAIL
User B own-page read: PASS / FAIL
User B list excluded User A page: PASS / FAIL
User B direct read of User A page ID: PASS / FAIL
No secrets or note content retained: YES / NO
Verified by:
```

Tick acceptance step 6 only when every result is `PASS` and no sensitive
evidence was retained.

## Cleanup

- Remove the temporary private OneNote pages if neither user wants to keep
  them.
- User B may keep artist-mcp connected for continued testing. Otherwise use
  **Disconnect** on the production dashboard; this removes the encrypted
  Microsoft refresh token and revokes every connection key without deleting
  anything from OneNote.
- Remove the local MCP entry with `npx @manudota/artist-mcp uninstall` if the
  machine should no longer run artist-mcp.

