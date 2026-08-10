import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

const b64url = (buf: Buffer) => buf.toString('base64url');

/** PKCE verifier: 43-128 chars of unreserved characters. */
export const codeVerifier = (): string => b64url(randomBytes(64));

export const codeChallenge = (verifier: string): string =>
  b64url(createHash('sha256').update(verifier).digest());

/** CSRF token for the OAuth `state` parameter. */
export const stateToken = (): string => b64url(randomBytes(32));

/**
 * The connection key the user pastes into the installer.
 *
 * Prefixed so it's recognisable in a support conversation, and so a leaked one
 * can be spotted by a secret scanner. Only the sha256 is ever stored.
 */
export const connectionKey = (): string => `amcp_${b64url(randomBytes(32))}`;

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');
