/** Locating and editing the Claude Desktop config, without trampling it. */

import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ENTRY_NAME = "artist-notes";

/**
 * The development and testing override, matching ARTIST_MCP_TOKENS and
 * ARTIST_MCP_AGENTS_DIR. Without it there is no way to exercise the commands
 * that read this file except against the developer's own Claude Desktop config,
 * which a test suite has no business touching.
 */
/**
 * Where Claude Desktop keeps its config on Windows, which is not one place.
 *
 * A packaged install — the one that appears under `AppData\Local\Packages` —
 * has a **virtualised** `%APPDATA%`. Desktop reads
 * `…\Packages\Claude_<id>\LocalCache\Roaming\Claude\`, while this process
 * is an ordinary Node program whose `%APPDATA%` is the real `Roaming` folder.
 * Writing to the obvious path therefore produced two config files that were
 * each internally consistent and never the same one: `init` and `status` agreed
 * with each other about a grant that Claude Desktop had never seen.
 *
 * Found the hard way, and the symptom is maddening — every check passes and the
 * tools do not appear — so the packaged location wins when it exists rather
 * than being offered as a fallback.
 */
export const windowsConfigPath = (home: string): string => {
  const roaming = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const plain = join(roaming, "Claude", "claude_desktop_config.json");

  const packagesRoot =
    process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  try {
    const packages = readdirSync(join(packagesRoot, "Packages"))
      .filter((name) => /^Claude_/i.test(name))
      .map((name) =>
        join(
          packagesRoot,
          "Packages",
          name,
          "LocalCache",
          "Roaming",
          "Claude",
          "claude_desktop_config.json",
        ),
      );

    // An existing packaged config is the one Desktop reads. If more than one
    // package directory exists, prefer one that already holds a config over an
    // empty shell left by an uninstall.
    const written = packages.find((candidate) => existsSync(candidate));
    if (written) return written;

    // A packaged install with no config yet: still the right place to write,
    // since the plain path would be ignored.
    if (packages.length > 0 && !existsSync(plain)) return packages[0];
  } catch {
    // No Packages directory at all — an ordinary install. Fall through.
  }

  return plain;
};

export const configPath = (): string => {
  const override = process.env.ARTIST_MCP_CONFIG;
  if (override) return override;

  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return windowsConfigPath(home);
    default:
      // Claude Desktop ships on macOS and Windows only; this keeps the error
      // legible rather than writing a config nothing will ever read.
      throw new Error(
        `Claude Desktop has no config location on ${platform()}. ` +
          "Install on macOS or Windows.",
      );
  }
};

type Config = {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
};

/** Missing file is not an error — it's the first-install case. */
export const readConfig = async (path: string): Promise<Config> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as Config;
  } catch {
    throw new Error(
      `${path} is not valid JSON. Fix or move it, then run init again — ` +
        "refusing to overwrite a file that may hold your other MCP servers.",
    );
  }
};

export const writeConfig = async (path: string, config: Config): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};
