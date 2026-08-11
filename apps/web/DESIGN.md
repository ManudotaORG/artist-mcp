# Artist Teletext

<!-- impeccable:design-schema 1 -->

## Visual World

artist-mcp uses the grammar of a broadcast teletext service: black field,
high-contrast fixed-cell typography, cyan live information, yellow actions and
headlines, green success, red errors, and blue navigation. It should feel like
a useful service musicians can call up immediately, not nostalgic decoration.

## Composition

The public route behaves as a broadcast service magazine with a strong first
page, a live workflow demonstration, installation sections, and explicit trust
information. It does not use teletext page numbers. The authenticated route uses the same system as a connection
status and setup console. Desktop may use a 40-column-inspired grid; small
screens reflow semantically rather than shrinking an unreadable fixed canvas.

## Components and States

- Square or minimally rounded controls, heavy visible focus, uppercase action labels.
- Yellow indicates primary action; cyan is live/read information; green is connected/success; red is error or destructive action; blue carries navigation.
- Dividers are crisp cyan rules. Panels are regions in one broadcast field, not floating cards.
- Loading, active, disabled, success, and error states must be named in text.

## Type and Motion

Use a self-hosted or framework-loaded bitmap/display face for headlines and a
legible monospaced workhorse for body copy and code. The signature motion is a
brief page-tuning reveal and stoppable cursor blink; reduced-motion users see
the complete page immediately.

## Accessibility

Semantic document flow outranks a literal 40×24 grid. Maintain readable body
sizes, keyboard navigation, visible labels, and sufficient contrast. Never rely
on color or blinking alone to convey state.
