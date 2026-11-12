/**
 * Python split into coloured runs for the code field: keywords, built-in names, strings, comments,
 * numbers, decorators, and the name after def or class. Small on purpose: it colours, it does not parse,
 * so a half-typed line never breaks it. Pure.
 */

export type TokenKind = 'keyword' | 'builtin' | 'string' | 'comment' | 'number' | 'decorator' | 'definition' | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'.split(' '),
);
const BUILTINS = new Set(
  'abs all any bool dict enumerate filter float format int isinstance len list map max min next open print range repr reversed round set sorted str sum tuple type zip self super object Exception ValueError TypeError KeyError IndexError'.split(' '),
);

/** The patterns, in the order they are tried at each position. */
const RULES: [TokenKind, RegExp][] = [
  ['comment', /#[^\n]*/y],
  // triple-quoted first, so """ is not read as an empty string and a quote; an unclosed one runs to the end
  ['string', /[rRbBuUfF]{0,2}("""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S])))/y],
  ['string', /[rRbBuUfF]{0,2}("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y],
  ['decorator', /@[A-Za-z_][\w.]*/y],
  ['number', /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?j?)\b/y],
  ['plain', /[A-Za-z_][\w]*/y],
  ['plain', /\s+/y],
  ['plain', /./y],
];

export function highlightPython(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  let afterDef = false;
  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else tokens.push({ kind, text });
  };
  while (at < source.length) {
    for (const [kind, rule] of RULES) {
      rule.lastIndex = at;
      const match = rule.exec(source);
      if (!match || match[0].length === 0) continue;
      const text = match[0];
      at += text.length;
      if (kind === 'plain' && /^[A-Za-z_]/.test(text)) {
        const word: TokenKind = afterDef ? 'definition' : KEYWORDS.has(text) ? 'keyword' : BUILTINS.has(text) ? 'builtin' : 'plain';
        afterDef = text === 'def' || text === 'class';
        push(word, text);
      } else {
        if (!/^\s+$/.test(text)) afterDef = false;
        push(kind, text);
      }
      break;
    }
  }
  return tokens;
}
