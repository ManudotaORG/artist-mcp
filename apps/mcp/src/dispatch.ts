/**
 * Where an operation is carried out, now that it happens here.
 *
 * This replaces a POST to the edge function. The seam is deliberately the same
 * shape — one `call(op, params)` that the server uses for everything — so the
 * tool definitions did not have to change alongside the thing that changed.
 *
 * The operation decides the provider, which matters for the same reason it did
 * on the server: a Gmail call must never spend a Microsoft token, and a missing
 * Google connection has to be reported as such rather than surfacing as an
 * unrelated Microsoft error.
 */

import { GraphError } from './client.js';
import { recordWrite, type RecordWrite } from './audit.js';
import { gmailLoader, mapAttachment, readAttachment } from './attachments.js';
import { oneNoteLoader } from './page-attachments.js';
import {
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  previewDeleteEvent,
  previewEvent,
  previewRescheduleEvent,
  readEvent,
  rescheduleEvent,
} from './calendar.js';
import { listEmails, readEmail } from './mail.js';
import { listNotes, mapNotes, readNote } from './notes.js';
import { applyEdit, previewEdit } from './onenote-patch.js';
import { createPage, previewPage } from './onenote-write.js';
import { accessTokenFor } from './oauth.js';
import { type ProviderName, loadTokens } from './tokens.js';

/**
 * Every operation this server can carry out, with its provider and its effect.
 *
 * One table rather than a union beside a lookup, because the two would be two
 * lists that have to agree, and the interesting failure is exactly the one
 * where they quietly stop agreeing. `Operation` is derived from it.
 *
 * `effect` is not decoration. Until the first write shipped, the read-only
 * boundary rested on OAuth scopes: a read-only token could not write whatever
 * the code did. Google publishes no insert-only Calendar scope, so a token that
 * may create an event may also update and delete one, and this table plus the
 * grant check are what stand in place of that. See
 * docs/decisions/0001-opt-in-calendar-writes.md.
 *
 * Adding a row is a boundary change, not a feature. `test/operation-boundary`
 * fails on any edit to this table so that the change has to be deliberate.
 */
export const OPERATIONS = {
  list_notes: { provider: 'microsoft', effect: 'read' },
  map_notes: { provider: 'microsoft', effect: 'read' },
  read_note: { provider: 'microsoft', effect: 'read' },
  list_emails: { provider: 'google', effect: 'read' },
  read_email: { provider: 'google', effect: 'read' },
  read_gmail_attachment: { provider: 'google', effect: 'read' },
  map_gmail_attachment: { provider: 'google', effect: 'read' },
  // Separate rows rather than a source parameter on the two above. The token is
  // resolved from this table before the call is made, so one operation cannot
  // span two providers without breaking the rule that a Gmail call never spends
  // a Microsoft token. The model still sees two tools; see issue #70.
  read_page_attachment: { provider: 'microsoft', effect: 'read' },
  map_page_attachment: { provider: 'microsoft', effect: 'read' },
  list_events: { provider: 'google', effect: 'read' },
  read_event: { provider: 'google', effect: 'read' },
  list_calendars: { provider: 'google', effect: 'read' },
  // Reads the day and renders what would be written. A read, despite the name:
  // it changes nothing, and marking it a write would gate the very thing that
  // has to happen before a write is allowed.
  preview_calendar_event: { provider: 'google', effect: 'read' },
  create_calendar_event: { provider: 'google', effect: 'write' },
  // Reads the event so a deletion is confirmed against what is really there.
  preview_calendar_delete: { provider: 'google', effect: 'read' },
  delete_calendar_event: { provider: 'google', effect: 'write' },
  // Reads both halves — the event as it stands and the day it would move to.
  preview_calendar_reschedule: { provider: 'google', effect: 'read' },
  // One row, two writes: it creates the replacement and removes the original.
  // Not a third capability. It is gated on holding *both* calendar-create and
  // calendar-delete, because it is exactly those two writes and nothing more,
  // and a separate grant would mean asking every hosted user to consent again
  // for permission they have already given.
  reschedule_calendar_event: { provider: 'google', effect: 'write' },
  // Renders the page and resolves which section it would land in. A read, like
  // the calendar previews: it changes nothing.
  preview_onenote_page: { provider: 'microsoft', effect: 'read' },
  // The first write to the knowledge base rather than to supporting evidence,
  // and the only write row whose narrowness is not this table's doing:
  // `Notes.Create` cannot express an edit or a delete, so there is no sibling
  // row here to refuse. See docs/decisions/0003-onenote-writes.md.
  create_onenote_page: { provider: 'microsoft', effect: 'write' },
  // Reads the page and shows the change against what is actually written there
  // now. A read, and necessarily so: it is what has to happen before a write is
  // allowed, and gating it would gate the safeguard rather than the danger.
  preview_onenote_edit: { provider: 'microsoft', effect: 'read' },
  // The first row here that can destroy something. Both actions ride one row
  // and one grant because no scope separates them, so the distinction is made
  // where it can be enforced — in the operation itself, where a replace cannot
  // proceed unless what it would overwrite has been captured first.
  // See docs/decisions/0004-onenote-page-maintenance.md.
  edit_onenote_page: { provider: 'microsoft', effect: 'write' },
} as const satisfies Record<string, { provider: ProviderName; effect: 'read' | 'write' }>;

