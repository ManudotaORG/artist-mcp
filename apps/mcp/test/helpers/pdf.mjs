/**
 * Building blocks for tests that need a real PDF or a page of prose.
 *
 * Lifted out of attachments.test.mjs when a second test file needed them.
 * Shared rather than copied: a generator that drifts between two files makes
 * two suites that agree with each other and not with the extractor.
 */

/**
 * Build a PDF by hand, one content stream per page.
 *
 * A page given no text draws nothing, which is how a page carrying only a
 * scanned image looks to a text extractor — the case a real rider's stage plan
 * lands in. A page can also be given an image, so the combination that matters
 * most (prose and a diagram together) is expressible. Generating these beats
 * committing someone's actual contract.
 *
 * Image data goes in as ASCIIHexDecode: it keeps every byte of the file
 * printable, so the whole generator stays a string.
 */
export function minimalPdf(specs) {
  const pages = specs.map((spec) =>
    spec === null || typeof spec === "string" ? { text: spec } : spec
  );
  const objects = [];
  const kids = [];
  // 1 = catalogue, 2 = page tree, 3 = font, then a page, a stream and
  // optionally an image per page.
  let next = 4;
  pages.forEach(({ text, image }) => {
    const pageObj = next++;
    const streamObj = next++;
    const imageObj = image ? next++ : null;
    kids.push(`${pageObj} 0 R`);

    const xobject = imageObj ? ` /XObject << /Im0 ${imageObj} 0 R >>` : "";
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >>${xobject} >> /Contents ${streamObj} 0 R >>`;

    // Laid out as lines rather than one enormous string: a single Tj does not
    // survive extraction intact past a hundred characters or so, and a real
    // page is lines anyway.
    const lines = (text ?? "").match(/.{1,80}/g) ?? [];
    const drawText = text == null
      ? ""
      : `BT /F1 12 Tf 72 720 Td 14 TL\n` +
        lines
          .map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`)
          .join("\n") +
        `\nET\n`;
    // q/cm/Do: scale the unit image square up to something page-sized.
    const drawImage = image ? `q 400 0 0 500 100 100 cm /Im0 Do Q` : "";
    const content = `${drawText}${drawImage}`;
    objects[streamObj] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

    if (image && imageObj) {
      // Mid-grey throughout: the encoder only has to survive it, not read it.
      const hex = "80".repeat(image.width * image.height * 3);
      objects[imageObj] =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} ` +
        `/Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /ASCIIHexDecode /Length ${hex.length + 1} >>\n` +
        `stream\n${hex}>\nendstream`;
    }
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/** A page's worth of prose: anything shorter reads as a header, by design. */
export const page = (text) =>
  `${text} ${"The Promoter shall provide sound, lighting and hospitality. ".repeat(4)}`;
