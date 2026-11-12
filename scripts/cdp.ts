/**
 * Drive a running Frontier window over the Chrome DevTools Protocol, for screenshots and checks in
 * development (the protocol client is `scripts/lib/cdp.ts`).
 *
 * Start the app on a sandbox (never the learner's data folder) with a debugging port:
 *   FRONTIER_USER_DATA=/path/to/sandbox npx electron-vite dev --remoteDebuggingPort 9333
 * (the sandbox folder holds a settings.json whose `dataFolder` points at a test folder). Then:
 *   npx tsx scripts/cdp.ts 9333 shot out.png      saves a PNG of the window
 *   npx tsx scripts/cdp.ts 9333 eval "document.title"   prints the result as JSON (promises awaited)
 *   npx tsx scripts/cdp.ts 9333 print out.png     saves a PNG of the window with its print styles
 */
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp';

const [portArg, command, arg] = process.argv.slice(2);
if (!portArg || !command || !arg || !['shot', 'eval', 'print'].includes(command)) {
  console.error('usage: tsx scripts/cdp.ts <port> shot <file.png> | print <file.png> | eval "<expression>"');
  process.exit(2);
}

const window = await connect(portArg);
if (command === 'shot') {
  const { data } = await window.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(data, 'base64'));
  console.log(arg);
} else if (command === 'print') {
  // Electron's window offers no PDF over this protocol; the print styles show on screen instead
  await window.send('Emulation.setEmulatedMedia', { media: 'print' });
  const { data } = await window.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await window.send('Emulation.setEmulatedMedia', { media: '' });
  writeFileSync(arg, Buffer.from(data, 'base64'));
  console.log(arg);
} else {
  console.log(JSON.stringify((await window.evaluate(arg)) ?? null, null, 2));
}
window.close();