export type Operation = keyof typeof OPERATIONS;

/** Kept as its own export: callers ask "which token" far more than "which effect". */
const PROVIDER_FOR: Record<Operation, ProviderName> = Object.fromEntries(
  Object.entries(OPERATIONS).map(([op, meta]) => [op, meta.provider]),
) as Record<Operation, ProviderName>;

/**
 * The operations a grant is required for. Empty today; the guard test asserts
 * that it is exactly the set of rows marked `write`, so it cannot fall behind
 * the table.
 */
export const WRITE_OPERATIONS: Operation[] = (
  Object.entries(OPERATIONS) as [Operation, { effect: string }][]
)
  .filter(([, meta]) => meta.effect === 'write')
  .map(([op]) => op);

/**
 * What this machine can currently do, without spending a network call to find
 * out. `init` uses it to say whether an install is finished.
 */
export const connectedProviders = async (): Promise<ProviderName[]> => {
  const { providers } = await loadTokens();
  return (Object.keys(providers) as ProviderName[]).filter(
    (name) => providers[name] !== undefined,
  );
};

/**
 * Where the access token for a provider comes from.
 *
 * Injected because that is the one thing custody changes. On this machine it is
 * `accessTokenFor`, reading ~/.artist-mcp and refreshing in a single process.
 * Hosted it resolves against whichever user the request authenticated as. The
 * operation table below is identical either way, which is the property worth
 * keeping: a Gmail call must never spend a Microsoft token, and that rule is
 * stated once regardless of where the token was found.
 */
export type ResolveToken = (provider: ProviderName) => Promise<string>;

export const dispatchWith =
  (resolve: ResolveToken, record: RecordWrite = recordWrite) =>
  async <T>(op: Operation, params: Record<string, unknown> = {}): Promise<T> => {
    const token = await resolve(PROVIDER_FOR[op]);

    switch (op) {
      case 'list_notes':
        return (await listNotes(token)) as T;
      case 'map_notes':
        // The pages are chosen by the caller, which is where the notebook scope
        // is settled; nothing here maps a notebook it was not given.
        return (await mapNotes(token, params.pages as Parameters<typeof mapNotes>[1])) as T;
      case 'read_note':
        return (await readNote(token, params.note_id, params.from_part)) as T;
      case 'list_emails':
        return (await listEmails(token, params.query)) as T;
      case 'read_email':
        return (await readEmail(token, params.email_id)) as T;
      case 'map_gmail_attachment':
        return (await mapAttachment(
          gmailLoader(token, params.email_id, params.attachment_id),
          'read_gmail_attachment',
        )) as T;
      case 'read_gmail_attachment':
        return (await readAttachment(
          gmailLoader(token, params.email_id, params.attachment_id),
          params.from_page,
          params.page_count,
        )) as T;
      case 'map_page_attachment':
        return (await mapAttachment(
          oneNoteLoader(token, params.note_id, params.attachment_id),
          'read_page_attachment',
        )) as T;
      case 'read_page_attachment':
        return (await readAttachment(
          oneNoteLoader(token, params.note_id, params.attachment_id),
          params.from_page,
          params.page_count,
        )) as T;
      case 'list_events':
        return (await listEvents(
          token,
          params.calendar_id,
          params.query,
          params.time_min,
          params.time_max,
        )) as T;
      case 'read_event':
        return (await readEvent(token, params.event_id, params.calendar_id)) as T;
      case 'preview_calendar_event':
        return (await previewEvent(token, params)) as T;
      case 'create_calendar_event':
        return (await createEvent(token, params, record)) as T;
      case 'preview_calendar_delete':
        return (await previewDeleteEvent(token, params)) as T;
      case 'delete_calendar_event':
        return (await deleteEvent(token, params, record)) as T;
      case 'preview_calendar_reschedule':
        return (await previewRescheduleEvent(token, params)) as T;
      case 'reschedule_calendar_event':
        return (await rescheduleEvent(token, params, record)) as T;
      case 'preview_onenote_page':
        return (await previewPage(token, params)) as T;
      case 'create_onenote_page':
        return (await createPage(token, params, record)) as T;
      case 'preview_onenote_edit':
        return (await previewEdit(token, params)) as T;
      case 'edit_onenote_page':
        return (await applyEdit(token, params, record)) as T;
      case 'list_calendars':
        // No parameters by design: the whole value is knowing the full set, and
        // a filtered list of what exists is the reach problem again.
        return (await listCalendars(token)) as T;
      default:
        // Unreachable through the tool definitions, which name every operation.
        throw new GraphError(`Unknown operation ${String(op)}.`, false);
    }
  };

/** The local dispatcher: this machine's own connections, one process, one user. */
export const call = dispatchWith(accessTokenFor);
