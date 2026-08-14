<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

These conventions are for this app. They used to sit in the repository root,
where `apps/mcp` read four hundred lines of React, Tailwind and component rules
that do not apply to a Node stdio server.

# Coding Conventions

> This file is loaded into LLM context for every code-generation session.
> Follow these rules religiously. Rules tagged `ESLint:` are auto-enforced; the rest are policy or manual review.

---

## Arrow Functions (ESLint: `func-style`)

**Rule:** All function declarations must be arrow-function expressions.

### Never do this

```tsx
function handleClick() { ... }
function MyComponent() { ... }
export default function RootLayout() { ... }
```

### Always do this

```tsx
const handleClick = () => { ... };
const MyComponent = () => { ... };
const RootLayout = ({ children }: RootLayoutProps) => { ... };
export default RootLayout;
```

### Default exports

Move the `export default` to the **bottom** of the file:

```tsx
const Page = () => { ... };
export default Page;
```

---

## Named Props Types (Documented — add custom ESLint rule if desired)

**Rule:** Every React component must have a named `ComponentNameProps` type defined above it.

### Never do this

```tsx
export const Button = ({ label, onClick }: { label: string; onClick: () => void }) => { ... };
```

### Always do this

```tsx
type ButtonProps = {
  label: string;
  onClick: () => void;
};

export const Button = ({ label, onClick }: ButtonProps) => { ... };
```

### Naming rules

- Use `type` (not `interface`) for props.
- Name must be exactly `ComponentNameProps` (e.g., `EntityGraphProps`, `EditEntityModalProps`).
- Never reuse a generic `Props` name across files.
- Place the type definition **immediately above** the component it belongs to.

---

## Direct React Imports (ESLint: `no-restricted-syntax`)

**Rule:** Never use `import * as React from "react"`. Use named imports instead.

### Never do this

```tsx
import * as React from 'react';
const [x, setX] = React.useState(0);
```

### Always do this

```tsx
import { useState, useEffect, useRef, type ReactNode } from 'react';
const [x, setX] = useState(0);
```

---

## Component Structure

Keep this order inside every `.tsx` file:

1. `"use client"` (if needed)
2. **Blank line** (always separate `"use client"` from imports)
3. Imports (React → libs → components → types)
4. Constants / helpers
5. `type ComponentNameProps = { ... }`
6. `const ComponentName = (...) => { ... };`
7. `export { ComponentName };` or `export default ComponentName;`

### Never do this

```tsx
'use client';
import { useState } from 'react';
```

### Always do this

```tsx
'use client';

import { useState } from 'react';
```

---

## Never Use `interface` (ESLint: `no-restricted-syntax`)

**Rule:** `interface` is forbidden in this codebase. Always use `type`.

### Never do this

```tsx
interface ButtonProps {
  label: string;
}
```

### Always do this

```tsx
type ButtonProps = {
  label: string;
};
```

**No exceptions.** Even when you think you need declaration merging or interface extension, use `type` with intersection (`&`) instead.

---

## Canonical Tailwind Classes

**Rule:** Use Tailwind's canonical spacing/sizing scale instead of arbitrary pixel values. Prefer `h-8` over `h-[32px]`, `p-3` over `p-[12px]`, `gap-2` over `gap-[8px]`, etc. Only use arbitrary values (`[Npx]`) when the design truly requires a value that doesn't exist in the scale (e.g. `text-[9px]` for micro text that has no canonical equivalent).

### Avoid these class names

```
h-[32px] w-[24px] p-[12px] gap-[8px] rounded-[4px]
```

### Prefer these class names

```
h-8 w-6 p-3 gap-2 rounded
```

### When arbitrary values are acceptable

- `text-[9px]`, `text-[10px]`, `text-[11px]` — micro text sizes with no canonical scale equivalent
- `tracking-[0.15em]`, `tracking-[0.25em]` — custom letter-spacing for specific design tokens
- Values that genuinely fall between scale steps and cannot be rounded without visual regression

---

## File Naming

