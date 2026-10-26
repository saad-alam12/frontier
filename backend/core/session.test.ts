import { describe, expect, it } from 'vitest';
import { applyGrade, emptyEdge, evidenceKindFor, nextStage, stagesFor } from './session';

describe('session mechanics', () => {
  it('lists the step loop by mode', () => {
    expect(stagesFor('teach')).toEqual(['predict', 'explain', 'check', 'connect', 'compress', 'use']);
    expect(stagesFor('derive')).toEqual(['predict', 'explain', 'check', 'derive', 'connect', 'compress', 'use']);
    expect(stagesFor('index')).toEqual(['index']);
  });

  it('maps stages to evidence kinds', () => {
    expect(evidenceKindFor('predict')).toBe('predict');
    expect(evidenceKindFor('compress')).toBe('explain');
    expect(evidenceKindFor('index')).toBe('predict');
    expect(evidenceKindFor('connect')).toBeNull();
    expect(evidenceKindFor('explain')).toBeNull();
  });

  it('three failures in a row trigger support and reset', () => {
    let edge = emptyEdge();
    let action;
    ({ edge, action } = applyGrade(edge, 0.2));
    expect(action).toBe('none');
    ({ edge, action } = applyGrade(edge, 0.4));
    expect(action).toBe('none');
    ({ edge, action } = applyGrade(edge, 0.1));
    expect(action).toBe('support');
    expect(edge.consecutiveFailures).toBe(0);
  });

  it('a middling score resets both counters', () => {
    const { edge } = applyGrade({ consecutiveFailures: 2, easyStreak: 0 }, 0.6);
    expect(edge).toEqual({ consecutiveFailures: 0, easyStreak: 0 });
  });

  it('two easy successes skip ahead to compress', () => {
    let { edge, action } = applyGrade(emptyEdge(), 0.95);
    expect(action).toBe('none');
    ({ edge, action } = applyGrade(edge, 1));
    expect(action).toBe('skipAhead');
    const stages = stagesFor('teach');
    expect(nextStage(stages, 'check', action)).toBe('compress');
    expect(nextStage(stages, 'compress', action)).toBe('use');
    expect(nextStage(stages, 'use', 'none')).toBeNull();
    expect(nextStage(stages, 'predict', 'none')).toBe('explain');
  });
});
