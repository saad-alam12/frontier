/**
 * Which cards of a two-column grid span both columns, so that no row is half empty (R8 E6): a card
 * already wide spans, and so does a card that would sit alone in its row because it is the last one
 * or the next card is wide.
 */
export function spanningCards(wide: readonly boolean[]): boolean[] {
  let rowStarted = false;
  return wide.map((isWide, i) => {
    if (isWide) {
      rowStarted = false;
      return true;
    }
    if (!rowStarted && (i === wide.length - 1 || wide[i + 1] === true)) return true;
    rowStarted = !rowStarted;
    return false;
  });
}
