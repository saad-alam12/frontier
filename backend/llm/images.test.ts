import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toMessageParam } from './AnthropicApiProvider';
import { withImages } from './AgentSdkProvider';
import { FakeProvider } from './FakeProvider';
import { runRecall } from '../agents/tutor';
import type { LlmImage } from './provider';

const image: LlmImage = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
const block = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };

describe('images in model calls', () => {
  it('the API provider sends text first, then base64 image blocks; plain messages stay strings', () => {
    expect(toMessageParam({ role: 'user', content: 'look', images: [image] })).toEqual({ role: 'user', content: [{ type: 'text', text: 'look' }, block] });
    expect(toMessageParam({ role: 'user', content: 'plain' })).toEqual({ role: 'user', content: 'plain' });
  });

  it('the Agent SDK provider streams one user message whose content carries the image blocks', async () => {
    const messages = [];
    for await (const m of withImages('look', [image])) messages.push(m);
    expect(messages).toEqual([{ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: 'look' }, block] } }]);
  });

  it('the fake provider records the images a call carried', async () => {
    const fake = new FakeProvider({ connectionTest: [{ ok: true }] });
    await fake.complete({ role: 'connectionTest', system: 's', messages: [{ role: 'user', content: 'q', images: [image] }], submit: { name: 'submit', description: 'd', schema: z.object({ ok: z.boolean() }) } });
    expect(fake.calls[0]?.images).toEqual([image]);
  });

  it('a recall with images and a quote passes both to the tutor', async () => {
    const fake = new FakeProvider({ tutor: [{ recalled: [{ nodeId: 'n1', score: 0.5, note: '' }] }] });
    await runRecall(fake, { goalText: 'g', nodes: [{ id: 'n1', name: 'Idea', statement: 's' }], text: '', closing: false, quote: 'that formula', images: [image] });
    const call = fake.calls[0];
    expect(call?.images).toEqual([image]);
    expect(call?.messages[0]?.content).toContain('## The learner is replying to this part\n"that formula"');
    expect(call?.messages[0]?.content).toContain('the recall is in the attached images');
  });
});
