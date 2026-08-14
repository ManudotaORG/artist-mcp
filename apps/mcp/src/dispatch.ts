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
import { mapAttachment, readAttachment } from './attachments.js';
import { listEvents, readEvent } from './calendar.js';
import { listEmails, readEmail } from './mail.js';
import { listNotes, readNote } from './notes.js';
import { accessTokenFor } from './oauth.js';
import { type ProviderName, loadTokens } from './tokens.js';

export type Operation =
  | 'list_notes'
  | 'read_note'
  | 'list_emails'
  | 'read_email'
  | 'read_attachment'
  | 'map_attachment'
  | 'list_events'
  | 'read_event';

const PROVIDER_FOR: Record<Operation, ProviderName> = {
  list_notes: 'microsoft',
  read_note: 'microsoft',
  list_emails: 'google',
  read_email: 'google',
  read_attachment: 'google',
  map_attachment: 'google',
  list_events: 'google',
  read_event: 'google',
};

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

export const call = async <T>(
  op: Operation,
  params: Record<string, unknown> = {},
): Promise<T> => {
  const token = await accessTokenFor(PROVIDER_FOR[op]);

  switch (op) {
    case 'list_notes':
      return (await listNotes(token)) as T;
    case 'read_note':
      return (await readNote(token, params.note_id)) as T;
    case 'list_emails':
      return (await listEmails(token, params.query)) as T;
    case 'read_email':
      return (await readEmail(token, params.email_id)) as T;
    case 'map_attachment':
      return (await mapAttachment(token, params.email_id, params.attachment_id)) as T;
    case 'read_attachment':
      return (await readAttachment(
        token,
        params.email_id,
        params.attachment_id,
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
    default:
      // Unreachable through the tool definitions, which name every operation.
      throw new GraphError(`Unknown operation ${String(op)}.`, false);
  }
};
