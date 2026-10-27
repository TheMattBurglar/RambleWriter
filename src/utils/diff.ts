// Word-level dynamic programming diff engine for RambleWriter

export interface ProposedFix {
  id: string; // Unique ID for React checklist state
  type: 'replace' | 'insert' | 'delete';
  original: string; // The text to be removed/changed
  corrected: string; // The text to be inserted
  index: number; // Absolute start character index in the document
  length: number; // Character length of original text in the document
  context: string; // Full sentence text containing the change
  contextStart: number; // Absolute document index where context begins
}

/**
 * Splits text into words while keeping track of their character offsets
 */
export interface WordToken {
  text: string;
  start: number;
  end: number;
}

export function tokenizeWords(text: string, offset: number = 0): WordToken[] {
  const tokens: WordToken[] = [];
  const regex = /[a-zA-Z0-9']+|[^a-zA-Z0-9'\s]+/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: offset + match.index,
      end: offset + match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Computes word-level optimal alignment using Wagner-Fischer edit distance algorithm
 */
export function getSentenceDiffs(
  originalText: string,
  correctedText: string,
  sentenceStartOffset: number,
  sentenceContext: string
): Omit<ProposedFix, 'id'>[] {
  // Normalize double spaces, but keep tokens clean
  const originalTokens = tokenizeWords(originalText, sentenceStartOffset);
  const correctedTokens = tokenizeWords(correctedText, 0);

  const n = originalTokens.length;
  const m = correctedTokens.length;

  // dp[i][j] stores the edit distance
  const dp: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  // Fill DP table
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (originalTokens[i - 1].text.toLowerCase() === correctedTokens[j - 1].text.toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1]; // Match
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // Deletion
          dp[i][j - 1] + 1, // Insertion
          dp[i - 1][j - 1] + 1.2 // Substitution (slight penalty to favor separate insert/delete over mismatched replace)
        );
      }
    }
  }

  // Trace back optimal operations
  interface Op {
    type: 'match' | 'replace' | 'insert' | 'delete';
    origToken?: WordToken;
    corrToken?: WordToken;
  }
  
  const ops: Op[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalTokens[i - 1].text.toLowerCase() === correctedTokens[j - 1].text.toLowerCase()) {
      ops.push({ type: 'match', origToken: originalTokens[i - 1], corrToken: correctedTokens[j - 1] });
      i--;
      j--;
    } else {
      const delCost = i > 0 ? dp[i - 1][j] : Infinity;
      const insCost = j > 0 ? dp[i][j - 1] : Infinity;
      const substCost = (i > 0 && j > 0) ? dp[i - 1][j - 1] : Infinity;

      const minCost = Math.min(delCost, insCost, substCost);

      if (minCost === substCost) {
        ops.push({ type: 'replace', origToken: originalTokens[i - 1], corrToken: correctedTokens[j - 1] });
        i--;
        j--;
      } else if (minCost === delCost) {
        ops.push({ type: 'delete', origToken: originalTokens[i - 1] });
        i--;
      } else {
        ops.push({ type: 'insert', corrToken: correctedTokens[j - 1] });
        j--;
      }
    }
  }

  ops.reverse(); // Standard chronological order

  const diffs: Omit<ProposedFix, 'id'>[] = [];
  let idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];

    if (op.type === 'match') {
      idx++;
      continue;
    }

    // Group adjacent non-match operations to create cohesive phrase-level edits
    // e.g. replacing multiple words at once
    let origText = '';
    let corrText = '';
    let startChar = -1;
    let endChar = -1;
    let isReplace = false;
    let isInsert = false;
    let isDelete = false;

    let subIdx = idx;
    while (subIdx < ops.length && ops[subIdx].type !== 'match') {
      const currentOp = ops[subIdx];
      
      if (currentOp.origToken) {
        if (startChar === -1) startChar = currentOp.origToken.start;
        endChar = currentOp.origToken.end;
        origText += (origText ? ' ' : '') + currentOp.origToken.text;
      }
      
      if (currentOp.corrToken) {
        corrText += (corrText ? ' ' : '') + currentOp.corrToken.text;
      }

      if (currentOp.type === 'replace') isReplace = true;
      if (currentOp.type === 'insert') isInsert = true;
      if (currentOp.type === 'delete') isDelete = true;

      subIdx++;
    }

    // Determine finalized edit type
    let finalType: 'replace' | 'insert' | 'delete' = 'replace';
    if (isReplace || (isInsert && isDelete)) {
      finalType = 'replace';
    } else if (isInsert) {
      finalType = 'insert';
    } else if (isDelete) {
      finalType = 'delete';
    }

    // Clean punctuation spaces
    origText = cleanPunctuationSpacing(origText);
    corrText = cleanPunctuationSpacing(corrText);

    if (finalType === 'insert') {
      // A pure insertion has no original token of its own, so anchor it to a neighbor.
      // Trailing punctuation attaches to the end of the previous word
      // (asked "Are → asked, "Are, not asked ,"Are); everything else goes in front of
      // the next word, with a space so it doesn't fuse (seems → it seems, not itseems).
      const prevOrig = ops.slice(0, idx).reverse().find(o => o.origToken)?.origToken;
      const nextOrig = ops.slice(subIdx).find(o => o.origToken)?.origToken;
      if (/^[,.;:!?)\]]/.test(corrText) && prevOrig) {
        startChar = prevOrig.end;
      } else if (nextOrig) {
        startChar = nextOrig.start;
        if (/[a-zA-Z0-9'.,;:!?]$/.test(corrText)) corrText += ' ';
      } else {
        startChar = originalText.length + sentenceStartOffset;
        if (/^[a-zA-Z0-9]/.test(corrText)) corrText = ' ' + corrText;
      }
      endChar = startChar;
    }

    // Filter out trivial casing-only changes or empty spacing diffs
    if (origText.toLowerCase() !== corrText.toLowerCase() || origText !== corrText) {
      if (origText || corrText) {
        diffs.push({
          type: finalType,
          original: origText,
          corrected: corrText,
          index: startChar,
          length: endChar - startChar,
          context: sentenceContext,
          contextStart: sentenceStartOffset,
        });
      }
    }

    idx = subIdx;
  }

  return diffs;
}

