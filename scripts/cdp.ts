/**
 * Drive a running Frontier window over the Chrome DevTools Protocol, for screenshots and checks in
 * development. No dependency: Node's built-in fetch and WebSocket.
 *
 * Start the app on a sandbox (never the learner's data folder) with a debugging port:
 *   FRONTIER_USER_DATA=/path/to/sandbox npx electron-vite dev --remoteDebuggingPort 9333
 * (the sandbox folder holds a settings.json whose `dataFolder` points at a test folder). Then:
 *   npx tsx scripts/cdp.ts 9333 shot out.png      saves a PNG of the window
 *   npx tsx scripts/cdp.ts 9333 eval "document.title"   prints the result as JSON (promises awaited)
 */
import { writeFileSync } from 'node:fs';

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const [portArg, command, arg] = process.argv.slice(2);
if (!portArg || !command || !arg || !['shot', 'eval'].includes(command)) {
  console.error('usage: tsx scripts/cdp.ts <port> shot <file.png> | eval "<expression>"');
  process.exit(2);
}

const targets = (await (await fetch(`http://127.0.0.1:${portArg}/json/list`)).json()) as Target[];
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) throw new Error(`no app window on port ${portArg}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.addEventListener('open', () => resolve(), { once: true });
  socket.addEventListener('error', () => reject(new Error('could not connect to the window')), { once: true });
});

let nextId = 1;
function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message: string } };
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result as T);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

if (command === 'shot') {
  const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(data, 'base64'));
  console.log(arg);
} else {
  const result = await send<{ result: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
    expression: arg,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value ?? null, null, 2));
}
socket.close();
