/** A block of source text with where it came from (page, heading path, section). */
export interface TextBlock {
  text: string;
  locator: string;
}

export interface ReadResult {
  title: string;
  blocks: TextBlock[];
}

/** A token-budgeted chunk. `locator` spans the blocks it covers, e.g. "p3–p5" or "2 Best responses". */
export interface Chunk {
  text: string;
  locator: string;
}
