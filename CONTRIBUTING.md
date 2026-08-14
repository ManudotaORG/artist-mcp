# Contributing

Thank you for considering it. This file describes what this repository actually
does, which is not the generic fork-and-PR-to-`develop` flow — following that
would produce a pull request that cannot merge.

## Reporting bugs

Search [the issues](https://github.com/ManudotaORG/artist-mcp/issues) first, then
open one with a title, a clear description, and the smallest thing that
reproduces it.

**Never paste OneNote page ids, note titles or contents, email subjects or
bodies, tokens, or refresh tokens into an issue.** The tool reads private
material, and a bug report is public. Describe the shape of the problem instead:
"a page with two conflicting dates", not the page.

## Suggesting enhancements

Open an issue first. Scope here is deliberately narrow and stated in
[CLAUDE.md](CLAUDE.md) and [docs/mvp-brief.md](docs/mvp-brief.md): everything is
read-only, one OneNote page is one working unit, and Gmail and Calendar are
supporting evidence rather than working units of their own. Proposals that add
writes, sending, synchronization, or background execution will be declined on
principle rather than on quality, so it is worth checking before building.

## Pull requests

There is no `develop` branch and no forking needed for maintainers.

- Work on `release`. It is the integration branch and the only one that accepts
  pushes; CI runs lint, both test suites, and every build there.
- `staging` and `main` are protected and receive work only through pull requests
  from `release`. A direct push is rejected, and would skip the commit-message
  check, which runs only on pull requests.
- Outside contributors: fork, branch from `release`, and open the pull request
  against `release`.

Before pushing:

```bash
pnpm install
pnpm test
```

`pnpm test` runs exactly what CI runs, so a pass locally is a pass there. Verify
behaviour locally too rather than promoting to test it — see the branch and
deployment workflow in [docs/development.md](docs/development.md).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), **enforced** — not
loosely followed. Husky checks the message on commit and CI checks every commit
in a pull request, so a non-conforming message fails rather than being tidied
later.

The scope is the workspace: `feat(mcp):`, `fix(web):`, or bare `docs:` and
`chore:` for repository-wide changes. Release Please reads these to decide the
next version, so `feat` and `fix` are not interchangeable, and a `!` or a
`BREAKING CHANGE:` footer cuts a major — do not add one for a change no released
version exposed.

Say why in the body, not just what. The diff already shows what changed.

## Style

- Read the closest `AGENTS.md` to the code you are touching. `apps/web` has
  enforced conventions of its own; `apps/mcp` is plain Node and must not import
  from other workspace packages, because it ships to npm standalone.
- Workflow Markdown under `apps/mcp/agent-pack` is executable policy, not
  documentation. Changing it means regenerating `registry.json` — the build does
  this — and a test asserts the committed registry still matches.

## Questions

Open an issue.
