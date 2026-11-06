import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { AppContext } from './context';
import { eventSink, registerIpc } from './api/handlers';
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

// Day-month-year dates in native fields (the owner is in Germany; en-GB keeps the UI in English).
app.commandLine.appendSwitch('lang', 'en-GB');

void app.whenReady().then(() => {
  const ctx = new AppContext(
    app.getVersion(),
    join(app.getPath('userData'), 'settings.json'),
    join(app.getPath('home'), 'Frontier'),
  );
  context = ctx;
  ctx.db();
  ctx.emit = eventSink(() => mainWindow);
  registerIpc(ctx);
  createWindow();
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
