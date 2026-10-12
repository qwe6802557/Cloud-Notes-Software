import './printPdfExport.less';

const formatPrintDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
};

/**
 * 分页 PDF 矢量导出执行器
 * 基于 CSS Paged Media 规范创建专属打印容器，保障公式、代码块、图表不跨页截断
 */
export const executePrintPdfExport = async ({
    title,
    notebookName,
    contentHtml
}) => {
    if (!contentHtml) {
        throw new Error('当前文档内容为空，无法导出 PDF');
    }

    const docTitle = (title || '无标题文档').trim();
    const notebook = (notebookName || '默认笔记本').trim();
    const printTime = formatPrintDate();

    // 移除旧的打印容器
    const oldContainer = document.getElementById('cloud-note-print-isolated-container');
    if (oldContainer) {
        oldContainer.remove();
    }

    const container = document.createElement('div');
    container.id = 'cloud-note-print-isolated-container';
    container.className = 'cloud-note-print-isolated-container';

    container.innerHTML = `
        <div class="print-doc-header">
            <h1 class="print-doc-title">${docTitle}</h1>
            <div class="print-doc-meta">
                <span class="print-meta-badge">${notebook}</span>
                <span class="print-meta-time">导出时间：${printTime}</span>
            </div>
            <div class="print-doc-divider"></div>
        </div>
        <div class="print-doc-body markdown-body">
            ${contentHtml}
        </div>
        <div class="print-doc-footer">
            <span class="print-footer-brand">云笔记 • 知识归档交付</span>
        </div>
    `;

    document.body.appendChild(container);

    const imgs = container.querySelectorAll('img');
    imgs.forEach(img => {
        if (img.dataset.src) {
            img.src = img.dataset.src;
        }
        img.style.opacity = '1';
        img.style.visibility = 'visible';
    });

    const originalDocTitle = document.title;
    document.title = `${docTitle}`;

    return new Promise(resolve => {
        const cleanup = () => {
            document.title = originalDocTitle;
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
            window.removeEventListener('afterprint', cleanup);
            resolve();
        };

        window.addEventListener('afterprint', cleanup);

        setTimeout(() => {
            window.print();
            // 在不支持 afterprint 事件的特定环境下延时自愈清理
            setTimeout(cleanup, 2000);
        }, 120);
    });
};
