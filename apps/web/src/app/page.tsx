import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { getDeploymentMetadata } from '@/lib/deployment';
import { getSiteUrl } from '@/lib/siteUrl';
import { supabaseServer } from '@/lib/supabase/server';
import { disconnect, signOut } from './actions';

type HomeProps = {
  searchParams: Promise<{ error?: string; connected?: string; disconnected?: string }>;
};

const roles = [
  'Orchestrator',
  'Archivist',
  'Registrar',
  'Project Manager',
  'Envoy',
  'Auditor',
  'Janitor',
];
const projects = ['Concert', 'Large Concert', 'Studio Session', 'Rehearsal'];

type InstallChannel = 'local' | 'staging' | 'production';

const getPackageSpecifier = (channel: InstallChannel) =>
  channel === 'staging' ? '@manudota/artist-mcp@staging' : '@manudota/artist-mcp';

const getClaudeCommands = (channel: InstallChannel) => {
  if (channel === 'local') {
    return `pnpm --filter @manudota/artist-mcp build
node apps/mcp/dist/index.js init --local
node apps/mcp/dist/index.js connect
node apps/mcp/dist/index.js agents install`;
  }

  const packageSpecifier = getPackageSpecifier(channel);
  return `npx ${packageSpecifier} init
npx ${packageSpecifier} connect
npx ${packageSpecifier} agents install`;
};

const getCodexCommands = (channel: InstallChannel) => {
  if (channel === 'local') {
    return `pnpm --filter @manudota/artist-mcp build
codex mcp add artist-notes -- node "$PWD/apps/mcp/dist/index.js"
node apps/mcp/dist/index.js connect
node apps/mcp/dist/index.js agents install`;
  }

  const packageSpecifier = getPackageSpecifier(channel);
  return `codex mcp add artist-notes -- npx -y ${packageSpecifier}
npx ${packageSpecifier} connect
npx ${packageSpecifier} agents install`;
};

const ServiceHeader = () => (
  <header className="border-b border-signal-cyan pb-3">
    <div className="flex items-end justify-between gap-4">
      <Typography as="p" variant="pageTitle" color="yellow">
        ARTIST-MCP
      </Typography>
      <Typography variant="label">READ-ONLY ARTIST WORKFLOWS</Typography>
    </div>
    <nav
      aria-label="Service pages"
      className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 bg-signal-blue px-3 py-2 sm:flex sm:flex-wrap sm:gap-x-6"
    >
      {['HOME', 'WORKFLOW', 'INSTALL', 'READ-ONLY'].map((item) => (
        <a
          key={item}
          href={`#${item.toLowerCase()}`}
          className="font-mono text-sm font-bold text-white hover:text-signal-yellow focus-visible:outline-2 focus-visible:outline-signal-yellow"
        >
          {item}
        </a>
      ))}
    </nav>
  </header>
);

const workflowSteps = [
  {
    step: '01',
    title: 'POINT IT AT THE MESS',
    prompt: 'List my notes and tell me what you can see.',
    result:
      'An agent shortlists your pages by title, section, and date, then reads them. No structure required — half-written pages, loose notes, and inconsistent headings are the normal starting point.',
  },
  {
    step: '02',
    title: 'MATCH EACH PAGE TO A PLAYBOOK',
    prompt: 'Which playbook does each of these pages call for?',
    result:
      'It proposes the appropriate playbook for each page, based on what the page actually says rather than what its title claims — and tells you plainly when a page is too thin to call.',
  },
  {
    step: '03',
    title: 'BUILD THE TEMPLATES YOU ACTUALLY NEED',
    prompt: 'Build the templates these pages need.',
    result:
      'It drafts a small set of blank, reusable page templates — one for each kind of work it found, with every field left UNKNOWN so gaps stay visible instead of being invented. You paste each into OneNote once and reuse it.',
  },
  {
    step: '04',
    title: 'CLOSE THE GAPS, ONE AT A TIME',
    prompt: 'Move my messiest page onto its template and tell me what is missing.',
    result:
      'It puts your existing notes under the right headings, pulling in related pages, then names the empty fields and the conflicts — two different dates for the same event, a venue with no contact — and tells you which one is worth doing first.',
  },
];

