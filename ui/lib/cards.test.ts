import { describe, expect, it } from 'vitest';
import { keepLineBreaks, whenText } from './cards';

describe('card text', () => {
  it('keeps single line breaks, but not inside display math or around blank lines', () => {
    expect(keepLineBreaks('$Q$: queries\n$K$: keys')).toBe('$Q$: queries  \n$K$: keys');
    expect(keepLineBreaks('First\n\nSecond')).toBe('First\n\nSecond');
    expect(keepLineBreaks('The formula:\n$$\na = b\n+ c\n$$\nwhere')).toBe('The formula:\n$$\na = b\n+ c\n$$\nwhere');
    expect(keepLineBreaks('$$x^2$$\nthe square')).toBe('$$x^2$$  \nthe square');
  });

  it('says when a card is due in plain words', () => {
    const now = new Date('2026-03-02T12:00:00Z');
    expect(whenText({ suspended: false, phase: 'new', due: null }, now).text).toBe('New');
    expect(whenText({ suspended: false, phase: 'review', due: '2026-03-01T12:00:00Z' }, now)).toEqual({ text: 'Due now', due: true });
    expect(whenText({ suspended: false, phase: 'review', due: '2026-03-05T12:00:00Z' }, now).text).toBe('In 3 days');
    expect(whenText({ suspended: true, phase: 'review', due: '2026-03-01T12:00:00Z' }, now).text).toBe('Suspended');
  });
});
