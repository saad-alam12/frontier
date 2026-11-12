/** Where in a source a citation points: "p12" (a page), "p2–p4" (pages), or a heading or slide. */

/** The first page a citation names, or null when it names something else. */
export function citedPage(locator: string | null | undefined): number | null {
  const page = /^p(\d+)/.exec(locator ?? '');
  return page ? Number(page[1]) : null;
}

/** A citation as the learner reads it: "p 12", "pp 2–4", or the heading as it is. */
export function locatorLabel(locator: string): string {
  const range = /^p(\d+)–p(\d+)$/.exec(locator);
  if (range) return `pp ${range[1]}–${range[2]}`;
  const page = /^p(\d+)$/.exec(locator);
  return page ? `p ${page[1]}` : locator;
}