const Workflow = () => (
  <section id="workflow" className="border-y border-signal-cyan py-7">
    <Typography as="h2" variant="sectionTitle" color="yellow">
      FROM UNORGANIZED NOTES TO A WORKING PAGE
    </Typography>
    <Typography className="mt-4">
      You do not need a tidy notebook to start. Once the MCP is installed, type the highlighted
      lines into Claude Desktop or Codex and work through your existing pages as they are.
    </Typography>
    <ol className="mt-6 grid gap-px bg-signal-cyan">
      {workflowSteps.map(({ step, title, prompt, result }) => (
        <li key={step} className="grid gap-3 bg-background p-4 sm:grid-cols-[3rem_1fr] sm:gap-5">
          <Typography as="span" variant="sectionTitle" color="cyan" aria-hidden>
            {step}
          </Typography>
          <div className="min-w-0">
            <Typography variant="label" color="yellow">
              {title}
            </Typography>
            <p className="mt-3 border-l-2 border-signal-cyan pl-3 font-mono text-sm break-words text-signal-cyan">
              {prompt}
            </p>
            <Typography variant="small" className="mt-3">
              {result}
            </Typography>
          </div>
        </li>
      ))}
    </ol>
    <Typography variant="small" color="muted" className="mt-4">
      Every template and correction is proposed in chat for you to paste — the tool reads your
      OneNote pages and never edits them.
    </Typography>
  </section>
);

const RoleHandoff = () => (
  <section className="border-b border-signal-cyan py-10">
    <Typography as="h2" variant="sectionTitle" color="yellow">
      ONE ITEM, NOT TWO
    </Typography>
    <Typography className="mt-4">
      Once the spring recital page is in shape, this is how it gets worked. The Orchestrator finds
      one useful gap — no instrument transport for 14 September — and asks before continuing. These
      roles hand the same page to each other, one step at a time.
    </Typography>
    <ol className="mt-6 grid gap-px bg-signal-cyan sm:grid-cols-2 lg:grid-cols-3">
      {[
        [
          'ORCHESTRATOR',
          'Offers one next action — draft the transport request? — and waits for you to say yes.',
        ],
        ['REGISTRAR', 'Finds the hire company already named on the recital page.'],
        ['ENVOY', 'Drafts the transport request in chat. It never sends it.'],
        [
          'AUDITOR',
          'Checks that draft against the 14 September date on the page, then asks for corrections.',
        ],
        ['MUSICIAN', 'You read, edit, and send the final message personally.'],
        ['JANITOR', 'Names the recital tasks that are done or expired, for you to clear.'],
      ].map(([role, copy]) => (
        <li key={role} className="min-h-36 bg-background p-4">
          <Typography variant="label" color="cyan">
            {role}
          </Typography>
          <Typography variant="small" className="mt-4">
            {copy}
          </Typography>
        </li>
      ))}
    </ol>
    <Typography variant="small" color="muted" className="mt-4">
      These are temporary roles in one chat flow—not claims, queues, locks, review infrastructure,
      or background workers.
    </Typography>
  </section>
);

type PublicHomeProps = {
  installChannel: InstallChannel;
};

