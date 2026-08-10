import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { call, GraphError } from "./client.js";
export async function runServer() {
    const key = process.env.ARTIST_MCP_KEY;
    if (!key) {
        // stderr, not stdout — stdout is the protocol channel.
        console.error("ARTIST_MCP_KEY is not set. Run `npx @manudota/artist-mcp init` to configure.");
        process.exit(1);
    }
    const server = new McpServer({ name: "artist-notes", version: "0.1.0" });
    server.tool("list_notes", "List the user's OneNote pages, with title, section and last modified date.", {}, async () => {
        try {
            const { notes } = await call("list_notes", key);
            if (notes.length === 0) {
                return { content: [{ type: "text", text: "No notes found." }] };
            }
            const lines = notes.map((n) => `- ${n.title}${n.section ? ` (${n.section})` : ""} — modified ${n.last_modified ?? "unknown"}\n  id: ${n.id}`);
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.tool("read_note", "Read the text content of one OneNote page. Takes the id from list_notes.", { note_id: z.string().describe("The id of the note, as returned by list_notes") }, async ({ note_id }) => {
        try {
            const { title, text } = await call("read_note", key, { note_id });
            return { content: [{ type: "text", text: `# ${title}\n\n${text}` }] };
        }
        catch (err) {
            return errorResult(err);
        }
    });
    await server.connect(new StdioServerTransport());
}
function errorResult(err) {
    const message = err instanceof GraphError ? err.message : `Unexpected error: ${err}`;
    return { content: [{ type: "text", text: message }], isError: true };
}
