/**
 * A small client for the Chrome DevTools Protocol of a running Frontier window, for the dev scripts
 * (`scripts/cdp.ts`, `scripts/smoke.ts`). No dependency: Node's built-in fetch and WebSocket.
 */

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface Window {
  send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Evaluate an expression in the page (promises awaited) and return its value. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Be told of protocol events (after enabling their domain). */
  on(handler: (method: string, params: Record<string, unknown>) => void): void;
  close(): void;
}

/** The app's window on this port (the first page that is not the developer tools). */
export async function connect(port: number | string): Promise<Window> {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];
  // the app's page, not the hidden window that draws PDF pages, nor the developer tools
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://') && !t.url.includes('pages.html'));
  if (!page) throw new Error(`no app window on port ${port}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to the window')), { once: true });
  });
  let nextId = 1;
  const handlers: ((method: string, params: Record<string, unknown>) => void)[] = [];
  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as { method?: string; params?: Record<string, unknown> };
    if (message.method) for (const h of handlers) h(message.method, message.params ?? {});
  });
  const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
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
  };
  return {
    send,
    async evaluate<T>(expression: string): Promise<T> {
      const result = await send<{ result: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value as T;
    },
    on: (handler) => handlers.push(handler),
    close: () => socket.close(),
  };
}
