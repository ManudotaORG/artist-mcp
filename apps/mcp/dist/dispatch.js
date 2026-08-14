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
import { loadTokens } from './tokens.js';
const PROVIDER_FOR = {
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
export const connectedProviders = async () => {
    const { providers } = await loadTokens();
    return Object.keys(providers).filter((name) => providers[name] !== undefined);
};
export const call = async (op, params = {}) => {
    const token = await accessTokenFor(PROVIDER_FOR[op]);
    switch (op) {
        case 'list_notes':
            return (await listNotes(token));
        case 'read_note':
            return (await readNote(token, params.note_id));
        case 'list_emails':
            return (await listEmails(token, params.query));
        case 'read_email':
            return (await readEmail(token, params.email_id));
        case 'map_attachment':
            return (await mapAttachment(token, params.email_id, params.attachment_id));
        case 'read_attachment':
            return (await readAttachment(token, params.email_id, params.attachment_id, params.from_page, params.page_count));
        case 'list_events':
            return (await listEvents(token, params.calendar_id, params.query, params.time_min, params.time_max));
        case 'read_event':
            return (await readEvent(token, params.event_id, params.calendar_id));
        default:
            // Unreachable through the tool definitions, which name every operation.
            throw new GraphError(`Unknown operation ${String(op)}.`, false);
    }
};
