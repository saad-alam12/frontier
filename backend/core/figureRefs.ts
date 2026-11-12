/**
 * How the tutor shows a page picture in its text (design §4.2, "Figures"): a Markdown image whose
 * address is `figure:<id>`, as in `![The encoder stack](figure:fig_k3j9x0a2qf)`. Pure: the tutor's
 * output is checked here, the renderer draws the picture.
 */

const REF = /\]\(figure:([a-z0-9_]+)\)/g;

/** The figure ids a text shows, in order. */
export function figureRefs(text: string): string[] {
  return [...text.matchAll(REF)].map((m) => m[1] as string);
}

/** Every figure id shown anywhere in a value's strings that is not one of `allowed`. */
export function unknownFigureRefs(value: unknown, allowed: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      for (const id of figureRefs(v)) if (!allowed.has(id)) out.add(id);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(value);
  return [...out];
}