/**
 * Standardizes spacing around punctuation (e.g. "word , word" -> "word, word")
 */
function cleanPunctuationSpacing(text: string): string {
  return text
    .replace(/\s+([,.!?;:'])/g, '$1')
    .replace(/('\s+s)/g, "'s")
    .trim();
}

/**
 * Splits a full document into paragraphs with character offsets.
 * Paragraphs are separated by one or more blank lines (\n\n).
 * This preserves dialogue context so the AI sees matched quote pairs.
 */
export interface SentenceToken {
  text: string;
  start: number;
  end: number;
}

export function splitParagraphs(documentText: string): SentenceToken[] {
  const paragraphs: SentenceToken[] = [];
  const separatorRegex = /\n{2,}/g;
  let lastIndex = 0;
  let match;

  while ((match = separatorRegex.exec(documentText)) !== null) {
    const chunk = documentText.slice(lastIndex, match.index);
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      const startOffset = chunk.indexOf(trimmed);
      paragraphs.push({
        text: trimmed,
        start: lastIndex + startOffset,
        end: lastIndex + startOffset + trimmed.length,
      });
    }
    lastIndex = match.index + match[0].length;
  }

  const remaining = documentText.slice(lastIndex);
  const trimmed = remaining.trim();
  if (trimmed.length > 0) {
    const startOffset = remaining.indexOf(trimmed);
    paragraphs.push({
      text: trimmed,
      start: lastIndex + startOffset,
      end: lastIndex + startOffset + trimmed.length,
    });
  }

  return paragraphs;
}
