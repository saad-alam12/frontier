import type { PublicCard, Stage } from '../../backend/api/contract';

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
