import { cva, type VariantProps } from 'class-variance-authority';
import { type ElementType, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const typographyVariants = cva('', {
  variants: {
    variant: {
      display: 'font-display text-5xl leading-[0.9] font-bold uppercase sm:text-6xl lg:text-7xl',
      pageTitle: 'font-display text-3xl leading-none font-bold uppercase sm:text-4xl',
      sectionTitle: 'font-display text-xl leading-none font-bold uppercase sm:text-2xl',
      label: 'font-mono text-sm font-bold uppercase tracking-wide',
      body: 'max-w-[70ch] font-mono text-base leading-relaxed',
      small: 'font-mono text-sm leading-relaxed',
    },
    color: {
      default: 'text-foreground',
      yellow: 'text-signal-yellow',
      cyan: 'text-signal-cyan',
      green: 'text-signal-green',
      red: 'text-signal-red',
      muted: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'body', color: 'default' },
});

type TypographyProps = VariantProps<typeof typographyVariants> & {
  as?: ElementType;
  children: ReactNode;
  className?: string;
};

const Typography = ({
  as: Component = 'p',
  variant,
  color,
  className,
  children,
}: TypographyProps) => (
  <Component
    data-slot="typography"
    className={cn(typographyVariants({ variant, color }), className)}
  >
    {children}
  </Component>
);

export { Typography, typographyVariants };
