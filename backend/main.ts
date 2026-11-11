import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import { AppContext } from './context';
import { eventSink, registerIpc } from './api/handlers';
import { externalUrl, isAppPage } from './api/navigation';
import { resumeGrading } from './services/practice';

let mainWindow: BrowserWindow | null = null;
let context: AppContext | null = null;

/**
 * On macOS the window gets an inset title bar (the traffic lights sit in the sidebar) and a
 * translucent sidebar material; the renderer paints everything else opaque. Windows and Linux keep
 * the standard frame and an opaque sidebar, because they have no matching material.
 */
const MAC_CHROME: Electron.BrowserWindowConstructorOptions =
  process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
    : { backgroundColor: '#141311' };

function createWindow(): void {
  // The palette is dark only, so native materials and menus must not follow a light system theme.
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    ...MAC_CHROME,
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'Frontier',
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // The window only ever shows the app's own page. A link (in an explanation, a source, a flashcard)
  // opens in the system browser instead: a page loaded here would replace the app with no way back
  // and could reach the backend through the preload bridge.
  const openOutside = (url: string) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppPage(url, appUrl())) return;
    event.preventDefault();
    openOutside(url);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(rendererFile());
}

const rendererFile = () => join(import.meta.dirname, '../renderer/index.html');
/** The address of the app's own page: the dev server in development, the built file otherwise. */
const appUrl = () => process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(rendererFile()).href;

// Day-month-year dates in native fields (the owner is in Germany; en-GB keeps the UI in English).
app.commandLine.appendSwitch('lang', 'en-GB');

// Development and screenshots: a separate settings file (and so a separate data folder) keeps test
// runs away from the learner's own map. Must be set before `ready`, when the path is first read.
const sandbox = process.env['FRONTIER_USER_DATA'];
if (sandbox) app.setPath('userData', sandbox);

// One copy of the app per data folder: two would both write to the same database and both run its
// background work. A second start brings the first window forward instead. (Set after the sandbox
// path above, so a development run on sandbox data does not collide with the real app.)
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

/** How often an open app checks whether today's backup exists (it may stay open for days). */
const BACKUP_CHECK_MS = 3 * 3_600_000;

void app.whenReady().then(() => {
  if (!first) return;
  const ctx = new AppContext(
    app.getVersion(),
    join(app.getPath('userData'), 'settings.json'),
    join(app.getPath('home'), 'Frontier'),
  );
  context = ctx;
  try {
    ctx.db();
  } catch (error) {
    // The data cannot be opened (damaged, or written by a newer version). Say so and stop: starting
    // on a fresh database would look as if everything was gone.
    const paths = ctx.paths();
    dialog.showErrorBox(
      'Frontier cannot open your data',
      `${error instanceof Error ? error.message : String(error)}\n\nYour data: ${paths.db}\nBackups (one per day): ${paths.backups}\n\nTo go back to a backup, quit Frontier, copy a backup file over frontier.db and start again.`,
    );
    app.quit();
    return;
  }
  ctx.emit = eventSink(() => mainWindow);
  registerIpc(ctx, (url) => isAppPage(url, appUrl()));
  createWindow();
  ctx.backupIfDue();
  setInterval(() => ctx.backupIfDue(), BACKUP_CHECK_MS).unref();
  ctx.resumeGoalWork();
  resumeGrading(ctx.practiceDeps());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => context?.close());
