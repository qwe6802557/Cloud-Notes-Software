import * as Diff from 'diff';

/**
 * 统计差异行数
 */
export const computeDiffStats = (oldText = '', newText = '') => {
    if (oldText === newText) {
        return { addedCount: 0, removedCount: 0, unchangedCount: oldText ? oldText.split('\n').length : 0, isIdentical: true };
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
        isIdentical: addedCount === 0 && removedCount === 0
    };
};

/**
 * 计算行内字符/词级差异标记
 */
const computeWordTokens = (leftText = '', rightText = '') => {
    if (!leftText && !rightText) return { leftTokens: [], rightTokens: [] };
    const wordChanges = Diff.diffWordsWithSpace(leftText, rightText);
    const leftTokens = [];
    const rightTokens = [];

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
 * 计算单列合并视图 (Unified Diff) 数据模型
 */
export const computeUnifiedDiff = (oldText = '', newText = '') => {
    const changes = Diff.diffLines(oldText, newText);
    const rows = [];
    let oldLine = 1;
    let newLine = 1;

    changes.forEach(part => {
        const rawLines = part.value.split('\n');
        if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
            rawLines.pop();
        }

        rawLines.forEach(line => {
            if (part.added) {
                rows.push({
                    type: 'add',
                    oldLineNum: null,
                    newLineNum: newLine++,
                    text: line
                });
            } else if (part.removed) {
                rows.push({
                    type: 'del',
                    oldLineNum: oldLine++,
                    newLineNum: null,
                    text: line
                });
            } else {
                rows.push({
                    type: 'normal',
                    oldLineNum: oldLine++,
                    newLineNum: newLine++,
                    text: line
                });
            }
        });
    });

    return rows;
};

/**
 * 计算双栏并排视图 (Split Diff) 数据模型
 */
export const computeSplitDiff = (oldText = '', newText = '') => {
    const changes = Diff.diffLines(oldText, newText);
    const splitRows = [];
    let oldLine = 1;
    let newLine = 1;

    let i = 0;
    while (i < changes.length) {
        const current = changes[i];

        if (!current.added && !current.removed) {
            // 未变更块
            const lines = current.value.split('\n');
            if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];
                splitRows.push({
                    left: { lineNum: oldLine++, type: 'normal', text: line },
                    right: { lineNum: newLine++, type: 'normal', text: line }
                });
            }
            i++;
        } else {
            // 变更块 (可能存在连续的 removed 与 added)
            const removedLines = [];
            const addedLines = [];

            while (i < changes.length && (changes[i].removed || changes[i].added)) {
                const chunk = changes[i];
                const chunkLines = chunk.value.split('\n');
                if (chunkLines.length > 0 && chunkLines[chunkLines.length - 1] === '') chunkLines.pop();

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

                let leftObj = { lineNum: null, type: 'empty', text: '' };
                let rightObj = { lineNum: null, type: 'empty', text: '' };

                if (hasLeft) {
                    leftObj = { lineNum: oldLine++, type: 'del', text: removedLines[idx] };
                }
                if (hasRight) {
                    rightObj = { lineNum: newLine++, type: 'add', text: addedLines[idx] };
                }

                // 若左右同时存在变动，计算词级微差异高亮
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
