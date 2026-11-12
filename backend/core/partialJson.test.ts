import { describe, expect, it } from 'vitest';
import { partialStringField } from './partialJson';

describe('reading a tool input while it is written (R7 C1)', () => {
  it('gives the text of a field so far, decoded, and nothing before it starts', () => {
    expect(partialStringField('{"grade":{"feedback":"Close', 'markdown')).toBeNull();
    expect(partialStringField('{"card":{"stage":"explain","markdown":"## The idea\\n\\nNo one gains', 'markdown')).toBe('## The idea\n\nNo one gains');
    expect(partialStringField('{"card":{"markdown":"done.","x":1}}', 'markdown')).toBe('done.');
  });

  it('waits for an escape cut off at the end, and reads quotes, backslashes and unicode', () => {
    expect(partialStringField('{"markdown":"a \\', 'markdown')).toBe('a ');
    expect(partialStringField('{"markdown":"a \\u00', 'markdown')).toBe('a ');
    expect(partialStringField('{"markdown":"say \\"hi\\" and $\\\\alpha$ \\u00e9', 'markdown')).toBe('say "hi" and $\\alpha$ é');
  });

  it('takes the last field of that name, so a quoted key earlier in the text does not fool it', () => {
    expect(partialStringField('{"grade":{"feedback":"the \\"markdown\\": field"},"card":{"markdown":"Real', 'markdown')).toBe('Real');
  });
});
