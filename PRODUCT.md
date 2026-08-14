# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent musicians and artist teams who manage concerts, rehearsals, studio sessions, contacts, and near-term follow-up alongside their creative work.

## Product Purpose

artist-mcp connects a musician's OneNote pages to Claude Desktop or Codex. The user authorizes Microsoft once, chooses a OneNote page as the working unit, and asks the AI client to read the live project context and return one useful next result in chat.

## Positioning

The product adds narrow, installable musician-workflow playbooks to live OneNote context without copying the artist's project data into a second system. Roles and project types are plain Markdown loaded at runtime, and a musician can run their own instead: one install keeps the shipped, checksummed pack, the other copies all of it somewhere they own, where every playbook is theirs to edit and they can add their own.

## Operating Context

Users move between live performance, studio work, and practical production administration. Their OneNote pages contain project facts, milestones, tasks, and contacts. Claude or Codex coordinates the read-only workflow; the user reviews and performs every external action.

## Capabilities and Constraints

- Microsoft OAuth with `Notes.Read`, `offline_access`, and `User.Read`.
- Google OAuth with `gmail.readonly` and `calendar.events.readonly`, offline access, as a separate and optional connection. The narrower events scope is deliberate: calendar metadata, sharing and settings are not read.
- One OneNote page is one working unit.
- Read-only OneNote page listing and reading.
- Read-only Gmail search and message reading, as supporting evidence for a OneNote working unit. An email thread is never itself a working unit.
- Read-only Google Calendar event listing and reading, as supporting evidence. Recurring occurrences are expanded and flagged; times are always reported with their zone. A calendar entry is never itself a working unit.
- Where a page and a source disagree, both are reported with their source named. Nothing picks a winner.
- Either connection stands alone: a user may connect OneNote, Gmail, or both, and disconnecting one leaves the other working.
- Checksummed runtime registry of seven roles and four starter project types, or a directory of the musician's own layered over it.
- Results appear only in chat.
- No writes to any source: no OneNote edits, message sending, replying, drafting, labelling, calendar creation or editing, RSVP responses, background jobs, synchronization, or workflow state in Supabase.
- No availability computation or scheduling suggestions; reading a calendar is not planning against it.
- Operator access is no longer a limit, and this line used to say it was. The hosted design had a service role that could resolve any connection key to the credential behind it, so anyone holding that credential could technically reach connected account data — bounded by policy rather than cryptography. [#22](https://github.com/ManudotaORG/artist-mcp/issues/22) removed the mechanism: sign-in happens on the user's own machine, the refresh tokens stay there, and no deployed credential can read them. `connections` and `mcp_keys` remain in the schema, dormant and unwritten.
- The limit that replaced it is smaller and stated plainly to users: tokens sit in a file readable by the user's own account (`~/.artist-mcp/tokens.json`, mode `0600`) rather than the OS keychain, which would need a native dependency the package cannot take. Anything already running as that user can use the token — reading their notes takes code on their specific machine, not a query someone could run against every user at once.
- The authentication, Claude Desktop, and Codex installation flows must remain functional. There is no connection key to keep working; the installer stopped asking for one.

## Brand Commitments

- Product name: artist-mcp.
- Voice: direct, calm, practical, and respectful of the musician's attention.
- The public site should introduce the product before sign-in; the authenticated state should operate as a focused connection dashboard.
- A new identity may be created from scratch and should unite live performance, studio precision, and the production desk.

## Evidence on Hand

- Real OneNote project pages include concert names, dates, venues, expected audience, project leads, budgets, descriptions, milestones, tasks, musicians, roles, instruments, and contact details.
- Working Microsoft connection and published npm package.
- No testimonials, customer logos, performance benchmarks, pricing, or artist photography are available; future work must not fabricate them.

## Product Principles

- Keep the artist focused on one useful next action.
- Read live source context instead of creating a stale copy.
- Make every external action human-reviewed and human-executed.
- Keep workflow policy legible and changeable as Markdown.
- Explain trust boundaries in plain language, including the ones not yet solved. Never claim a stronger guarantee than the architecture provides.

## Accessibility & Inclusion

The web experience must remain keyboard accessible, responsive, legible at browser zoom, and clear without relying on color alone.
