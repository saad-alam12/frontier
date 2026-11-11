import { describe, expect, it } from 'vitest';
import { externalUrl, isAppPage } from './navigation';

describe('links leave the app through the system browser', () => {
  it('passes on web and mail addresses only', () => {
    expect(externalUrl('https://example.org/paper.pdf')).toBe('https://example.org/paper.pdf');
    expect(externalUrl('http://example.org')).toBe('http://example.org/');
    expect(externalUrl('mailto:someone@example.org')).toBe('mailto:someone@example.org');
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://server/share', 'vscode://open', 'not a url', '']) expect(externalUrl(url)).toBeNull();
  });
});

describe('only the app’s own page may stay in the window and call the backend', () => {
  it('in development: the dev server, whatever the path', () => {
    const app = 'http://localhost:5173/';
    expect(isAppPage('http://localhost:5173/', app)).toBe(true);
    expect(isAppPage('http://localhost:5173/index.html#map', app)).toBe(true);
    expect(isAppPage('http://localhost:5174/', app)).toBe(false);
    expect(isAppPage('https://example.org/', app)).toBe(false);
  });

  it('in the built app: exactly the built page', () => {
    const app = 'file:///Applications/Frontier.app/Contents/Resources/app.asar/out/renderer/index.html';
    expect(isAppPage(app, app)).toBe(true);
    expect(isAppPage(`${app}#goals`, app)).toBe(true);
    expect(isAppPage('file:///Users/me/Downloads/page.html', app)).toBe(false);
    expect(isAppPage('https://example.org/', app)).toBe(false);
    expect(isAppPage('nonsense', app)).toBe(false);
  });
});
