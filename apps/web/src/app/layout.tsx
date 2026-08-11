import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const pixelify = localFont({
  src: '../assets/fonts/pixelify-sans.ttf',
  variable: '--font-pixelify',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'artist-mcp — OneNote workflows for musicians',
  description:
    'Connect OneNote to Claude Desktop or Codex and turn one project page into one useful next result.',
};

const RootLayout = ({ children }: LayoutProps<'/'>) => {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelify.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          THESIS: A musician workflow presented as an immediate teletext service, refusing generic SaaS cards.
          OWN-WORLD: Black broadcast field, bitmap display, cyan rules, yellow actions, blue navigation, explicit signal states.
          STORY: Understand the one-page workflow, trust its read-only boundary, then sign in and connect.
          FIRST VIEWPORT: Masthead, dominant promise, magic-link action, and one horizontal verified workflow path.
          FORM: Calmer progressive service page, approved comp teletext-c, seed 9340cbd4.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
};

export default RootLayout;
