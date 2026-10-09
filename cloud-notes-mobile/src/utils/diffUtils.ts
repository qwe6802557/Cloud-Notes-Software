import * as Diff from 'diff';

export interface DiffStats {
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  isIdentical: boolean;
}

export interface DiffToken {
  text: string;
  type: 'normal' | 'add' | 'del';
}

export interface UnifiedDiffRow {
  type: 'add' | 'del' | 'normal';
  oldLineNum: number | null;
  newLineNum: number | null;
  text: string;
  tokens?: DiffToken[];
}

export interface SplitDiffSide {
  lineNum: number | null;
  type: 'normal' | 'add' | 'del' | 'empty';
  text: string;
  tokens?: DiffToken[];
}

export interface SplitDiffRow {
  left: SplitDiffSide;
  right: SplitDiffSide;
}

/**
 * 统计两段文本的行级增删改状态与数量
 */
export const computeDiffStats = (oldText = '', newText = ''): DiffStats => {
  if (oldText === newText) {
    return {
      addedCount: 0,
      removedCount: 0,
      unchangedCount: oldText ? oldText.split('\n').length : 0,
      isIdentical: true,
    };
  }

  const changes = Diff.diffLines(oldText, newText);
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  changes.forEach(part => {
    const lineCount = part.count || (part.value ? part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0) : 0);
    if (part.added) {
      addedCount += lineCount;
    } else if (part.removed) {
      removedCount += lineCount;
    } else {
      unchangedCount += lineCount;
    }
  });

  return {
    addedCount,
    removedCount,
    unchangedCount,
    isIdentical: addedCount === 0 && removedCount === 0,
  };
};

/**
 * 计算行内字符或词级微差异标记
 */
export const computeWordTokens = (
  leftText = '',
  rightText = ''
): { leftTokens: DiffToken[]; rightTokens: DiffToken[] } => {
  if (!leftText && !rightText) {
    return { leftTokens: [], rightTokens: [] };
  }

  const wordChanges = Diff.diffWordsWithSpace(leftText, rightText);
  const leftTokens: DiffToken[] = [];
  const rightTokens: DiffToken[] = [];

  wordChanges.forEach(item => {
    if (item.removed) {
      leftTokens.push({ text: item.value, type: 'del' });
    } else if (item.added) {
      rightTokens.push({ text: item.value, type: 'add' });
    } else {
      leftTokens.push({ text: item.value, type: 'normal' });
      rightTokens.push({ text: item.value, type: 'normal' });
    }
  });

  return { leftTokens, rightTokens };
};

/**
 * 计算移动端优先的单列行内合并 (Unified Diff) 数据流
 */
export const computeUnifiedDiff = (oldText = '', newText = ''): UnifiedDiffRow[] => {
  const changes = Diff.diffLines(oldText, newText);
  const rows: UnifiedDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  let i = 0;
  while (i < changes.length) {
    const current = changes[i];

    if (!current.added && !current.removed) {
      const rawLines = current.value.split('\n');
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
        rawLines.pop();
      }

      rawLines.forEach(line => {
        rows.push({
          type: 'normal',
          oldLineNum: oldLine++,
          newLineNum: newLine++,
          text: line,
        });
      });
      i++;
    } else {
      const removedLines: string[] = [];
      const addedLines: string[] = [];

      while (i < changes.length && (changes[i].removed || changes[i].added)) {
        const chunk = changes[i];
        const chunkLines = chunk.value.split('\n');
        if (chunkLines.length > 0 && chunkLines[chunkLines.length - 1] === '') {
          chunkLines.pop();
        }

        if (chunk.removed) {
          removedLines.push(...chunkLines);
        } else if (chunk.added) {
          addedLines.push(...chunkLines);
        }
        i++;
      }

      // 若成对修改，则生成带词级差异高亮的对比行
      const pairCount = Math.min(removedLines.length, addedLines.length);

      removedLines.forEach((line, idx) => {
        const row: UnifiedDiffRow = {
          type: 'del',
          oldLineNum: oldLine++,
          newLineNum: null,
          text: line,
        };
        if (idx < pairCount) {
          const { leftTokens } = computeWordTokens(line, addedLines[idx]);
          row.tokens = leftTokens;
        }
        rows.push(row);
      });

      addedLines.forEach((line, idx) => {
        const row: UnifiedDiffRow = {
          type: 'add',
          oldLineNum: null,
          newLineNum: newLine++,
          text: line,
        };
        if (idx < pairCount) {
          const { rightTokens } = computeWordTokens(removedLines[idx], line);
          row.tokens = rightTokens;
        }
        rows.push(row);
      });
    }
  }

  return rows;
};

/**
 * 计算双栏并排 (Split Diff) 数据模型
 */
export const computeSplitDiff = (oldText = '', newText = ''): SplitDiffRow[] => {
  const changes = Diff.diffLines(oldText, newText);
  const splitRows: SplitDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  let i = 0;
  while (i < changes.length) {
    const current = changes[i];

    if (!current.added && !current.removed) {
      const lines = current.value.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        splitRows.push({
          left: { lineNum: oldLine++, type: 'normal', text: line },
          right: { lineNum: newLine++, type: 'normal', text: line },
        });
      }
      i++;
    } else {
      const removedLines: string[] = [];
      const addedLines: string[] = [];

      while (i < changes.length && (changes[i].removed || changes[i].added)) {
        const chunk = changes[i];
        const chunkLines = chunk.value.split('\n');
        if (chunkLines.length > 0 && chunkLines[chunkLines.length - 1] === '') {
          chunkLines.pop();
        }

        if (chunk.removed) {
          removedLines.push(...chunkLines);
        } else if (chunk.added) {
          addedLines.push(...chunkLines);
        }
        i++;
      }

      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let idx = 0; idx < maxLen; idx++) {
        const hasLeft = idx < removedLines.length;
        const hasRight = idx < addedLines.length;

        let leftObj: SplitDiffSide = { lineNum: null, type: 'empty', text: '' };
        let rightObj: SplitDiffSide = { lineNum: null, type: 'empty', text: '' };

        if (hasLeft) {
          leftObj = { lineNum: oldLine++, type: 'del', text: removedLines[idx] };
        }
        if (hasRight) {
          rightObj = { lineNum: newLine++, type: 'add', text: addedLines[idx] };
        }

        if (hasLeft && hasRight) {
          const { leftTokens, rightTokens } = computeWordTokens(leftObj.text, rightObj.text);
          leftObj.tokens = leftTokens;
          rightObj.tokens = rightTokens;
        }

        splitRows.push({ left: leftObj, right: rightObj });
      }
    }
  }

  return splitRows;
};
