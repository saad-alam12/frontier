/**
 * Reading a JSON object while it is still being written (a model's tool input, streamed): the text of
 * one string field so far. Pure, and tolerant of everything an unfinished document can end in.
 */

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * The value of the last string field named `key` in `json` so far, decoded; null when it has not
 * started. An escape cut off at the end is left out until the rest of it arrives.
 */
export function partialStringField(json: string, key: string): string | null {
  const opening = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
  let start = -1;
  for (let found = opening.exec(json); found; found = opening.exec(json)) start = found.index + found[0].length;
  if (start < 0) return null;
  let out = '';
  for (let i = start; i < json.length; i += 1) {
    const c = json[i] as string;
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) return out;
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return out;
}
