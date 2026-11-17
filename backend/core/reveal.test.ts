import { describe, expect, it } from 'vitest';
import { revealTarget } from './reveal';

const there = (paths: string[]) => (path: string) => paths.includes(path);

describe('revealTarget (R8 E7)', () => {
  it('shows a file where the learner keeps it, and the stored copy when that file is gone', () => {
    const source = { kind: 'pdf' as const, origin: null, originalPath: '/Users/me/Course/Lecture 1.pdf' };
    expect(revealTarget(source, '/data/sources/ab12-Lecture 1.pdf', there(['/Users/me/Course/Lecture 1.pdf', '/data/sources/ab12-Lecture 1.pdf']))).toEqual({ kind: 'file', path: '/Users/me/Course/Lecture 1.pdf', stored: false });
    expect(revealTarget(source, '/data/sources/ab12-Lecture 1.pdf', there(['/data/sources/ab12-Lecture 1.pdf']))).toEqual({ kind: 'file', path: '/data/sources/ab12-Lecture 1.pdf', stored: true });
    expect(revealTarget(source, '/data/sources/ab12-Lecture 1.pdf', there([]))).toBeNull();
  });

  it('shows the stored copy of a file added before the original place was kept', () => {
    expect(revealTarget({ kind: 'docx', origin: null, originalPath: null }, '/data/sources/cd34-Notes.docx', there(['/data/sources/cd34-Notes.docx']))).toEqual({ kind: 'file', path: '/data/sources/cd34-Notes.docx', stored: true });
  });

  it('opens the page of a source added by a link, a pasted video transcript too', () => {
    expect(revealTarget({ kind: 'pdf', origin: 'https://example.org/paper.pdf', originalPath: null }, '/data/sources/ef56-paper.pdf', there(['/data/sources/ef56-paper.pdf']))).toEqual({ kind: 'page', url: 'https://example.org/paper.pdf' });
    expect(revealTarget({ kind: 'text', origin: 'https://www.youtube.com/watch?v=abc', originalPath: null }, null, there([]))).toEqual({ kind: 'page', url: 'https://www.youtube.com/watch?v=abc' });
  });

  it('has nothing to show for pasted text and sessions', () => {
    expect(revealTarget({ kind: 'markdown', origin: null, originalPath: null }, null, there([]))).toBeNull();
    expect(revealTarget({ kind: 'session', origin: null, originalPath: null }, '/data/sources/x', there(['/data/sources/x']))).toBeNull();
  });
});