const PublicHome = ({ installChannel }: PublicHomeProps) => (
  <>
    <section id="home" className="grid gap-8 py-10 lg:grid-cols-[1.3fr_0.7fr] lg:py-16">
      <div className="animate-tune-in">
        <Typography as="h1" variant="display" color="yellow">
          ONE PAGE.
          <br />
          ONE WORKING UNIT.
        </Typography>
        <Typography className="mt-6 text-lg">
          Connect OneNote to Claude Desktop or Codex. Read one musician project live, apply narrow
          workflow playbooks, and return one useful next result in chat.
        </Typography>
      </div>
      {/*
        A sign-in form stood here. It offered something nobody could take:
        signup is closed, so every visitor who tried it got an error, which is a
        worse front page than one that simply says how this works. Hosted access
        is arranged with named people, and the honest way to say that is a
        sentence rather than a button that refuses.
      */}
      <aside className="self-end border border-signal-cyan p-5">
        <Typography as="h2" variant="label" color="cyan">
          RUNS ON YOUR MACHINE
        </Typography>
        <Typography variant="small" className="my-3">
          Install it below and your notes never leave your computer. Your Microsoft and Google
          connections are stored there, not here.
        </Typography>
        <Typography variant="small">
          There is also a hosted version for people who need this to work while their machine is
          off. It holds your credentials on our infrastructure, so it is set up with each person
          directly rather than signed up for.
        </Typography>
      </aside>
    </section>
    <Workflow />
    <RoleHandoff />
    <section className="grid gap-8 py-10 lg:grid-cols-2">
      <div>
        <Typography as="h2" variant="sectionTitle" color="yellow">
          PROJECT TYPES
        </Typography>
        <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
          {projects.map((project) => (
            <li key={project} className="flex items-center gap-2">
              <span aria-hidden className="size-2 bg-signal-cyan" />
              <Typography as="span" variant="small">
                {project}
              </Typography>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Typography as="h2" variant="sectionTitle" color="yellow">
          ROLES (7)
        </Typography>
        <ul className="mt-4 columns-2 font-mono text-sm leading-7">
          {roles.map((role) => (
            <li key={role}>{role}</li>
          ))}
        </ul>
      </div>
    </section>
    <section id="install" className="grid gap-px bg-signal-cyan lg:grid-cols-2">
      <div className="min-w-0 bg-background p-5">
        <Typography as="h2" variant="sectionTitle" color="yellow">
          CLAUDE DESKTOP
        </Typography>
        <Typography variant="small" className="mt-3">
          Install the MCP, then add the workflow Markdown to the project where you want the roles.
        </Typography>
        <pre className="mt-5 whitespace-pre-wrap break-all border border-foreground p-3 font-mono text-sm text-signal-cyan">
          <code>{getClaudeCommands(installChannel)}</code>
        </pre>
        <Typography variant="small" className="mt-5">
          The playbooks above are the shipped ones, verified by checksum. To run your own instead,
          add <code className="text-signal-cyan">--editable</code> to <code>init</code>: every
          playbook is copied to ~/artist-mcp, yours to change, and you can add more.
        </Typography>
      </div>
      <div className="min-w-0 bg-background p-5">
        <Typography as="h2" variant="sectionTitle" color="yellow">
          CODEX
        </Typography>
        <Typography variant="small" className="mt-3">
          Enter the key in a hidden prompt, register the MCP, then install the same workflow pack.
        </Typography>
        <pre className="mt-5 whitespace-pre-wrap break-all border border-foreground p-3 font-mono text-sm text-signal-cyan">
          <code>{getCodexCommands(installChannel)}</code>
        </pre>
      </div>
    </section>
    <section id="read-only" className="border-b border-signal-cyan py-10">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        READ-ONLY BY DESIGN
      </Typography>
      <div className="mt-5 grid gap-4 font-mono text-sm sm:grid-cols-3">
        <Typography as="div" variant="small">
          <Typography as="span" variant="label" color="green">
            READ LIVE
          </Typography>
          <br />
          No copied project database.
        </Typography>
        <Typography as="div" variant="small">
          <Typography as="span" variant="label" color="green">
            HUMAN DECIDES
          </Typography>
          <br />
          Results stay in your chat.
        </Typography>
        <Typography as="div" variant="small">
          <Typography as="span" variant="label" color="red">
            NEVER SENDS
          </Typography>
          <br />
          No notes, messages, or calendars are changed.
        </Typography>
      </div>
      <div className="mt-5 border border-signal-cyan p-4">
        <Typography as="h3" variant="label" color="cyan">
          WHERE YOUR CREDENTIALS LIVE
        </Typography>
        <Typography as="p" variant="small" className="mt-3">
          On your computer, and nowhere else. Signing in happens in your browser and the token stays
          on the machine you signed in on, so there is no copy of it here to lose, leak or look at.
          No maintainer can read your notes or mail, because nothing on our side holds the key to
          them.
        </Typography>
        <Typography as="p" variant="small" className="mt-3">
          The limit worth knowing: that token sits in a file readable by your own user account, so
          anything already running as you on your computer can use it. Reading your notes takes code
          on your specific machine — not a query someone can run from anywhere, against everyone, in
          silence.
        </Typography>
        <a
          href="https://github.com/ManudotaORG/artist-mcp/issues/22"
          className="mt-3 inline-block font-mono text-sm font-bold text-signal-cyan underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-signal-cyan"
        >
          HOW THIS WORKS →
        </a>
      </div>
    </section>
  </>
);

type Connection = { provider: string; updated_at: string };

type DashboardProps = {
  email?: string;
  error?: string;
  notice?: string;
  installChannel: InstallChannel;
  connections: Connection[];
  mcpUrl: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  microsoft: 'MICROSOFT — ONENOTE',
  google: 'GOOGLE — GMAIL AND CALENDAR',
};

/**
 * What this account has connected, and what it means.
 *
 * Read with the signed-in user's own session rather than the service role: RLS
 * already scopes connections to their owner, so the weaker credential is
 * sufficient and cannot be pointed at anyone else. Only the provider and the
 * date are read — the token column is ciphertext and there is no reason for
 * this page to hold it even briefly.
 */
const Connections = ({ connections, mcpUrl }: { connections: Connection[]; mcpUrl: string }) => {
  const connected = new Map(connections.map((c) => [c.provider, c]));

  return (
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        HOSTED CONNECTIONS
      </Typography>

      <Typography variant="small" className="mt-3">
        FOR CLIENTS THAT CANNOT RUN A PROGRAM ON YOUR MACHINE. YOUR TOKENS ARE STORED ON OUR
        INFRASTRUCTURE SO THIS WORKS WHILE YOUR MACHINE IS OFF. A MAINTAINER CAN TECHNICALLY READ
        WHAT THEY REACH.
      </Typography>

      <div className="mt-4 grid gap-3">
        {(['microsoft', 'google'] as const).map((provider) => {
          const row = connected.get(provider);
          return (
            <div
              key={provider}
              className="flex flex-wrap items-center justify-between gap-3 border border-foreground p-3"
            >
              <div>
                <Typography variant="small" color="cyan">
                  {PROVIDER_LABEL[provider]}
                </Typography>
                <Typography variant="small">
                  {row ? `CONNECTED ${row.updated_at.slice(0, 10)}` : 'NOT CONNECTED'}
                </Typography>
              </div>
              {row ? (
                <form action={disconnect}>
                  <input type="hidden" name="provider" value={provider} />
                  <Button type="submit" variant="ghost">
                    DISCONNECT
                  </Button>
                </form>
              ) : (
                <a
                  href={`/api/auth/${provider}`}
                  className="border border-foreground px-3 py-2 font-mono text-sm hover:bg-signal-cyan hover:text-black"
                >
                  CONNECT
                </a>
              )}
            </div>
          );
        })}
      </div>

      {connections.length > 0 ? (
        <>
          <Typography variant="small" className="mt-5">
            CONNECTOR URL — ADD THIS AS A REMOTE MCP SERVER
          </Typography>
          <code className="mt-2 block border border-foreground p-3 font-mono text-sm break-all text-signal-cyan">
            {mcpUrl}
          </code>
          <Typography variant="small" className="mt-2">
            SIGN IN AGAIN WHEN THE CONNECTOR ASKS. IT NEVER SEES YOUR MICROSOFT OR GOOGLE PASSWORD.
          </Typography>
        </>
      ) : null}

      <Typography variant="small" className="mt-5">
        DISCONNECTING DELETES THE TOKEN WE HOLD. IT DOES NOT REVOKE IT AT MICROSOFT OR GOOGLE — DO
        THAT IN THEIR OWN SECURITY SETTINGS.
      </Typography>
    </section>
  );
};

const Dashboard = ({
  email,
  error,
  notice,
  installChannel,
  connections,
  mcpUrl,
}: DashboardProps) => (
  <main className="grid gap-8 py-10">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {/*
          Called CONNECTION CONSOLE while the hosted design was live, then kept
          after custody moved to user machines, where it managed nothing. The
          hosted design is back but different — connections are arranged, not
          self-served — so the old name would mislead in a new way.
        */}
        <Typography as="h1" variant="pageTitle" color="yellow">
          YOUR ACCOUNT
        </Typography>
        <Typography variant="small" color="cyan" className="mt-2">
          SIGNED IN: {email ?? 'UNKNOWN'}
        </Typography>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost">
          SIGN OUT
        </Button>
      </form>
    </div>
    {error ? <Typography color="red">ERROR: {error}</Typography> : null}
    {notice ? <Typography color="green">{notice}</Typography> : null}
    <Connections connections={connections} mcpUrl={mcpUrl} />
    {/*
      A "MICROSOFT CONNECTED" banner lived here, set by a provider callback this
      app no longer has. Connecting a hosted account is done with a maintainer
      until that flow exists, so a banner would be reporting on something this
      page cannot observe.
    */}
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        INSTALL CLAUDE DESKTOP
      </Typography>
      <Typography variant="small" className="mt-3">
        CLAUDE DESKTOP
      </Typography>
      <code className="mt-2 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
        {getClaudeCommands(installChannel).split('\n').slice(0, -1).join('\n')}
      </code>
      <Typography variant="small" className="mt-5">
        INSTALL WORKFLOW MARKDOWN IN THIS PROJECT
      </Typography>
      <code className="mt-2 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
        {installChannel === 'local'
          ? 'node apps/mcp/dist/index.js agents install'
          : `npx ${getPackageSpecifier(installChannel)} agents install`}
      </code>
      <Typography variant="small" className="mt-5">
        OPTIONAL: PLAYBOOKS YOU CAN EDIT
      </Typography>
      <code className="mt-2 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
        {installChannel === 'local'
          ? 'node apps/mcp/dist/index.js init --local --editable'
          : `npx ${getPackageSpecifier(installChannel)} init --editable`}
      </code>
      <Typography variant="small" className="mt-2">
        COPIES EVERY PLAYBOOK TO ~/ARTIST-MCP, YOURS TO EDIT. WITHOUT IT THE SHIPPED ONES ARE USED
        AND CHECKSUM-VERIFIED.
      </Typography>
      <Typography variant="small" className="mt-5">
        VERIFY: ASK “LIST MY ONENOTE NOTES.”
      </Typography>
    </section>
  </main>
);

const Home = async ({ searchParams }: HomeProps) => {
  const { error, connected, disconnected } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Scoped by RLS to whoever is signed in, so the session's own credential is
  // enough and cannot be aimed at another account. Only the provider and the
  // date are selected; the token column is ciphertext this page has no use for.
  const { data: connections } = user
    ? await supabase.from('connections').select('provider, updated_at')
    : { data: [] };

  const notice = connected
    ? `${connected.toUpperCase()} CONNECTED.`
    : disconnected
      ? `${disconnected.toUpperCase()} DISCONNECTED.`
      : undefined;
  // Filtered by provider, and never with maybeSingle across the whole table:
  // a user may now hold a row per provider, and an unfiltered single-row read
  // both attributed whichever row existed to Microsoft and failed outright
  // (PGRST116) once two were connected.
  const deployment = await getDeploymentMetadata();
  const installChannel: InstallChannel = deployment?.environment ?? 'local';

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
      <ServiceHeader />
      {user ? (
        <Dashboard
          email={user.email}
          error={error}
          notice={notice}
          installChannel={installChannel}
          connections={connections ?? []}
          mcpUrl={`${getSiteUrl()}/api/mcp`}
        />
      ) : (
        <PublicHome installChannel={installChannel} />
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 bg-signal-blue px-3 py-2 text-white">
        <Typography as="span" variant="label" className="text-white">
          ARTIST-MCP
        </Typography>
        <Typography as="span" variant="label" className="text-white">
          ONENOTE → CLAUDE / CODEX
        </Typography>
        <div className="flex flex-wrap items-center gap-3">
          {deployment?.environment === 'staging' ? (
            <Typography
              as="span"
              variant="label"
              className="bg-signal-yellow px-2 py-1 text-background"
            >
              STAGING
            </Typography>
          ) : null}
          {deployment?.environment === 'production' ? (
            <a
              href="https://github.com/ManudotaORG/artist-mcp/releases"
              className="font-mono text-xs font-bold underline-offset-4 hover:text-signal-yellow hover:underline"
            >
              PATCH NOTES
            </a>
          ) : null}
          {deployment ? (
            <Typography as="span" variant="label" className="text-white">
              V{deployment.version}
            </Typography>
          ) : null}
          {deployment ? (
            <Typography as="span" variant="label" className="text-white">
              {deployment.commit}
            </Typography>
          ) : null}
          <Typography as="span" variant="label" className="text-white">
            READ-ONLY
          </Typography>
        </div>
      </footer>
    </div>
  );
};

export default Home;
