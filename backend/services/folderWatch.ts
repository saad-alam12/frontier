/**
 * Watched folders (design §7, "Watched folders"): a course folder the learner points at is looked
 * through when it is added, when the app starts, every few minutes, and when the system says something
 * in it changed. Each supported file that is new or changed is added like a file dropped on the
 * window: to the folder's goal as material (its role guessed), or to the Library and read.
 */
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { kindForFile } from '../ingest/readers';
import type { Source } from '../core/types';
import type { Database } from '../store/db';
import { getGoal } from '../store/goals';
import { listSources } from '../store/sources';
import { addWatchedFolder, listWatchedFolders, recordWatchedFile, removeWatchedFolder, watchedFiles } from '../store/watchedFolders';
import type { WatchedFolder } from '../store/watchedFolders';

/** How often every folder is looked through, besides the system's change notices. */
export const SCAN_EVERY_MS = 5 * 60_000;
/** A burst of changes (a file copied in parts) is looked at once, this long after the last. */
const SETTLE_MS = 3000;
/** Folders inside the watched one are looked through this deep. */
const MAX_DEPTH = 3;

export interface FolderWatchDeps {
  db: () => Database;
  /**
   * Add a file: for a goal, as its material (its role guessed; reading follows the goal); with no goal,
   * to the Library, where its reading starts.
   */
  addFile: (path: string, goalId: string | null) => Promise<{ source: Source; existed: boolean }>;
  /** New files arrived from a folder (for a notice). */
  onAdded?: (folder: string, titles: string[]) => void;
}

export interface WatchedFolderView {
  path: string;
  name: string;
  goalId: string | null;
  goalTitle: string | null;
  /** Files of the folder now in the Library. */
  files: number;
  /** Files that could not be read, with why. */
  problems: { name: string; error: string }[];
  /** False when the folder is gone (moved, renamed, an unplugged drive). */
  present: boolean;
}

/** Files that are never material: hidden files and the lock files office programs leave. */
const skipName = (name: string) => name.startsWith('.') || name.startsWith('~$') || name.endsWith('.tmp');

async function supportedFiles(folder: string, depth = 0): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (skipName(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth < MAX_DEPTH) out.push(...(await supportedFiles(path, depth + 1)));
    else if (entry.isFile() && kindForFile(path)) out.push(path);
  }
  return out.sort();
}

export class FolderWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly scanning = new Map<string, Promise<number>>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: FolderWatchDeps) {}

  /** Look through every folder now, then keep watching. */
  start(): void {
    this.sync();
    void this.scanAll();
    this.interval ??= setInterval(() => {
      this.sync();
      void this.scanAll();
    }, SCAN_EVERY_MS);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Start watching a folder (for a goal, or for the Library) and look through it at once. */
  async add(path: string, goalId: string | null): Promise<number> {
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) throw new Error('That is not a folder that can be read.');
    addWatchedFolder(this.deps.db(), path, goalId);
    this.sync();
    return this.scan(path);
  }

  remove(path: string): void {
    removeWatchedFolder(this.deps.db(), path);
    this.sync();
  }

  async scanAll(): Promise<number> {
    let added = 0;
    for (const folder of listWatchedFolders(this.deps.db())) added += await this.scan(folder.path);
    return added;
  }

  /** Look through one folder; one scan of a folder runs at a time. Returns how many files were added. */
  scan(path: string): Promise<number> {
    const running = this.scanning.get(path);
    if (running) return running;
    const job = this.scanOnce(path).finally(() => this.scanning.delete(path));
    this.scanning.set(path, job);
    return job;
  }

  private async scanOnce(path: string): Promise<number> {
    const folder = listWatchedFolders(this.deps.db()).find((f) => f.path === path);
    if (!folder) return 0;
    const seen = watchedFiles(this.deps.db(), path);
    const added: string[] = [];
    for (const file of await supportedFiles(path)) {
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      const before = seen.get(file);
      if (before && before.size === info.size && before.mtimeMs === info.mtimeMs) continue;
      let sourceId: string | null = null;
      let error: string | null = null;
      try {
        const goalId = folder.goalId && getGoal(this.deps.db(), folder.goalId) ? folder.goalId : null;
        const { source, existed } = await this.deps.addFile(file, goalId);
        sourceId = source.id;
        if (!existed) added.push(source.title);
      } catch (e) {
        // a file that cannot be read is noted once and tried again only when it changes
        error = e instanceof Error ? e.message : String(e);
      }
      recordWatchedFile(this.deps.db(), { path: file, folder: path, size: info.size, mtimeMs: info.mtimeMs, sourceId, error });
    }
    if (added.length) this.deps.onAdded?.(path, added);
    return added.length;
  }

  /** System change notices for each watched folder, and none for folders no longer watched. */
  private sync(): void {
    const wanted = new Set(listWatchedFolders(this.deps.db()).map((f) => f.path));
    for (const [path, w] of this.watchers) {
      if (!wanted.has(path)) {
        w.close();
        this.watchers.delete(path);
      }
    }
    for (const path of wanted) {
      if (this.watchers.has(path)) continue;
      try {
        const watcher = watch(path, { recursive: true }, () => this.soon(path));
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(path);
        });
        this.watchers.set(path, watcher);
      } catch {
        // no change notices here (a network drive, an unsupported system): the timer still looks
      }
    }
  }

  private soon(path: string): void {
    const pending = this.timers.get(path);
    if (pending) clearTimeout(pending);
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        void this.scan(path);
      }, SETTLE_MS),
    );
  }
}

/** The watched folders as the Library shows them. */
export async function watchedFolderViews(db: Database): Promise<WatchedFolderView[]> {
  const known = new Set(listSources(db).map((s) => s.id));
  const views: WatchedFolderView[] = [];
  for (const folder of listWatchedFolders(db)) views.push(await view(db, folder, known));
  return views;
}

async function view(db: Database, folder: WatchedFolder, known: Set<string>): Promise<WatchedFolderView> {
  const files = [...watchedFiles(db, folder.path).values()];
  const goal = folder.goalId ? getGoal(db, folder.goalId) : undefined;
  const present = (await stat(folder.path).catch(() => null))?.isDirectory() ?? false;
  return {
    path: folder.path,
    name: basename(folder.path) || folder.path,
    goalId: goal ? folder.goalId : null,
    goalTitle: goal ? (goal.title ?? goal.text) : null,
    files: files.filter((f) => f.sourceId && known.has(f.sourceId)).length,
    problems: files.filter((f) => f.error).map((f) => ({ name: basename(f.path), error: f.error ?? '' })),
    present,
  };
}
