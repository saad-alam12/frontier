/** What the window knows about the computer it runs on, for words and buttons that differ on a Mac. */
export const ON_A_MAC = /Mac/.test(navigator.userAgent);

/** The button that shows a file where it is on disk: Finder on a Mac, the file manager elsewhere. */
export const SHOW_IN_FOLDER = ON_A_MAC ? 'Show in Finder' : 'Show in folder';
