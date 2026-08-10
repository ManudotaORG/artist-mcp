import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

const b64url = (buf: Buffer) => buf.toString('base64url');

/** PKCE verifier: 43-128 chars of unreserved characters. */
export function codeVerifier(): string {
  return b64url(randomBytes(64));
}

export function codeChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

/** CSRF token for the OAuth `state` parameter. */
export function stateToken(): string {
  return b64url(randomBytes(32));
}

/**
 * The connection key the user pastes into the installer.
 *
 * Prefixed so it's recognisable in a support conversation, and so a leaked one
 * can be spotted by a secret scanner. Only the sha256 is ever stored.
 */
export function connectionKey(): string {
  return `amcp_${b64url(randomBytes(32))}`;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
