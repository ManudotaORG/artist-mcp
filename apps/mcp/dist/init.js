import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { call, GraphError, isStagingVersion, packageVersion } from "./client.js";
import { configPath, ENTRY_NAME, readConfig, writeConfig } from "./config.js";
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
const createServerEntry = ({ key, local = false, version = packageVersion, }) => local
    ? {
        command: process.execPath,
        args: [LOCAL_ENTRY],
        env: { ARTIST_MCP_KEY: key },
    }
    : {
        command: "npx",
        args: ["-y", packageSpec(version)],
        env: { ARTIST_MCP_KEY: key },
    };
export const runInit = async ({ local = false } = {}) => {
    const rl = createInterface({ input: stdin, output: stdout });
    let key;
    try {
        key = (await rl.question("Paste your connection key: ")).trim();
    }
    finally {
        rl.close();
    }
    if (key === "") {
        console.error("No key entered. Nothing was written.");
        process.exit(1);
    }
    // Verify before touching the config — a bad key should leave the machine
    // exactly as it was.
    try {
        await call("verify", key);
    }
    catch (err) {
        const message = err instanceof GraphError ? err.message : `Could not verify key: ${err}`;
        console.error(`${message}\nNothing was written.`);
        process.exit(1);
    }
    const path = configPath();
    const config = await readConfig(path);
    const servers = (config.mcpServers ?? {});
    servers[ENTRY_NAME] = createServerEntry({ key, local });
    config.mcpServers = servers;
    await writeConfig(path, config);
    console.log(`\nConnected. Wrote "${ENTRY_NAME}" to ${path}`);
    if (local) {
        console.log(`Using local build: ${LOCAL_ENTRY}`);
    }
    else {
        // Name the environment. The two installs differ by one dist-tag and fail
        // identically when crossed, so leaving it implicit costs more than the line.
        console.log(`Registered ${packageSpec()} (${isStagingVersion(packageVersion) ? "staging" : "production"}).`);
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
