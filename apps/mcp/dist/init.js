import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { call, GraphError } from "./client.js";
import { configPath, ENTRY_NAME, readConfig, writeConfig } from "./config.js";
const PACKAGE = "@manudota/artist-mcp";
export async function runInit() {
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
    servers[ENTRY_NAME] = {
        command: "npx",
        args: ["-y", PACKAGE],
        env: { ARTIST_MCP_KEY: key },
    };
    config.mcpServers = servers;
    await writeConfig(path, config);
    console.log(`\nConnected. Wrote "${ENTRY_NAME}" to ${path}`);
    console.log("Restart Claude Desktop — it doesn't reload its config on its own.");
}
export async function runUninstall() {
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
}
