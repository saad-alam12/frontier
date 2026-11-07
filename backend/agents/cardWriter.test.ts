import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import { SubmitValidationError } from '../llm/provider';
import { buildIdeaCardsSchema, draftCard, writeIdeaCards } from './cardWriter';
import type { IdeaCardsInput } from './cardWriter';

const input: IdeaCardsInput = {
  goal: { text: 'Understand transformers', level: 'working' },
  idea: { name: 'Scaled dot-product attention', kind: 'claim', statement: 'Attention weights values by softmax of scaled query-key products.' },
  taught: ['$$\\mathrm{Attention}(Q,K,V) = \\mathrm{softmax}(QK^T/\\sqrt{d_k})V$$'],
  answers: [{ question: 'Why scale by the square root?', answer: 'to keep the softmax from saturating', score: 0.8 }],
  existing: [],
  max: 2,
};
const card = (front: string) => ({ front, back: 'An answer.' });

describe('card writer', () => {
  it('accepts zero cards as a normal answer, and at most the maximum', () => {
    const schema = buildIdeaCardsSchema(2);
    expect(schema.safeParse({ cards: [] }).success).toBe(true);
    expect(schema.safeParse({ cards: [card('State the attention formula'), card('What is d_k?')] }).success).toBe(true);
    expect(schema.safeParse({ cards: [card('One question'), card('Two questions'), card('Three questions')] }).success).toBe(false);
    // a card needs a question and an answer, and two cards may not ask the same thing
    expect(schema.safeParse({ cards: [{ front: 'State it', back: '' }] }).success).toBe(false);
    expect(schema.safeParse({ cards: [card('State the formula'), card('state the formula')] }).success).toBe(false);
  });

  it('sends invalid cards back to the model and keeps the valid retry', async () => {
    const provider = new FakeProvider({ cardWriter: [{ cards: [card('A'), card('B'), card('C')] }, { cards: [card('State the scaled dot-product attention formula and define its terms')] }] });
    const cards = await writeIdeaCards(provider, input);
    expect(cards).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    const text = provider.calls[0]?.messages[0]?.content ?? '';
    expect(text).toContain('Write between 0 and 2 cards');
    expect(text).toContain('softmax');
    expect(text).toContain('to keep the softmax from saturating');
  });

  it('gives up after three invalid answers', async () => {
    const provider = new FakeProvider({ cardWriter: [{ cards: 'none' }] });
    await expect(writeIdeaCards(provider, input)).rejects.toBeInstanceOf(SubmitValidationError);
  });

  it('makes no call when there is no room', async () => {
    const provider = new FakeProvider();
    expect(await writeIdeaCards(provider, { ...input, max: 0 })).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it('drafts from a selection with the message around it', async () => {
    const provider = new FakeProvider({ cardWriter: [{ front: 'State the attention formula and define its terms', back: '$$\\mathrm{softmax}(QK^T/\\sqrt{d_k})V$$' }] });
    const draft = await draftCard(provider, { goal: null, ideas: [{ name: 'Attention', statement: 's' }], selection: { text: 'softmax(QK^T/√d_k)V', message: 'The whole explanation.' }, existing: [] });
    expect(draft.front).toContain('State the attention formula');
    const text = provider.calls[0]?.messages[0]?.content ?? '';
    expect(text).toContain('one card from text the learner selected');
    expect(text).toContain('The whole explanation.');
  });
});
