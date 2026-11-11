/**
 * Where the app's window may go and who may call the backend. The window shows one page, the app's
 * own; every other address (a link in an explanation or a source) opens in the system browser, and
 * only addresses a browser should open are passed on. Pure, so the rules are tested without Electron.
 */

/** The address to hand to the system browser, or null when it is not one a browser should open. */
export function externalUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
}

/**
 * True when `url` is the app's own page. `appUrl` is the dev server's address in development and the
 * `file:` address of the built `index.html` otherwise; a hash or query on the page does not matter.
 */
export function isAppPage(url: string, appUrl: string): boolean {
  let page: URL;
  let app: URL;
  try {
    page = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (app.protocol === 'file:') return page.protocol === 'file:' && page.pathname === app.pathname;
  return page.origin === app.origin;
}
