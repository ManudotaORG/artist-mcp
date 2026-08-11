import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { getDeploymentMetadata } from '@/lib/deployment';
import { supabaseServer } from '@/lib/supabase/server';
import { signOut } from './actions';
import { KeyPanel } from './key-panel';
import { MicrosoftConnectionPanel } from './microsoft-connection-panel';
import { SignInForm } from './sign-in-form';

type HomeProps = {
  searchParams: Promise<{ error?: string; connected?: string }>;
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
node apps/mcp/dist/index.js agents install`;
  }

  const packageSpecifier = getPackageSpecifier(channel);
  return `npx ${packageSpecifier} init
npx ${packageSpecifier} agents install`;
};

const getCodexCommands = (channel: InstallChannel) => {
  if (channel === 'local') {
    return `pnpm --filter @manudota/artist-mcp build
read -s ARTIST_MCP_KEY
codex mcp add artist-notes \\
  --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" \\
  -- node "$PWD/apps/mcp/dist/index.js"
unset ARTIST_MCP_KEY
node apps/mcp/dist/index.js agents install`;
  }

  const packageSpecifier = getPackageSpecifier(channel);
  return `read -s ARTIST_MCP_KEY
codex mcp add artist-notes \\
  --env ARTIST_MCP_KEY="$ARTIST_MCP_KEY" \\
  -- npx -y ${packageSpecifier}
unset ARTIST_MCP_KEY
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

const Workflow = () => (
  <section id="workflow" className="border-y border-signal-cyan py-7">
    <Typography as="h2" variant="sectionTitle" color="yellow">
      ONE LIVE WORKFLOW
    </Typography>
    <div className="mt-6 grid gap-px bg-signal-cyan md:grid-cols-4">
      {[
        ['ONENOTE PAGE', 'Choose one project page as the working unit.'],
        ['SELECTED ROLES', 'Load only the playbooks needed for this request.'],
        ['CHECKED RESULT', 'Audit names, dates, contacts, and claims against the page.'],
        ['YOUR CHAT', 'Return one recommendation, plan, audit, or draft for your decision.'],
      ].map(([title, copy]) => (
        <div key={title} className="min-h-44 bg-background p-4">
          <Typography variant="label" color="cyan">
            {title}
          </Typography>
          <Typography variant="small" className="mt-5">
            {copy}
          </Typography>
        </div>
      ))}
    </div>
  </section>
);

const RoleHandoff = () => (
  <section className="border-b border-signal-cyan py-10">
    <Typography as="h2" variant="sectionTitle" color="yellow">
      ONE ITEM, NOT TWO
    </Typography>
    <Typography className="mt-4">
      The Orchestrator finds one useful gap and asks before continuing. For a concert, that could be
      missing instrument transport on 14 September.
    </Typography>
    <ol className="mt-6 grid gap-px bg-signal-cyan sm:grid-cols-2 lg:grid-cols-3">
      {[
        ['ORCHESTRATOR', 'Offers one next action and waits for the musician to say yes.'],
        ['REGISTRAR', 'Finds the relevant contact in the current OneNote page.'],
        ['ENVOY', 'Drafts the outreach in chat. It never sends it.'],
        ['AUDITOR', 'Checks the current draft against dates and facts, then asks for corrections.'],
        ['MUSICIAN', 'Reads, edits, and sends the final message personally.'],
        ['JANITOR', 'Names the completed and expired items the musician may clear.'],
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
      <aside className="self-end border border-signal-cyan p-5">
        <Typography as="h2" variant="label" color="cyan">
          SIGN IN WITH EMAIL
        </Typography>
        <Typography variant="small" className="my-3">
          We email you a secure link. No password.
        </Typography>
        <SignInForm />
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
    </section>
  </>
);

type DashboardProps = {
  connection: { updated_at: string } | null;
  hasKey: boolean;
  email?: string;
  connected: boolean;
  error?: string;
  installChannel: InstallChannel;
};

const Dashboard = ({
  connection,
  hasKey,
  email,
  connected,
  error,
  installChannel,
}: DashboardProps) => (
  <main className="grid gap-8 py-10">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Typography as="h1" variant="pageTitle" color="yellow">
          CONNECTION CONSOLE
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
    {connected ? <Typography color="green">MICROSOFT CONNECTED.</Typography> : null}
    <MicrosoftConnectionPanel connection={connection} />
    <KeyPanel hasKey={hasKey} canGenerate={Boolean(connection)} />
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
        VERIFY: ASK “LIST MY ONENOTE NOTES.”
      </Typography>
    </section>
  </main>
);

const Home = async ({ searchParams }: HomeProps) => {
  const { error, connected } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: connection }, { data: keyRow }] = user
    ? await Promise.all([
        supabase.from('connections').select('updated_at').maybeSingle(),
        supabase.from('mcp_keys').select('last_used_at').maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const deployment = getDeploymentMetadata();
  const installChannel: InstallChannel = deployment?.environment ?? 'local';

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
      <ServiceHeader />
      {user ? (
        <Dashboard
          connection={connection}
          hasKey={Boolean(keyRow)}
          email={user.email}
          connected={Boolean(connected)}
          error={error}
          installChannel={installChannel}
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
            <>
              <Typography as="span" variant="label" className="text-white">
                V{deployment.version}
              </Typography>
              <a
                href="https://github.com/ManudotaORG/artist-mcp/releases"
                className="font-mono text-xs font-bold underline-offset-4 hover:text-signal-yellow hover:underline"
              >
                PATCH NOTES
              </a>
            </>
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