- Pages: `kebab-case/page.tsx` (e.g., `app/cases/[id]/page.tsx`)
- Components: `PascalCase.tsx` (e.g., `EditEntityModal.tsx`)
- Utilities / hooks: `camelCase.ts` (e.g., `use-mobile.ts`)

---

## Quick Reference

| Convention               | Enforcement                                               |
| ------------------------ | --------------------------------------------------------- |
| Arrow functions          | `func-style` ESLint rule                                  |
| Direct React imports     | `no-restricted-syntax` ESLint rule                        |
| Named props types        | **Documented here** — add custom ESLint plugin if desired |
| Default export at bottom | **Documented here** — manual review                       |
| `"use client"` spacing   | **Documented here** — manual review                       |
| Button & Typography      | **Documented here** — manual review                       |
| CVA component pattern    | **Documented here** — manual review                       |

---

## ESLint Exhaustive Deps (Policy)

**Rule:** Never use `// eslint-disable-next-line react-hooks/exhaustive-deps` to silence missing dependency warnings. Always fix the issue at its core.

### Never do this

```tsx
useEffect(() => { ... }, [x]);
// eslint-disable-next-line react-hooks/exhaustive-deps
```

### Always do this

Add every dependency that the hook actually reads, or refactor the hook so it does not need to lie about its dependencies.

```tsx
useEffect(() => { ... }, [x, y, z]);
```

**Why:** Suppressing the rule hides real bugs. Stale closures, missing re-runs, and infinite loops are all caught by this rule. If a dependency array is "too long", extract a stable reference (e.g. `useRef`, `useCallback`) rather than omitting the dependency.

---

## Use `<Button>` and `<Typography>` — Never Raw Elements (Policy)

**Rule:** Never use raw `<button>` or raw text-styled `<h1>`/`<p>`/`<span>`/`<div>` for UI that matches an existing variant. Always use `<Button>` and `<Typography>`. When the design calls for a style covered by a variant, use it. When a variant covers 90% of the styling, use it and add only the remaining classes via `className`. Never duplicate classes the variant already provides.

- **Button** — import from `@/components/ui/Button`. Pick the variant that matches the visual role. If none fits, add a new named variant — never use raw `<button>`.
- **Typography** — import from `@/components/ui/Typography`. Pick the variant that matches the text pattern. Modifier props: `as`, `color`, `weight`, `uppercase`, `truncate`, `textGlow`.

### Never do this

```tsx
<button className="text-muted-foreground hover:text-foreground" onClick={onClose}>
  <X className="w-4 h-4" />
</button>
<h1 className="text-xl sm:text-2xl font-bold tracking-tight">Sanctions</h1>
```

### Always do this

```tsx
<Button variant="ghost-close" onClick={onClose}>
  <X className="w-4 h-4" />
</Button>
<Typography variant="pageTitle">Sanctions</Typography>
```

---

## Composable CVA Component Pattern (Documented)

**Rule:** When creating reusable UI primitives (buttons, text, badges, inputs, cards), use the **CVA component pattern**. This is the architecture behind `Button` and `Typography`.

### The pattern

Every composable component follows this structure:

1. **CVA variants** — `cva(base, { variants: { ... }, defaultVariants: { ... } })` defines the visual API
2. **Props from CVA** — `type Props = VariantProps<typeof variants> & { ...extra props }`
3. **Arrow function component** — destructures variants, merges with `cn()`
4. **Export variants** — export both the component and the `*Variants` constant for composition

