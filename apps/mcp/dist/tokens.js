/**
 * Where this machine's provider credentials live.
 *
 * Custody moved here from the server deliberately: nothing outside this machine
 * can read these tokens, which is the whole point of the change. What that
 * buys is bounded and worth stating plainly — a `0600` file protects them from
 * other accounts on this computer, not from anything running as you. The OS
 * keychain would be stronger, and needs a native dependency this package
 * cannot take: it ships to npm standalone and must install without a compiler.
 *
 * The write path is the fragile part. Microsoft invalidates a refresh token the
 * moment it issues the replacement, so between spending the old one and storing
 * the new one there is an instant where the only usable credential exists in
 * memory. There is no server-side copy to fall back on any more. A crash or a
 * full disk there costs the user a reconnect, so writes go to a temporary file
 * and are renamed into place — rename is atomic within a filesystem, so a
 * reader sees either the old tokens or the new ones and never a half-written
 * file.
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const EMPTY = { version: 1, providers: {} };
/** Overridable so tests never touch the developer's real connections. */
export const tokensPath = () => process.env.ARTIST_MCP_TOKENS ?? join(homedir(), '.artist-mcp', 'tokens.json');
/**
 * A missing file is the not-yet-connected case, not an error. A corrupt one is
 * an error the user must see: silently starting from scratch would look like
 * "you were logged out" and hide whatever damaged the file.
 */
export const loadTokens = async () => {
    const path = tokensPath();
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return { ...EMPTY, providers: {} };
        throw err;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`${path} is not valid JSON. Move it aside and reconnect — refusing to ` +
            'overwrite it, in case it can still be recovered.');
    }
    if (parsed.version !== 1) {
        throw new Error(`${path} was written by a different version of this package (v${parsed.version}).`);
    }
    return { version: 1, providers: parsed.providers ?? {} };
};
/**
 * Replace the file atomically, with the restrictive mode applied to the
 * temporary file *before* it holds anything — creating it world-readable and
 * tightening afterwards would leave a window where the tokens are exposed.
 */
const writeTokens = async (file) => {
    const path = tokensPath();
    const temp = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
        // chmod explicitly: the mode above is masked by the process umask, so a
        // permissive umask would otherwise quietly widen it.
        await chmod(temp, 0o600);
        await rename(temp, path);
    }
    catch (err) {
        await unlink(temp).catch(() => { });
        throw err;
    }
};
export const readProvider = async (provider) => {
    const file = await loadTokens();
    return file.providers[provider];
};
/**
 * Store a provider's tokens, leaving the other provider's untouched — the two
 * connections are independent, and disconnecting Gmail must never cost the user
 * their OneNote connection.
 */
export const saveProvider = async (provider, tokens) => {
    const file = await loadTokens();
    await writeTokens({ ...file, providers: { ...file.providers, [provider]: tokens } });
};
/**
 * Update only the refresh token, preserving when the connection was made. This
 * is the rotation path and runs far more often than a fresh connect, so it must
 * not quietly reset the metadata the user sees.
 */
export const updateRefreshToken = async (provider, refreshToken) => {
    const file = await loadTokens();
    const existing = file.providers[provider];
    if (existing === undefined) {
        throw new Error(`No stored ${provider} connection to update.`);
    }
    await writeTokens({
        ...file,
        providers: { ...file.providers, [provider]: { ...existing, refreshToken } },
    });
};
export const clearProvider = async (provider) => {
    const file = await loadTokens();
    const remaining = { ...file.providers };
    delete remaining[provider];
    await writeTokens({ ...file, providers: remaining });
};
