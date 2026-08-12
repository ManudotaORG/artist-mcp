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

type EmailSummary = {
  id: string;
  thread_id: string | null;
  subject: string;
  from: string | null;
  to: string | null;
  date: string | null;
  snippet: string | null;
};

type EmailBody = EmailSummary & { cc: string | null; text: string };

const serverVersion = '0.5.0'; // x-release-please-version

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
    "List the read-only artist roles, project types, and policies available " +
      "at runtime. The project-type playbooks and the intake policy are " +
      "returned in full and are in force as returned — they govern the survey, " +
      "the classification and any templates, and are not optional reading. " +
      "Load the Orchestrator before handling a project.",
    {},
    async () => {
      try {
        const entries = await listAgentWorkflows();

        // A one-line summary is enough to pick a role to load, but not to
        // classify a page: the rules that separate one project type from
        // another live in the body of the file. Intake is here for the same
        // reason — it governs the survey, the classification and the templates,
        // all of which happen before anything would think to load a policy.
        // A run that loaded nothing at all classified five pages and then
        // offered to write template files, which intake forbids.
        const alwaysInFull = (entry: (typeof entries)[number]) =>
          entry.kind === "project-type" || entry.id === "policy:intake";
        const upfront = entries.filter(alwaysInFull);
        const rest = entries.filter((entry) => !alwaysInFull(entry));

        const loaded = await Promise.all(
          upfront.map(async (entry) => {
            try {
              const { content } = await loadAgentWorkflow(entry.id);
              return `## ${entry.id}\n\n${content.trim()}`;
            } catch {
              return `## ${entry.id}: ${entry.name} — ${entry.description}`;
            }
          }),
        );

        const summary = rest.map(
          (entry) => `- ${entry.id}: ${entry.name} — ${entry.description}`,
        );

        const text = [
          "# Roles and policies (load by id when needed)",
          summary.join("\n"),
          "",
          "# In force now (full text — these govern the work before anything is loaded)",
          loaded.join("\n\n"),
        ].join("\n");

        return { content: [{ type: "text", text }] };
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
      "modified date. Takes an optional notebook name. When the account holds " +
      "more than one notebook and none is given, this returns the list of " +
      "notebooks instead of any pages, so the user can say which one to work " +
      "in.",
    {
      notebook: z
        .string()
        .optional()
        .describe(
          "Name of the notebook to list, exactly as returned by a previous " +
            "call. Omit only when the user has not chosen one yet.",
        ),
    },
    async ({ notebook }) => {
      try {
        const { notes } = await call<{ notes: NoteSummary[] }>("list_notes", key);
        if (notes.length === 0) {
          return { content: [{ type: "text", text: "No notes found." }] };
        }

        const names = [...new Set(notes.map((n) => n.notebook ?? "(unnamed notebook)"))];

        // Handing back every page across every notebook invites work on the
        // wrong one. With a choice to be made and nothing chosen, the pages
        // are withheld until the user has actually made it.
        if (!notebook && names.length > 1) {
          const counts = names.map((name) => {
            const total = notes.filter(
              (n) => (n.notebook ?? "(unnamed notebook)") === name,
            ).length;
            return `- ${name} — ${total} page${total === 1 ? "" : "s"}`;
          });
          return {
            content: [
              {
                type: "text",
                text:
                  `This account has ${names.length} notebooks:\n${counts.join("\n")}\n\n` +
                  "Ask the user which notebook to work in, then call list_notes " +
                  "again with that name. Do not guess, and do not work across " +
                  "notebooks unless the user asks for it.",
              },
            ],
          };
        }

        const wanted = notebook?.trim().toLowerCase();
        const selected = wanted
          ? notes.filter((n) => (n.notebook ?? "").trim().toLowerCase() === wanted)
          : notes;

        if (wanted && selected.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `No notebook named "${notebook}". Available: ${names.join(", ")}.`,
              },
            ],
          };
        }

        const lines = selected.map((n) => {
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

  server.tool(
    "list_emails",
    "Search the user's Gmail and list matching messages, newest first, with " +
      "subject, sender, date and snippet. Email is supporting evidence for a " +
      "OneNote working unit — it corroborates or fills gaps in a page, and is " +
      "never itself the working unit. Cite the subject and sender behind any " +
      "fact taken from here, and never treat a hedged or forwarded value as " +
      "settled. Requires a Google connection, which is separate from the " +
      "Microsoft one.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Gmail search syntax, e.g. 'from:promoter@venue.com after:2026/01/01' " +
            "or 'subject:contract'. Omit to list the most recent messages.",
        ),
    },
    async ({ query }) => {
      try {
        const { emails } = await call<{ emails: EmailSummary[] }>(
          "list_emails",
          key,
          { query },
        );
        if (emails.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: query
                  ? `No messages match ${query}.`
                  : "No messages found.",
              },
            ],
          };
        }

        const lines = emails.map((e) => {
          const who = e.from ?? "unknown sender";
          const when = e.date ?? "unknown date";
          const snippet = e.snippet ? `\n  ${e.snippet}` : "";
          return `- ${e.subject} — ${who} — ${when}${snippet}\n  id: ${e.id}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "read_email",
    "Read one Gmail message in full, including its body. Takes the id from " +
      "list_emails. Read-only: this never sends, replies, drafts, labels, or " +
      "deletes anything.",
    {
      email_id: z
        .string()
        .describe("The id of the message, as returned by list_emails"),
    },
    async ({ email_id }) => {
      try {
        const mail = await call<EmailBody>("read_email", key, { email_id });
        const head = [
          `# ${mail.subject}`,
          "",
          `From: ${mail.from ?? "unknown"}`,
          `To: ${mail.to ?? "unknown"}`,
          ...(mail.cc ? [`Cc: ${mail.cc}`] : []),
          `Date: ${mail.date ?? "unknown"}`,
        ].join("\n");
        return { content: [{ type: "text", text: `${head}\n\n${mail.text}` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  await server.connect(new StdioServerTransport());
};

export { runServer };
