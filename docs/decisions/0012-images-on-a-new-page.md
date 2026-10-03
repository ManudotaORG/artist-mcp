# 0012 — Images on a new page

Date: 2026-10-03

Status: **built and verified live on 2026-10-03**, through Claude Desktop against
a generated rider PDF and a JPEG sent to the test Gmail account. Read back from
OneNote:

- one page held the PDF stage plot as a PNG at its full 1800x1100 and the JPEG
  unchanged, each with its caption above and its source line below
- a second page held a crop the model chose from the 900x550 picture it was
  shown, stored as a 468x308 cut of just the drum riser
- the write log named every image source

A crop asked of the JPEG was refused, with no page and no write. The model
refused from the schema wording, so the server's own refusal ran only in tests.
The on-page display width (800 px) was not checked.

## Decision

`create_onenote_page` takes an optional `images` list. Each entry names a Gmail
attachment by message id and MIME position, the same pair
`read_gmail_attachment` takes:

- **An image file** (JPEG, PNG, GIF) goes onto the page exactly as it arrived.
- **A picture inside a PDF** is named by `page` and `index`: image 2 on page 3,
  numbered the way `read_gmail_attachment` announces it. It can be cropped with
  `crop`, given as fractions of the picture as shown.

The images go after the body, in order. An optional caption goes above each one
and a source line below it, so the page says where each picture came from.

No new capability. It is still `onenote-create` under `Notes.Create`.

## Why

Riders and tech specs arrive as email attachments, and the part the crew needs
(the stage plot or the floor plan) is a picture. The text extraction cannot carry
it. Until now the only way to get it into the notebook was by hand.

`create_onenote_page` first, not the edit tool: the musician's own concert pages
are out of reach of `onenote-edit` (Microsoft returns `401` on any page this app
did not create), so a new page beside the concert page is the only write that
works everywhere.

## How it is built

- **The model never handles image data.** It passes a reference, and the server
  fetches the bytes. Retyping an image as base64 would be expensive and
  unreliable, and Claude Desktop does not hand uploaded images to MCP tools
  anyway.
- **Two operations, two tokens.** A Gmail call must never spend a Microsoft
  token, and the token is resolved from the operation table before the call
  runs. So the tool handler calls a new read row, `load_gmail_image` (Google),
  once per image, then passes the bytes to `create_onenote_page` (Microsoft) as
  a field only the handler sets. This is the same pattern `list_notes` uses for
  `sections`.
- **Everything is fetched before anything is written.** If any image fails, no
  page is created.
- **One multipart POST.** OneNote takes the page as a `Presentation` part plus
  one part per image, referenced as `<img src="name:...">`. There is still one
  create path in `api.ts` and no retry, for the reason 0003 gives.
- **Only the server writes markup.** The caption is escaped like the body, and
  the `img` tag is composed by the server. The edit path keeps refusing `img`
  from a caller ([onenote-patch.ts](../../apps/mcp/src/onenote-patch.ts)); this
  does not loosen that.

## Limits

- At most 3 images per page, from attachments within the existing 10 MB cap.
- An image file is never decoded. A decoder for hostile input is what this
  component avoids (see `imageSize` in `attachments.ts`), so an image file
  cannot be cropped. A PDF picture can, because pdf.js has already decoded it to
  pixels and the encoder is ours.
- A PDF picture is stored up to 2000 px on its long edge, larger than the 1200 px
  sent to chat, because the notebook is where someone reads the plot at full size.
- A crop smaller than 32 px either way is refused.

## Not in this decision

- **Pictures inside a Word document.** `read_gmail_attachment` does not show
  them, so there is no way to choose one, and picking one blind is not a
  feature. Showing them would be a change to the read tool and its cost.
- **A section of a PDF that is text or drawing**, not an embedded picture. That
  needs the page rendered. A possible route that needs no native canvas is to
  cut out the page with `pdf-lib`, set its crop box, and let OneNote render it
  (`data-render-src`). Whether OneNote respects the crop box is unknown, so that
  is a spike, not a plan.
- **Images from a OneNote page** (`read_page_attachment`), **URLs**, and
  **adding an image to an existing page**.

## Cost

- **The tool schema changes.** With every write granted, the tool list sent with
  every request grows by 919 characters (about 230 tokens, 2.6%), whether or not
  a picture is ever placed. Measured with `context-budget`, after cutting the
  first draft's 1,228. Clients see `images` only after refreshing the tool list. It is optional, so a client holding the old schema keeps working.
  A required parameter on a cached schema deadlocks the client.
- **The read tool's announcements gain an index.** "Page 3, image 2" in place of
  "Page 3", so a picture can be named back. That is a few tokens per picture
  shown.
- **A page with images needs Google connected** as well as Microsoft.
- **A wrong page is still removed by hand** in OneNote (0009).
