import type { ReadResult, TextBlock } from '../types';

/** Split Markdown or plain text into blocks at headings; the locator is the heading path. */
export function readMarkdown(text: string, fallbackTitle: string): ReadResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: TextBlock[] = [];
  const path: string[] = [];
  let current: string[] = [];
  let title = fallbackTitle;
  let inFence = false;

  const flush = () => {
    const body = current.join('\n').trim();
    if (body) blocks.push({ text: body, locator: path.join(' > ') || 'start' });
    current = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] as string).length;
      const name = heading[2] as string;
      if (level === 1 && title === fallbackTitle) title = name;
      path.splice(level - 1);
      path[level - 1] = name;
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  if (blocks.length === 0) blocks.push({ text: text.trim(), locator: 'start' });
  return { title, blocks };
}
