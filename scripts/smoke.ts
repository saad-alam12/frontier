/**
 * Start the real app on a fresh sandbox and walk through it: `npm run smoke`.
 *
 * Builds the app (skip with `--no-build`), makes a sandbox data folder in a temporary folder, starts
 * Electron on it with a debugging port, waits for Today, opens every place in the sidebar, a goal's
 * page, its notes and an idea on the map, and fails on any error the page throws. No model is called
 * and the learner's own data is never touched. On Linux it needs a display: run it under `xvfb-run -a`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';
import { connect } from './lib/cdp';
import type { Window } from './lib/cdp';

const PORT = 9341;
const PLACES = ['Today', 'Goals', 'Map', 'Cards', 'Stats', 'Lookup', 'Trails', 'Library', 'Settings'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // not there yet
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(250);
  }
}

const folder = mkdtempSync(join(tmpdir(), 'frontier-smoke-'));
const run = (args: string[]) => execFileSync('npx', args, { stdio: 'inherit' });
run(['tsx', 'scripts/sandbox.ts', folder]);
if (!process.argv.includes('--no-build')) run(['electron-vite', 'build']);

// as root (a container) Chromium refuses to start without this; a person's Mac never needs it
const rootFlags = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const app = spawn(electronPath as unknown as string, ['.', `--remote-debugging-port=${PORT}`, ...rootFlags], { env: { ...process.env, FRONTIER_USER_DATA: folder }, stdio: ['ignore', 'inherit', 'inherit'] });
const problems: string[] = [];
let window: Window | null = null;

try {
  window = await until('the app window', () => connect(PORT));
  const w = window;
  await w.send('Runtime.enable');
  w.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      const details = params['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
      problems.push(`page error: ${details?.exception?.description ?? details?.text ?? 'unknown'}`);
    }
  });
  await until('Today', () => w.evaluate<boolean>("Boolean(document.querySelector('.app') && document.querySelector('h1'))"));

  const open = async (label: string) => {
    const clicked = await w.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('nav button, nav a')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) throw new Error(`No "${label}" in the sidebar.`);
    await until(`${label} to show`, () => w.evaluate<boolean>("Boolean(document.querySelector('main h1, .main-column h1, .map-screen, canvas'))"), 10_000);
    await sleep(400);
  };
  for (const place of PLACES) {
    await open(place);
    console.log(`  ${place}: shown`);
  }

  // a goal's page and its notes
  await open('Goals');
  await w.evaluate("[...document.querySelectorAll('button, a, [role=button]')].find((x) => /game theory exam/i.test(x.textContent))?.click()");
  await until('a goal page', () => w.evaluate<boolean>("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Notes')"), 10_000);
  await w.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Notes').click()");
  await until('the notes', () => w.evaluate<boolean>("Boolean(document.querySelector('.notes-article'))"), 10_000);
  console.log('  A goal page and its notes: shown');

  // an idea on the map, found by name
  await open('Map');
  await w.evaluate("(() => { const i = document.querySelector('input[placeholder=\"Find an idea\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Nash equilibrium'); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(500);
  await w.evaluate("[...document.querySelectorAll('[role=option], li button')].find((x) => x.textContent.trim() === 'Nash equilibrium')?.click()");
  await until("an idea's card", () => w.evaluate<boolean>("Boolean(document.querySelector('.node-card'))"), 10_000);
  console.log("  An idea's card on the map: shown");
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
} finally {
  window?.close();
  app.kill('SIGTERM');
  await sleep(1000);
  rmSync(folder, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`Smoke: failed\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Smoke: passed');
