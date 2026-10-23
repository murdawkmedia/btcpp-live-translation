// Spelling repairs only: no model call, semantic paraphrase or inferred number.
// A bitfield position may legitimately have the same number as a BIP.
const boundary = '[\\p{L}\\p{N}_`./\\\\-]';
const endBoundary = '(?![\\p{L}\\p{N}_`/\\\\-]|\\.[a-z])';
const explicitBip = new RegExp(`(?<!${boundary})b\\s*i\\s*p[ -]?(\\d{1,4})${endBoundary}`, 'giu');
const bit54 = new RegExp(`(?<!${boundary})bit[ -]?(54)${endBoundary}`, 'giu');
const proposalContext = /\b(?:UTXOs?|Utreexo|consensus cleanup|soft[ -]fork|BIP[ -]30)\b/i;
const bitfieldContext = /\b(?:mask|bitmap|bitfield|bitwise|offset|position|register|shift|flag|integer|binary|hex|bytes?|bits?)\b/i;

export function normalizeTranscript(text) {
  const spelled = text.replace(explicitBip, (_, digits) => `BIP ${digits}`);
  return spelled.replace(bit54, (match, digits, offset) => {
    // Inspect only this local phrase; never borrow context from another session.
    const before = spelled.slice(Math.max(0, offset - 100), offset).split(/[.!?;\n]/).at(-1);
    const after = spelled.slice(offset + match.length, offset + match.length + 100).split(/[.!?;\n]/)[0];
    const local = `${before}${match}${after}`;
    const withoutCandidate = `${before} ${after}`.replace(bit54, '');
    return proposalContext.test(local) && !bitfieldContext.test(withoutCandidate) ? `BIP ${digits}` : match;
  });
}
