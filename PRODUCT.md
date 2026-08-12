# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent musicians and artist teams who manage concerts, rehearsals, studio sessions, contacts, and near-term follow-up alongside their creative work.

## Product Purpose

artist-mcp connects a musician's OneNote pages to Claude Desktop or Codex. The user authorizes Microsoft once, chooses a OneNote page as the working unit, and asks the AI client to read the live project context and return one useful next result in chat.

## Positioning

The product adds narrow, installable musician-workflow playbooks to live OneNote context without copying the artist's project data into a second system. Roles and project types are plain Markdown loaded at runtime.

## Operating Context

Users move between live performance, studio work, and practical production administration. Their OneNote pages contain project facts, milestones, tasks, and contacts. Claude or Codex coordinates the read-only workflow; the user reviews and performs every external action.

## Capabilities and Constraints

- Microsoft OAuth with `Notes.Read`, `offline_access`, and `User.Read`.
- Google OAuth with `gmail.readonly`, offline access, as a separate and optional connection.
- One OneNote page is one working unit.
- Read-only OneNote page listing and reading.
- Read-only Gmail search and message reading, as supporting evidence for a OneNote working unit. An email thread is never itself a working unit.
- Either connection stands alone: a user may connect OneNote, Gmail, or both, and disconnecting one leaves the other working.
- Checksummed runtime registry of seven roles and four starter project types.
- Results appear only in chat.
- No OneNote or Gmail writes, message sending, replying, drafting, labelling, calendar editing, background jobs, synchronization, or workflow state in Supabase.
- The existing authentication, connection-key, Claude Desktop, and Codex installation flows must remain functional.

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
- Explain trust boundaries in plain language.

## Accessibility & Inclusion

The web experience must remain keyboard accessible, responsive, legible at browser zoom, and clear without relying on color alone.
