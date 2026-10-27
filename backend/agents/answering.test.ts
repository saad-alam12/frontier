import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import { assessProbeAnswers } from './prober';
import { runTutorStep } from './tutor';
import type { TutorStepInput } from './tutor';

const DICTATED = 'i think you multiply the three jacobeans h times g times f so it ends up n3 by n0 no wait the order is h then g then f';

function stepInput(answer: string): TutorStepInput {
  return {
    goalText: 'Pass Deep Learning in Physics',
    why: 'the reverse pass is built on it',
    node: { id: 'node_jac', kind: 'claim', name: 'Jacobian of a composition', statement: 'The Jacobian of $h \\circ g \\circ f$ is $J_h J_g J_f$.' },
    premises: [],
    dependents: [],
    bugs: [],
    excerpts: [],
    history: [],
    previous: { stage: 'predict', card: { stage: 'predict', prompt: 'How would you get all $\\partial c_i / \\partial x_j$?' }, response: { answer, confidence: 0.66 } },
    nextStage: 'explain',
  };
}

describe('one answer field, read as dictated', () => {
  it('sends a dictated answer verbatim to the grader with the dictation instructions', async () => {
    const provider = new FakeProvider({
      tutor: [{ grade: { score: 0.8, feedback: 'Right product, right shape.', misconception: null, confidentlyWrong: false }, card: { stage: 'explain', markdown: 'Multiply the Jacobians.' } }],
    });
    const result = await runTutorStep(provider, stepInput(DICTATED));
    expect(result.grade?.score).toBe(0.8);
    const call = provider.calls[0];
    expect(call?.system).toMatch(/often dictated/i);
    expect(call?.system).toContain('"Jack\'s" for JAX');
    expect(call?.system).toMatch(/never penalize notation/i);
    expect(call?.messages[0]?.content).toContain(DICTATED);
    expect(call?.messages[0]?.content).toContain('confidence: fairly sure');
  });

  it('grades an empty answer as no idea without an error', async () => {
    const provider = new FakeProvider({
      prober: [{ assessments: [{ nodeId: 'node_jac', score: 0, reasoning: 'No answer given; it needed the product of the Jacobians.', misconception: null }] }],
    });
    const [assessment] = await assessProbeAnswers(provider, [
      { nodeId: 'node_jac', question: 'What is the Jacobian of a composition?', answerKey: 'The product, outermost first.', rubric: ['product', 'order'], answer: '', confidence: null },
    ]);
    expect(assessment?.score).toBe(0);
    const call = provider.calls[0];
    expect(call?.messages[0]?.content).toContain('(empty: the learner has no idea)');
    expect(call?.system).toMatch(/empty field means "I don't know"/);
  });
});
