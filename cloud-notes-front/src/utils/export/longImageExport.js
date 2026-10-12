import html2canvas from 'html2canvas';
import './longImageExport.less';

const formatExportDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
};

/**
 * 确保离屏容器内的图片与字体等关键资产完全就绪
 */
const prepareContainerAssets = async container => {
    if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
    }

    const images = Array.from(container.querySelectorAll('img'));
    if (images.length === 0) return;

    images.forEach(img => {
        if (img.dataset.src) {
            img.src = img.dataset.src;
        }
        img.style.opacity = '1';
        img.style.filter = 'none';
        img.style.visibility = 'visible';
    });

    const imagePromises = images.map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(resolve, 4000);
        });
    });

    await Promise.all(imagePromises);
};

/**
 * 高清长图 (2x Retina PNG) 导出执行器
 */
export const executeLongImageExport = async ({
    title,
    notebookName,
    contentHtml
}) => {
    if (!contentHtml) {
        throw new Error('当前文档内容为空，无法生成长图');
    }

    const docTitle = (title || '无标题文档').trim();
    const notebook = (notebookName || '默认笔记本').trim();
    const exportTime = formatExportDate();

    const wrapper = document.createElement('div');
    wrapper.className = 'cloud-note-long-image-export-wrapper';

    const card = document.createElement('div');
    card.className = 'cloud-note-long-image-card';
    card.innerHTML = `
        <div class="long-image-card-header">
            <h1 class="long-image-title">${docTitle}</h1>
            <div class="long-image-meta">
                <span class="long-image-notebook">${notebook}</span>
                <span class="long-image-time">${exportTime}</span>
            </div>
            <div class="long-image-divider"></div>
        </div>
        <div class="long-image-body markdown-body">
            ${contentHtml}
        </div>
        <div class="long-image-footer">
            <div class="long-image-brand">
                <span class="brand-logo">云笔记</span>
                <span class="brand-tagline">高清知识便签 • 归档分享</span>
            </div>
        </div>
    `;

    wrapper.appendChild(card);
    document.body.appendChild(wrapper);

    try {
        await prepareContainerAssets(card);
        await new Promise(resolve => setTimeout(resolve, 150));

        const canvas = await html2canvas(card, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#f1f5f9'
        });

        const safeFilename = `${docTitle.replace(/[\\/:*?"<>|]/g, '_') || '笔记'}.png`;

        await new Promise((resolve, reject) => {
            if (canvas.toBlob) {
                canvas.toBlob(blob => {
                    if (!blob) {
                        reject(new Error('长图图像生成失败'));
                        return;
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = safeFilename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                    resolve();
                }, 'image/png');
            } else {
                const dataUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = safeFilename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                resolve();
            }
        });
    } finally {
        if (wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
    }
};