### Template

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const widgetVariants = cva(
  'inline-flex items-center transition-all', // base — shared by ALL variants
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        outline: 'border border-border bg-background',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type WidgetProps = VariantProps<typeof widgetVariants> & {
  className?: string;
  children: React.ReactNode;
};

const Widget = ({ variant, size, className, children }: WidgetProps) => {
  return (
    <div data-slot="widget" className={cn(widgetVariants({ variant, size, className }))}>
      {children}
    </div>
  );
};

export { Widget, widgetVariants };
```

### Key principles

- **Base classes are for layout/behavior** that every variant shares (flexbox, transitions, disabled states). Visual styling (colors, borders, padding) goes in variants.
- **Each variant should be a complete visual style.** Consumers should only need `className` for positioning/layout overrides, not for restyling.
- **Export the `*Variants` constant** so other CVA components can compose from it (e.g., `Dialog` composing `buttonVariants`).
- **Always include `data-slot`** on the root element for CSS/test targeting.
- **Use `cn()` from `@/lib/utils`** to merge classes — it handles Tailwind conflicts via `tailwind-merge`.
- **Variant names should describe the visual role**, not the context (`pill` not `filterChip`, `ghost-close` not `modalDismiss`). Context-specific styling goes in `className`.

### When to create a new CVA component

- You see the **same className pattern repeated 3+ times** across files
- You're adding a new UI primitive (button variant, text style, badge type, input style)

---

## Avoid Inline `style={{ }}` — Use Tailwind (Policy)

**Rule:** Never use the inline `style={{ }}` prop for styling that Tailwind can express. Anything with a static, known-at-author-time value (colors, spacing, sizing, layout, overflow, opacity, font size, z-index, etc.) **must** be a Tailwind class. Reach for `style={{ }}` **only** when the value cannot be expressed as a class — i.e. it is computed at runtime, or it is a CSS feature Tailwind has no utility for.

### Never do this

```tsx
<div style={{ minHeight: 260, maxHeight: 400 }} />
<div style={{ overflow: 'hidden' }} />
<div style={{ position: 'relative', zIndex: 2 }} />
<span style={{ fontSize: 10 }} />
<Icon style={{ width: 13, height: 13 }} />
```

### Always do this

```tsx
<div className="min-h-65 max-h-100" />
<div className="overflow-hidden" />
<div className="relative z-2" />
<span className="text-[10px]" />
<Icon className="w-3.25 h-3.25" />
```

### When `style={{ }}` IS acceptable

Use it only when the value is **dynamic** (derived from props, state, data, or refs at runtime) and therefore cannot be a static class, **or** the property has no Tailwind utility.

```tsx
// Dynamic runtime value — width comes from data, cannot be a static class
<div style={{ width: `${(count / total) * 100}%` }} />

// Dynamic position from a measured ref
<div style={{ top: addPos.top, right: addPos.right }} />

// Computed animation timing per item
<li style={{ animationDelay: `${i * 0.18}s` }} />

// CSS custom properties Tailwind can't set
<div style={{ '--sidebar-width': '14rem' } as CSSProperties} />

// A CSS property with no Tailwind utility
<div style={{ scrollbarWidth: 'none' }} />
```

**Why:** Inline styles bypass `tailwind-merge`, can't be overridden by `className`, don't participate in the design system, and re-create a new object on every render. Prefer arbitrary-value classes (`w-[13px]`) over a static `style` object. If you find yourself repeating the same dynamic style, consider a CSS variable or a utility class instead.

---

## Extend Tailwind in `globals.css` — Never Scatter Design Values (Policy)

**Rule:** Anything that _can_ be defined by extending Tailwind **must** be defined by extending Tailwind. `app/globals.css` is the single home for keyframes, design tokens, and theme extensions. Component files consume utilities — they never define design values.

### What belongs in `globals.css`

| Thing                                               | How                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Colors                                              | CSS custom property + `--color-*` token in `@theme inline` → `text-*` / `bg-*` / `border-*` utilities |
| Animations                                          | `@keyframes` + `--animate-*` token in `@theme inline` → `animate-*` utilities                         |
| Fonts                                               | `--font-*` tokens                                                                                     |
| Radius / spacing overrides                          | `--radius-*` etc. tokens                                                                              |
| Reusable visual patterns with no utility equivalent | A named class (e.g. `.redact-shimmer`, `.grid-bg`)                                                    |

### Never do this

```tsx
// keyframe usage via inline style
<div style={{ animation: 'fade-up 0.45s ease both' }} />

// hex/oklch values scattered in components
<span style={{ color: '#C41E3A' }} />
const statusColor = 'text-red-400 border-red-500/30 bg-red-500/10'; // hand-rolled in N files
```

### Always do this

```tsx
<div className="animate-fade-up" />
<span className="text-status-alert" />
<StatusBadge tone="red">FLAGGED</StatusBadge>
```

### Tweaking a token-based utility

When one usage needs a different delay/duration, compose with arbitrary properties — still classes, never `style`:

```tsx
<div className="animate-fade-up [animation-delay:0.18s]" />
<div className="animate-session-fill animation-duration-[3s] repeat-[infinite]" />
```

**Why:** A keyframe referenced from an inline `style` is invisible to refactors and dead-code checks, can't be themed, and re-creates an object per render. A `--animate-*` / `--color-*` token is discoverable, greppable, theme-aware, and shows up in the `/components` design-system page automatically.

---

## Always Compose `className` with `cn()` (Policy)

**Rule:** Whenever a `className` is built from more than one piece — conditionals, props, variables, or merging a `className` prop — use `cn()` from `@/lib/utils`. Never use template literals, string concatenation, or array `.join(' ')` for class names. A single static string stays a plain string.

### Never do this

```tsx
<div className={`border p-3 ${accent ? 'border-primary/30' : 'border-border'}`} />
<span className={`w-3 h-3 ${spinning ? 'animate-spin' : ''}`} />
<div className={'base ' + extra} />
<div className={[base, extra].join(' ')} />
```

### Always do this

```tsx
import { cn } from '@/lib/utils';

<div className={cn('border p-3', accent ? 'border-primary/30' : 'border-border')} />
<span className={cn('w-3 h-3', spinning && 'animate-spin')} />
<div className={cn('base', extra)} />
```

### Conventions

- **`cond && 'classes'`** for optional classes — never `cond ? 'classes' : ''`.
- **`cond ? 'a' : 'b'`** only when both branches add classes.
- **Static classes first**, conditional/dynamic arguments after.
- **Consumer `className` props go last** so they can override: `cn('defaults', className)`.
- **Static-only `className`?** Keep it a plain string — `className="border p-3"`, not `cn('border p-3')`.

**Why:** `cn()` (clsx + `tailwind-merge`) resolves Tailwind conflicts deterministically, handles falsy values, and keeps conditional class logic readable and greppable. Template literals silently produce duplicate/conflicting classes and stray whitespace.

---

## Lazily Instantiate SDK Clients That Need Env Vars (Policy)

**Rule:** Never construct a third-party SDK client (auth providers, payment providers, etc.) at module scope with `new Sdk(process.env.KEY)`. Instantiate it lazily, inside a function, on first use.

### Never do this

```ts
// lib/workos.ts
export const workos = new WorkOS(process.env.WORKOS_API_KEY!, {
  clientId: process.env.WORKOS_CLIENT_ID!,
});
```

### Always do this

```ts
// lib/workos.ts
let workosClient: WorkOS | undefined;

export const getWorkOS = (): WorkOS => {
  if (!workosClient) {
    workosClient = new WorkOS(process.env.WORKOS_API_KEY!, {
      clientId: process.env.WORKOS_CLIENT_ID!,
    });
  }
  return workosClient;
};
```

**Why:** Next.js evaluates route modules (and everything they import) during "Collecting page data" at build time, regardless of a route's `dynamic` export. A module-scope `new Sdk(...)` call throws at build time in any environment without the real credentials (a fresh clone, CI before secrets are configured, a preview deploy), even for routes that only need the client at request time. `export const dynamic = 'force-dynamic'` does NOT prevent this — the throw happens during module evaluation, before rendering mode is even considered. A lazy getter defers construction to the first actual call, so the module loads cleanly with no credentials present, and only requests that reach the code path that needs the client will fail if it's genuinely missing at runtime.

---

_Last updated: auto-generated by agent. Keep in sync with `eslint.config.mjs`._
