import { describe, expect, it } from 'vitest';
import { buildStepSchema } from './tutor';

describe('plots in tutor cards', () => {
  it('sends a card whose plot cannot be drawn back to the model, and accepts one that can', () => {
    const schema = buildStepSchema('explain', false);
    const card = (y: string) => ({ grade: null, card: { stage: 'explain', markdown: `Demand falls as the price rises.\n\n\`\`\`plot\n{"x":{"min":0,"max":10},"curves":[{"label":"demand","y":"${y}"}]}\n\`\`\`` } });
    expect(schema.safeParse(card('10 - 2*p')).error?.issues[0]?.message).toMatch(/^a plot block cannot be drawn: curves.0.y: cannot read "10 - 2\*p"/);
    expect(schema.safeParse(card('10 - 2*x')).success).toBe(true);
  });
});
