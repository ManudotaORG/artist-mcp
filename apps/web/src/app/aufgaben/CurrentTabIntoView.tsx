'use client';

import { useEffect } from 'react';

/**
 * On a phone the row of views is wider than the screen, and a view at its far
 * end (Zu klären) would otherwise be selected but out of sight.
 */

type CurrentTabIntoViewProps = {
  current: string;
};

const CurrentTabIntoView = ({ current }: CurrentTabIntoViewProps) => {
  useEffect(() => {
    document
      .querySelector('nav[aria-label="Ansichten"] [aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);
  return null;
};

export { CurrentTabIntoView };
