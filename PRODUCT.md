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

Users move between live performance, studio work, and practical production administration. Their OneNote pages contain project facts, milestones, tasks, and contacts. Claude or Codex coordinates the workflow; the user reviews every change it proposes and performs every other external action themselves.

## Capabilities and Constraints

- Microsoft OAuth with `Notes.Read`, `offline_access`, and `User.Read`.
- Google OAuth with `gmail.readonly`, `calendar.events.readonly` and `calendar.calendarlist.readonly`, offline access, as a separate and optional connection. A granted calendar capability widens the events scope to `calendar.events`. The narrower events scope is deliberate: calendar metadata, sharing and settings are not read.
- One OneNote page is one working unit.
- Read-only OneNote page listing and reading.
- Read-only Gmail search and message reading, as supporting evidence for a OneNote working unit. An email thread is never itself a working unit.
- Read-only Google Calendar event listing and reading, as supporting evidence. Recurring occurrences are expanded and flagged; times are always reported with their zone. A calendar entry is never itself a working unit.
- Where a page and a source disagree, both are reported with their source named. Nothing picks a winner.
- Either connection stands alone: a user may connect OneNote, Gmail, or both, and disconnecting one leaves the other working.
- Checksummed runtime registry of seven roles and four starter project types, or a directory of the musician's own layered over it.
- Results appear only in chat.
- No writes to any source apart from the opt-ins below: no message sending, replying, drafting, labelling, RSVP responses, deletion of anything the musician wrote, background jobs, synchronization, or workflow state in Supabase.
- Four exceptions, opt-in per install by name and off by default: creating a single Google Calendar event; deleting an event this tool itself created — never one the musician made or that was shared with them; creating a OneNote page; and editing a OneNote page this tool itself created, which Microsoft enforces rather than this code. Each is previewed and confirmed before it goes through, and a capability that was not granted registers no tool at all. A gig that lives on a page and never reaches the calendar makes the musician the sync layer, which is the thing this product exists to stop being true. It went first because a wrong calendar event is deleted in two seconds and a corrupted OneNote page is not. See [docs/decisions](docs/decisions), records 0001 and 0003 to 0006.
- No availability computation or scheduling suggestions; reading a calendar is not planning against it.
- Operator access is not a limit for the published package: sign-in happens on the user's own machine, the refresh tokens stay there, and no deployed credential can read them. [#22](https://github.com/ManudotaORG/artist-mcp/issues/22) removed the mechanism that made it one.
- It *is* a limit for the hosted server, deliberately and visibly. [#55](https://github.com/ManudotaORG/artist-mcp/issues/55) added a remote MCP for clients that cannot run a local process, and acting for someone while their machine is off means holding their credentials. Tokens are encrypted at rest with a key the database never holds, and only the service role can decrypt them — which narrows who can read them without reducing it to nobody. Hosted users are told exactly that before they consent, access is arranged directly rather than signed up for, and the published package has no way to be pointed at a hosted server. The two custody models are separate offerings, not one product with a setting.
- The limit that replaced it is smaller and stated plainly to users: tokens sit in a file readable by the user's own account (`~/.artist-mcp/tokens.json`, mode `0600`) rather than the OS keychain, which would need a native dependency the package cannot take. Anything already running as that user can use the token — reading their notes takes code on their specific machine, not a query someone could run against every user at once.
- The authentication, Claude Desktop, and Codex installation flows must remain functional. There is no connection key to keep working; the installer stopped asking for one.

## Brand Commitments

- Product name: artist-mcp.
- Voice: direct, calm, practical, and respectful of the musician's attention.
- The public site introduces the product and offers no sign-in: accounts are arranged directly, so a form that refuses every visitor would be a promise not kept. The signed-in state shows what a hosted account has connected, and lets that person connect or disconnect it themselves.
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
