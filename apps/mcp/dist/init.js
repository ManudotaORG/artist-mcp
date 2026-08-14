import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalAgentPack } from "./agents.js";
import { isStagingVersion, packageVersion } from "./client.js";
import { configPath, ENTRY_NAME, readConfig, writeConfig } from "./config.js";
import { connectedProviders } from "./dispatch.js";
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
const packageSpec = (version = packageVersion) => isStagingVersion(version) ? `${PACKAGE}@staging` : PACKAGE;
/**
 * The playbook directory goes in the entry's own args, not in `env` and not in a
 * file this package hides somewhere.
 *
 * Claude Desktop spawns the server with no cwd worth trusting, so the path
 * cannot be discovered at runtime — it has to be recorded at install time. Args
 * keep it where a user will actually find it: reading the entry tells you this
 * machine is running the user's own rules rather than the shipped ones.
 */
const createServerEntry = ({ local = false, version = packageVersion, agentsDir, } = {}) => {
    const agents = agentsDir ? ["--agents", resolve(agentsDir)] : [];
    return local
        ? {
            command: process.execPath,
            args: [LOCAL_ENTRY, ...agents],
        }
        : {
            command: "npx",
            args: ["-y", packageSpec(version), ...agents],
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
export const runInit = async ({ local = false, agentsDir } = {}) => {
    // Check the pack before touching the config. A typo in the path should fail
    // here, while the user is still looking at the terminal — not later, as every
    // workflow tool failing inside Claude Desktop.
    const playbooks = agentsDir ? await assertLocalAgentPack(agentsDir) : undefined;
    const path = configPath();
    const config = await readConfig(path);
    const servers = (config.mcpServers ?? {});
    servers[ENTRY_NAME] = createServerEntry({ local, agentsDir });
    config.mcpServers = servers;
    await writeConfig(path, config);
    console.log(`\nWrote "${ENTRY_NAME}" to ${path}`);
    if (agentsDir !== undefined) {
        console.log(`Reading ${playbooks} playbooks from ${resolve(agentsDir)}`);
        console.log("Files there override the shipped ones; the rest stay bundled.");
    }
    if (local) {
        console.log(`Using local build: ${LOCAL_ENTRY}`);
    }
    else {
        // Name the environment. The two installs differ by one dist-tag and fail
        // identically when crossed, so leaving it implicit costs more than the line.
        console.log(`Registered ${packageSpec()} (${isStagingVersion(packageVersion) ? "staging" : "production"}).`);
    }
    const connected = await connectedProviders();
    if (connected.includes("microsoft")) {
        console.log(`Connected: ${connected.join(", ")}.`);
    }
    else {
        console.log("\nNothing is connected yet. Run `artist-mcp connect` to sign in to " +
            "Microsoft for your notes, and `artist-mcp connect google` to add " +
            "Gmail and Calendar as evidence.");
    }
    console.log("Restart Claude Desktop — it doesn't reload its config on its own.");
};
export { createServerEntry, packageSpec };
export const runUninstall = async () => {
    const path = configPath();
    const config = await readConfig(path);
    const servers = (config.mcpServers ?? {});
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
