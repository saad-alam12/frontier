import { useEffect, useId, useState } from 'react';
import type { Mermaid } from 'mermaid';
import { DrawingFailed } from './Plot';
import './Diagram.css';

let loading: Promise<Mermaid> | null = null;

/** Mermaid is large: it loads the first time a diagram is shown, set up in the app's colours. */
function mermaidLib(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false,
      // no scripts, links or HTML from the diagram's text: it can come from a source the learner added
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: token('--font-sans'),
      // compact, so a diagram fits the card's width without shrinking its text
      flowchart: { nodeSpacing: 24, rankSpacing: 28, padding: 10, diagramPadding: 4 },
      themeVariables: {
        darkMode: true,
        fontSize: '14px',
        background: token('--surface'),
        primaryColor: token('--surface-raised'),
        primaryTextColor: token('--text'),
        primaryBorderColor: token('--ring'),
        secondaryColor: token('--chip-selected'),
        secondaryTextColor: token('--text'),
        secondaryBorderColor: token('--ring'),
        tertiaryColor: token('--surface'),
        tertiaryTextColor: token('--text'),
        tertiaryBorderColor: token('--border-strong'),
        lineColor: token('--text-muted'),
        textColor: token('--text-soft'),
        mainBkg: token('--surface-raised'),
        nodeBorder: token('--ring'),
        clusterBkg: token('--surface'),
        clusterBorder: token('--border-strong'),
        edgeLabelBackground: token('--surface'),
        noteBkgColor: token('--chip-selected'),
        noteTextColor: token('--text'),
        noteBorderColor: token('--ring'),
        actorBkg: token('--surface-raised'),
        actorBorder: token('--ring'),
        actorTextColor: token('--text'),
        signalColor: token('--text-muted'),
        signalTextColor: token('--text-soft'),
      },
    });
    return mermaid;
  });
  return loading;
}

/** A diagram from a fenced `mermaid` block (design §4.2, "Diagrams and plots"): a flow, a tree, states, steps. */
export function Diagram({ source }: { source: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void (async () => {
      try {
        const mermaid = await mermaidLib();
        // parse first: a diagram that does not parse is shown as text, without Mermaid's error picture
        if (!(await mermaid.parse(source, { suppressErrors: true }))) throw new Error('does not parse');
        const out = await mermaid.render(id, source);
        if (live) setSvg(out.svg);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, source]);
  if (failed) return <DrawingFailed source={source} what="diagram" />;
  // a wide diagram shrinks to fit, but its text never below 80% of its size: past that it scrolls sideways
  const natural = svg ? Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(svg)?.[1]) : NaN;
  return (
    <figure className="drawing diagram" aria-busy={svg === null}>
      {/* Mermaid's own output, sanitised by it in strict mode */}
      {svg && <div className="diagram-canvas" style={Number.isFinite(natural) ? { minWidth: Math.round(natural * 0.8) } : undefined} dangerouslySetInnerHTML={{ __html: svg }} />}
    </figure>
  );
}

/** While a card is being written, a drawing is not drawn yet: its text is still arriving. */
export function DrawingPending({ what }: { what: 'plot' | 'diagram' }) {
  return (
    <figure className="drawing is-pending">
      <figcaption className="t-caption text-muted">A {what} comes here.</figcaption>
    </figure>
  );
}
