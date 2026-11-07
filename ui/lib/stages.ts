import type { PublicCard, Stage } from '../../backend/api/contract';

/** The depth ladder (design §2.3), by level. */
export const DEPTH_NAME = ['Not yet', 'Recognize', 'Explain', 'Derive', 'Apply', 'Transfer'] as const;

export function depthName(depth: number): string {
  return DEPTH_NAME[Math.max(0, Math.min(5, depth))] ?? 'Not yet';
}

/** What a session does with an idea, by its aim. */
const AIM_LABEL = ['', 'Overview', 'Explain', 'Explain and derive', 'Explain, derive and apply'] as const;

export function aimLabel(aim: number): string {
  return AIM_LABEL[Math.max(1, Math.min(4, aim))] ?? 'Explain';
}

export const STAGE_LABEL: Record<Stage, string> = {
  predict: 'Predict',
  explain: 'Explain',
  check: 'Check',
  derive: 'Derive',
  connect: 'Connect',
  compress: 'Own words',
  use: 'Use',
  index: 'Index pass',
  support: 'Worked example',
  reteach: 'Another way in',
};

/** The text a card shows the learner (its question, task or explanation). */
export function cardText(card: PublicCard): string {
  switch (card.stage) {
    case 'predict':
    case 'connect':
    case 'compress':
    case 'derive':
      return card.prompt;
    case 'check':
      return card.question;
    case 'use':
      return card.task;
    case 'explain':
    case 'support':
    case 'reteach':
      return card.markdown;
    case 'index':
      return `${card.gist}\n\n${card.placement}\n\n${card.question}`;
  }
}
