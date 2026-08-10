/** Locating and editing the Claude Desktop config, without trampling it. */
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const ENTRY_NAME = "artist-notes";
export function configPath() {
    const home = homedir();
    switch (platform()) {
        case "darwin":
            return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
        case "win32":
            return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
        default:
            // Claude Desktop ships on macOS and Windows only; this keeps the error
            // legible rather than writing a config nothing will ever read.
            throw new Error(`Claude Desktop has no config location on ${platform()}. ` +
                "Install on macOS or Windows.");
    }
}
/** Missing file is not an error — it's the first-install case. */
export async function readConfig(path) {
    let raw;
    try {
        raw = await readFile(path, "utf8");
    }
    catch (err) {
        if (err.code === "ENOENT")
            return {};
        throw err;
    }
    if (raw.trim() === "")
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new Error(`${path} is not valid JSON. Fix or move it, then run init again — ` +
            "refusing to overwrite a file that may hold your other MCP servers.");
    }
}
export async function writeConfig(path, config) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
