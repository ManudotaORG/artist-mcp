import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listAgentWorkflows, loadAgentWorkflow } from "./agents.js";
import { call, GraphError } from "./client.js";

type NoteSummary = {
  id: string;
  title: string;
  section: string | null;
  /** Absent from responses served by an older edge function. */
  notebook?: string | null;
  last_modified: string | null;
};

const serverVersion = '0.4.0'; // x-release-please-version

const errorResult = (err: unknown) => {
  const message =
    err instanceof GraphError ? err.message : `Unexpected error: ${err}`;
  return { content: [{ type: "text" as const, text: message }], isError: true };
};

const runServer = async (): Promise<void> => {
  const key = process.env.ARTIST_MCP_KEY;
  if (!key) {
    // stderr, not stdout — stdout is the protocol channel.
    console.error(
      "ARTIST_MCP_KEY is not set. Run `npx @manudota/artist-mcp init` to configure.",
    );
    process.exit(1);
  }

  const server = new McpServer({ name: "artist-notes", version: serverVersion });

  server.tool(
    "list_agent_workflows",
    "List the read-only artist roles, project types, and policies available at runtime. Load the Orchestrator before handling a project.",
    {},
    async () => {
      try {
        const entries = await listAgentWorkflows();
        const lines = entries.map(
          (entry) => `- ${entry.id}: ${entry.name} — ${entry.description}`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "load_agent_workflow",
    "Load one checksummed role, project-type, or policy playbook. This only returns instructions; it never changes OneNote or another service.",
    { workflow_id: z.string().describe("An id returned by list_agent_workflows") },
    async ({ workflow_id }) => {
      try {
        const workflow = await loadAgentWorkflow(workflow_id);
        return {
          content: [
            {
              type: "text",
              text: `# ${workflow.name}\n\n${workflow.content}`,
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_notes",
    "List the user's OneNote pages, with title, notebook, section and last " +
      "modified date. Pages from every notebook are returned; ask the user " +
      "which notebook to work in rather than assuming.",
    {},
    async () => {
      try {
        const { notes } = await call<{ notes: NoteSummary[] }>("list_notes", key);
        if (notes.length === 0) {
          return { content: [{ type: "text", text: "No notes found." }] };
        }
        const lines = notes.map((n) => {
          const location = [n.notebook, n.section].filter(Boolean).join(" / ");
          return `- ${n.title}${location ? ` (${location})` : ""} — modified ${
            n.last_modified ?? "unknown"
          }\n  id: ${n.id}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "read_note",
    "Read the text content of one OneNote page. Takes the id from list_notes.",
    { note_id: z.string().describe("The id of the note, as returned by list_notes") },
    async ({ note_id }) => {
      try {
        const { title, text } = await call<{ title: string; text: string }>(
          "read_note",
          key,
          { note_id },
        );
        return { content: [{ type: "text", text: `# ${title}\n\n${text}` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  await server.connect(new StdioServerTransport());
};

export { runServer };
