import { describe, expect, it } from 'vitest';
import { labelPositions } from './chartLabels';

describe('end labels of a line chart', () => {
  it('leaves labels that are far apart where their lines end', () => {
    expect(labelPositions([20, 80, 150], 10, 160)).toEqual([20, 80, 150]);
  });

  it('pushes apart labels of lines that end together, in the order given', () => {
    expect(labelPositions([40, 40, 150], 10, 160)).toEqual([40, 55, 150]);
    expect(labelPositions([42, 40], 10, 160)).toEqual([55, 40]);
  });

  it('moves a stack up as a whole when it would run past the bottom', () => {
    // three lines ending at zero: the labels stack upward from the axis, none below it
    expect(labelPositions([158, 158, 158], 16, 158)).toEqual([128, 143, 158]);
    expect(labelPositions([30, 150, 158], 16, 158)).toEqual([30, 143, 158]);
  });

  it('keeps a label inside the plot when its line ends above or below it', () => {
    expect(labelPositions([-5, 400], 16, 158)).toEqual([16, 158]);
  });
});
