import { Button, buttonVariants } from '@/components/ui/button';
import { Typography } from '@/components/ui/Typography';
import { supabaseServer } from '@/lib/supabase/server';
import { signOut } from './actions';
import { KeyPanel } from './key-panel';
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

const PublicHome = () => (
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
    <section className="grid gap-8 py-10 lg:grid-cols-2">
      <div>
        <Typography as="h2" variant="sectionTitle" color="yellow">
          PROJECT TYPES
        </Typography>
        <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
          {projects.map((project) => (
            <li key={project}>
              <span className="text-signal-cyan">■</span> {project}
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
      <div className="bg-background p-5">
        <Typography as="h2" variant="sectionTitle" color="yellow">
          CLAUDE DESKTOP
        </Typography>
        <Typography variant="small" className="mt-3">
          Run the installer, paste your connection key, then restart Claude Desktop.
        </Typography>
        <code className="mt-5 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
          npx @manudota/artist-mcp init
        </code>
      </div>
      <div className="bg-background p-5">
        <Typography as="h2" variant="sectionTitle" color="yellow">
          CODEX
        </Typography>
        <Typography variant="small" className="mt-3">
          Add the same MCP package with your key in the Codex MCP configuration.
        </Typography>
        <code className="mt-5 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
          codex mcp add artist-notes …
        </code>
      </div>
    </section>
    <section id="read-only" className="border-b border-signal-cyan py-10">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        READ-ONLY BY DESIGN
      </Typography>
      <div className="mt-5 grid gap-4 font-mono text-sm sm:grid-cols-3">
        <p>
          <span className="text-signal-green">READ LIVE</span>
          <br />
          No copied project database.
        </p>
        <p>
          <span className="text-signal-green">HUMAN REVIEWS</span>
          <br />
          Results stay in your chat.
        </p>
        <p>
          <span className="text-signal-red">NEVER SENDS</span>
          <br />
          No notes, messages, or calendars are changed.
        </p>
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
};

const Dashboard = ({ connection, hasKey, email, connected, error }: DashboardProps) => (
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
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        MICROSOFT / ONENOTE
      </Typography>
      <Typography variant="small" className="mt-3">
        {connection
          ? `STATUS: CONNECTED · LAST UPDATED ${new Date(connection.updated_at).toLocaleString()}`
          : 'STATUS: NOT CONNECTED'}
      </Typography>
      <a
        href="/api/auth/microsoft"
        className={buttonVariants({
          variant: connection ? 'outline' : 'default',
          className: 'mt-4',
        })}
      >
        {connection ? 'RECONNECT MICROSOFT' : 'CONNECT MICROSOFT'}
      </a>
    </section>
    <KeyPanel hasKey={hasKey} />
    <section className="border-t border-signal-cyan pt-5">
      <Typography as="h2" variant="sectionTitle" color="yellow">
        INSTALL CLIENT
      </Typography>
      <Typography variant="small" className="mt-3">
        CLAUDE DESKTOP
      </Typography>
      <code className="mt-2 block border border-foreground p-3 font-mono text-sm text-signal-cyan">
        npx @manudota/artist-mcp init
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
        />
      ) : (
        <PublicHome />
      )}
      <footer className="flex flex-wrap justify-between gap-3 bg-signal-blue px-3 py-2 font-mono text-xs font-bold text-white">
        <span>ARTIST-MCP</span>
        <span>ONENOTE → CLAUDE / CODEX</span>
        <span>READ-ONLY</span>
      </footer>
    </div>
  );
};

export default Home;
