/**
 * 移动端反向链接物理回织工具类 (Bidirectional Weaving Utils)
 * 格式与 PC 端保持 100% 规范一致
 */

/**
 * 检查指定笔记标题是否已作为 [[双链]] 存在于当前文本中
 */
export function isItemWeaved(content: string = '', title: string = ''): boolean {
  if (!content || !title) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;

  // 严格匹配 [[标题]] 或 [[标题|别名]]
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]*)?\\]\\]`);
  return regex.test(content);
}

/**
 * 物理回织反向链接条目到当前文档正文末尾专区
 */
export function weaveBacklinksToText(
  currentDoc: string = '',
  items: Array<{ title: string; contextSnippet?: string; snippet?: string }> = []
): { newContent: string; addedCount: number } {
  if (!Array.isArray(items) || items.length === 0) {
    return { newContent: currentDoc, addedCount: 0 };
  }

  // 过滤已存在于正文中的条目
  const unweavedItems = items.filter(item => {
    if (!item?.title) return false;
    return !isItemWeaved(currentDoc, item.title);
  });

  if (unweavedItems.length === 0) {
    return { newContent: currentDoc, addedCount: 0 };
  }

  const linesToInsert = unweavedItems
    .map(item => {
      const rawSnippet = item.contextSnippet || item.snippet || '';
      const cleanSnippet = rawSnippet
        .replace(/==([^=]+)==/g, '$1')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const snippetText = cleanSnippet ? ` - ${cleanSnippet}` : '';
      return `- [[${item.title.trim()}]]${snippetText}`;
    })
    .join('\n');

  const sectionHeader = '### 🔗 反向回织';
  const sectionIndex = currentDoc.indexOf(sectionHeader);

  let nextContent = '';
  if (sectionIndex !== -1) {
    const afterSection = currentDoc.slice(sectionIndex + sectionHeader.length);
    const nextSectionMatch = afterSection.search(/\n(?=#{1,3}\s|---\s*$)/);
    if (nextSectionMatch !== -1) {
      const insertIndex = sectionIndex + sectionHeader.length + nextSectionMatch;
      nextContent = currentDoc.slice(0, insertIndex) + `\n${linesToInsert}` + currentDoc.slice(insertIndex);
    } else {
      const needsLeadingNewline = !currentDoc.endsWith('\n');
      nextContent = `${currentDoc}${needsLeadingNewline ? '\n' : ''}${linesToInsert}\n`;
    }
  } else {
    const padding = currentDoc.endsWith('\n\n') ? '' : currentDoc.endsWith('\n') ? '\n' : '\n\n';
    nextContent = `${currentDoc}${padding}---\n${sectionHeader}\n${linesToInsert}\n`;
  }

  return { newContent: nextContent, addedCount: unweavedItems.length };
}
