/**
 * Live check of "Add a link": `npm run live:link -- <address>`. It fetches the address exactly as
 * the app does and prints what would be read: the kind, the title and the first parts. Nothing is
 * stored and no model is called. For a video it prints the title the transcript step would show.
 */
import { parseLink } from '../backend/core/links';
import { fetchDocument, fetchVideoTitle } from '../backend/ingest/link';
import { readBytes } from '../backend/ingest/readers';

const address = process.argv[2];
const link = address ? parseLink(address) : null;
if (!link) {
  console.log('Give a web address: npm run live:link -- https://example.org/page');
  process.exit(1);
}
const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
if (link.kind === 'video') {
  const title = await fetchVideoTitle(fetcher, link.url, 'Frontier/live-check');
  console.log(`A video. The app asks for its transcript. Title found: ${title || '(none)'}`);
  process.exit(0);
}
try {
  const document = await fetchDocument(fetcher, link.url, 'Frontier/live-check');
  const read = await readBytes(document.kind, document.bytes, document.name);
  const characters = read.blocks.reduce((n, b) => n + b.text.length, 0);
  console.log(`Kind: ${document.kind} · ${Math.round(document.bytes.length / 1024)} KB · stored as ${document.name}`);
  console.log(`Title: ${read.title}`);
  console.log(`Parts: ${read.blocks.length} · ${characters} characters of text`);
  for (const block of read.blocks.slice(0, 3)) console.log(`\n[${block.locator}]\n${block.text.slice(0, 400)}`);
} catch (error) {
  console.log(`Could not be read: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
