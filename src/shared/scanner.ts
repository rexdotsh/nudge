export type SpanKind = 'when' | 'repeat' | 'flag';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
}

const CONSUMED = '\u0001';
const SHIELDED = '\u0002';
const CONNECTOR_BEFORE_CONSUMED = new RegExp(`\\s+(?:by|due|starting|from|until|every|each)\\s*(?=${CONSUMED})`, 'giu');

const wholeWord = (pattern: string) => `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`;

/** Finds phrases in the text one pattern at a time, masking each match so later patterns cannot reuse its words. */
export class Scanner {
  readonly spans: Span[] = [];
  private text: string;

  constructor(private readonly original: string) {
    this.text = Array.from(original, (char) => {
      const lower = char.toLowerCase();
      return lower.length === char.length ? lower : char;
    }).join('');
  }

  take(
    pattern: string,
    kind: SpanKind,
    handle: (match: RegExpExecArray) => boolean | void,
    { wholeWords = true } = {},
  ): boolean {
    const match = this.find(wholeWords ? wholeWord(pattern) : pattern);
    if (!match || handle(match) === false) return false;
    this.spans.push({ start: match.index, end: match.index + match[0].length, kind });
    this.mask(match, CONSUMED);
    return true;
  }

  /** Hides a phrase that was recognised but not taken, so no later pattern reads part of it. */
  shield(pattern: string): void {
    const match = this.find(wholeWord(pattern));
    if (match) this.mask(match, SHIELDED);
  }

  /** The original text without what was taken, or the connector words that only introduced it ("by friday"). */
  rest(): string {
    let rest = '';
    for (let i = 0; i < this.original.length; i++) rest += this.text[i] === CONSUMED ? CONSUMED : this.original[i];
    return rest.replace(CONNECTOR_BEFORE_CONSUMED, ' ').replaceAll(CONSUMED, ' ');
  }

  private find(pattern: string): RegExpExecArray | null {
    return new RegExp(pattern, 'u').exec(this.text);
  }

  private mask(match: RegExpExecArray, char: string): void {
    const end = match.index + match[0].length;
    this.text = this.text.slice(0, match.index) + char.repeat(match[0].length) + this.text.slice(end);
  }
}
