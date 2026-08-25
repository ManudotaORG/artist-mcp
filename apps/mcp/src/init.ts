import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_EDITABLE_DIRECTORY, describeSeed, seedEditablePack } from "./agents.js";
import { isStagingVersion, packageVersion } from "./client.js";
import { configPath, ENTRY_NAME, readConfig, writeConfig } from "./config.js";
import { connectedProviders } from "./dispatch.js";
import { describeGrants, setGrants, type WriteCapability } from "./grants.js";

const PACKAGE = "@manudota/artist-mcp";
const LOCAL_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));

/**
 * Register the dist-tag this copy came from, not a bare package name.
 *
 * `npx @manudota/artist-mcp@staging init` runs the staging build, so it
 * verifies the key against staging — but writing an untagged spec meant the
 * installed entry resolved to `latest` and called production on every restart.
 * The install then failed as "Invalid connection key", blaming the one thing
 * that was correct.
 */
const packageSpec = (version: string = packageVersion): string =>
  isStagingVersion(version) ? `${PACKAGE}@staging` : PACKAGE;

type InitOptions = {
  local?: boolean;
  /**
   * Writes this install may perform. Recorded in the entry's args so that the
   * grant is visible where a user will look, and so the server it spawns learns
   * it the same way it learns the playbook directory.
   */
  grants?: readonly WriteCapability[];
  /**
   * Install the editable pack in this directory instead of running the shipped,
   * checksummed one.
   *
   * There are two installs and no middle setting. The alternative was letting a
   * user mark playbooks editable one at a time, which made them track which
   * files were theirs and which were still the package's — bookkeeping the tool
   * should do. An empty string means "editable, in the default directory".
   */
  editableDir?: string;
};

/**
 * No `env` any more. The entry carried ARTIST_MCP_KEY in plaintext inside
 * claude_desktop_config.json, a file with no particular protection that other
 * tools read and back up. Credentials now live in the token store this package
 * owns, so the config holds nothing worth stealing.
 */
type ServerEntry = {
  command: string;
  args: string[];
};

/**
 * The playbook directory goes in the entry's own args, not in `env` and not in a
 * file this package hides somewhere.
 *
 * Claude Desktop spawns the server with no cwd worth trusting, so the path
 * cannot be discovered at runtime — it has to be recorded at install time. Args
 * keep it where a user will actually find it: reading the entry tells you this
 * machine is running the user's own rules rather than the shipped ones.
 */
const createServerEntry = ({
  local = false,
  version = packageVersion,
  agentsDir,
  grants = [],
}: {
  local?: boolean;
  version?: string;
  agentsDir?: string;
  grants?: readonly WriteCapability[];
} = {}): ServerEntry => {
  const agents = agentsDir ? ["--agents", resolve(agentsDir)] : [];
  // Written even though the server would default to no writes without it,
  // because the entry is where a user looks to find out what this install can
  // do. An absent flag and a granted-then-forgotten one must not look alike.
  const writes = grants.length > 0 ? ["--allow-writes", [...grants].join(",")] : [];
  return local
    ? {
        command: process.execPath,
        args: [LOCAL_ENTRY, ...agents, ...writes],
      }
    : {
        command: "npx",
        args: ["-y", packageSpec(version), ...agents, ...writes],
      };
};

/**
 * Register the Claude Desktop entry.
 *
 * There is no key to paste any more, so this no longer asks for anything or
 * calls anything to check it. What it can still get wrong is finishing silently
 * on a machine with no connection, which would surface later as every tool
 * failing inside Claude — so it says plainly which providers are connected and
 * names the command for the ones that are not.
 */
export const runInit = async ({
  local = false,
  editableDir,
  grants = [],
}: InitOptions = {}): Promise<void> => {
  // Seed before touching the config, so a directory that cannot be written fails
  // here, while the user is still looking at the terminal — rather than later, as
  // every workflow tool failing inside Claude Desktop.
  const seeded =
    editableDir === undefined
      ? undefined
      : await seedEditablePack(editableDir === "" ? DEFAULT_EDITABLE_DIRECTORY : editableDir);

  const path = configPath();
  const config = await readConfig(path);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  servers[ENTRY_NAME] = createServerEntry({ local, agentsDir: seeded?.root, grants });
  config.mcpServers = servers;

  await writeConfig(path, config);

  console.log(`\nWrote "${ENTRY_NAME}" to ${path}`);
  if (seeded) {
    console.log("");
    describeSeed(seeded);
  } else {
    console.log("Playbooks are the shipped, checksummed ones. Re-run with");
    console.log("`--editable` to install a copy you can edit.");
  }
  // Said every time, granted or not. A capability nobody can see is one nobody
  // accounts for, and the useful line is the one that appears when the answer
  // is "none" — that is what tells a user their install is still read-only.
  console.log("");
  setGrants(grants);
  console.log(describeGrants());
  if (grants.length > 0) {
    console.log(
      "Reconnect Google so the grant is on the token: `artist-mcp connect google`. " +
        "A refresh token carries the scopes it was granted with, so an existing " +
        "connection cannot write until it is renewed.",
    );
  }

  console.log("");
  if (local) {
    console.log(`Using local build: ${LOCAL_ENTRY}`);
  } else {
    // Name the environment. The two installs differ by one dist-tag and fail
    // identically when crossed, so leaving it implicit costs more than the line.
    console.log(
      `Registered ${packageSpec()} (${isStagingVersion(packageVersion) ? "staging" : "production"}).`,
    );
  }

  const connected = await connectedProviders();
  if (connected.includes("microsoft")) {
    console.log(`Connected: ${connected.join(", ")}.`);
  } else {
    console.log(
      "\nNothing is connected yet. Run `artist-mcp connect` to sign in to " +
        "Microsoft for your notes, and `artist-mcp connect google` to add " +
        "Gmail and Calendar as evidence.",
    );
  }

  console.log("Restart Claude Desktop — it doesn't reload its config on its own.");
};

export { createServerEntry, packageSpec };

export const runUninstall = async (): Promise<void> => {
  const path = configPath();
  const config = await readConfig(path);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  if (!(ENTRY_NAME in servers)) {
    console.log(`No "${ENTRY_NAME}" entry in ${path}. Nothing to do.`);
    return;
  }

  delete servers[ENTRY_NAME];
  config.mcpServers = servers;
  await writeConfig(path, config);

  console.log(`Removed "${ENTRY_NAME}" from ${path}`);
  console.log("Restart Claude Desktop to apply.");
};
