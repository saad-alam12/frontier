import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, Notification, shell } from 'electron';
import { AppContext } from './context';
import { eventSink, registerIpc } from './api/handlers';
import { ChromiumPageRenderer } from './render/pagePictures';
import { externalUrl, isAppPage } from './api/navigation';
import { resumeGrading } from './services/practice';
import { badgeCount, takeReminder } from './services/reminders';

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
  if (mainWindow) showWindow();
});

/** How often an open app checks whether today's backup exists (it may stay open for days). */
const BACKUP_CHECK_MS = 3 * 3_600_000;
/** How often the reminder and the number on the icon are looked at. */
const REMINDER_CHECK_MS = 60_000;

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Flashcards to review, as the number on the app's icon; nothing when the learner switched it off. */
function updateBadge(ctx: AppContext): void {
  try {
    const count = ctx.settings.get().iconBadge ? badgeCount(ctx.db()) : 0;
    if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '');
    else app.setBadgeCount(count);
  } catch (error) {
    ctx.log.error('icon badge', error);
  }
}

/**
 * The daily reminder: a quiet notification, once a day at most, and only while the learner is not
 * looking at the app (someone in the app sees what is due on Today).
 */
function remind(ctx: AppContext): void {
  try {
    const settings = ctx.settings.get();
    if (!settings.reminderDaily || mainWindow?.isFocused() || !Notification.isSupported()) return;
    const text = takeReminder(ctx.db(), settings.reminderTime);
    if (!text) return;
    const notification = new Notification({ title: 'Time to study', body: text, silent: true });
    notification.on('click', showWindow);
    notification.show();
  } catch (error) {
    ctx.log.error('reminder', error);
  }
}

void app.whenReady().then(() => {
  if (!first) return;
  const ctx = new AppContext(
    app.getVersion(),
    join(app.getPath('userData'), 'settings.json'),
    join(app.getPath('home'), 'Frontier'),
    new ChromiumPageRenderer(),
  );
  context = ctx;
  ctx.log.info('app', `Frontier ${app.getVersion()} started on ${process.platform}`);
  // an error nothing caught: keep it, and keep the app running
  process.on('uncaughtException', (error) => ctx.log.error('uncaught', error));
  process.on('unhandledRejection', (reason) => ctx.log.error('unhandled', reason));
  try {
    ctx.db();
  } catch (error) {
    ctx.log.error('opening the data', error);
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
  const send = eventSink(() => mainWindow);
  ctx.sink = (event, payload) => {
    send(event, payload);
    if (event === 'cards.changed') updateBadge(ctx);
  };
  registerIpc(ctx, (url) => isAppPage(url, appUrl()));
  createWindow();
  ctx.backupIfDue();
  setInterval(() => ctx.backupIfDue(), BACKUP_CHECK_MS).unref();
  updateBadge(ctx);
  ctx.afterSettings = () => updateBadge(ctx);
  setInterval(() => {
    updateBadge(ctx);
    remind(ctx);
  }, REMINDER_CHECK_MS).unref();
  ctx.resumeGoalWork();
  resumeGrading(ctx.practiceDeps());
  // the hidden window that makes page pictures is not the app's window
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => context?.close());
