/**
 * Where the API key is kept: sealed with the system's keychain (Electron's `safeStorage`, the macOS
 * Keychain or the platform's equivalent), never in plain text in the settings file. The settings store
 * takes the box as a dependency, so it stays plain Node and tests can give it a fake.
 */
export interface SecretBox {
  /** False when the system offers no keychain (some Linux setups): the key is then kept as before. */
  available(): boolean;
  /** The text sealed, as base64. */
  seal(text: string): string;
  /** The text back; throws when it cannot be opened (sealed on another computer or for another user). */
  open(sealed: string): string;
}
