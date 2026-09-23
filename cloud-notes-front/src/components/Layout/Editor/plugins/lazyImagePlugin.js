/**
 * lazyImagePlugin.js - ByteMD 专用的多图片高性能懒加载与平滑渐现插件
 *
 * 核心特性：
 * 1. 视口感知预加载 (IntersectionObserver + 400px 缓冲)：滑到前提前 400px 静默拉取，无感秒开；
 * 2. 智能微光呼吸骨架屏 (Skeleton Shimmer + min-height 预留)：彻底消除 CLS 排版跳动；
 * 3. 0.3s 平滑渐入 (Fade-in)：加载完成平滑显现，消除生硬闪烁；
 * 4. 异常卡片与点击重试 (Error Fallback & Retry)：网络瞬断时不展示原生裂图，提供优雅重试；
 * 5. 全屏画廊完全兼容：保留 data-src 与真实 src 映射。
 */

const TRANSPARENT_PLACEHOLDER =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

export default function lazyImagePlugin() {
    return {
        viewerEffect({ markdownBody }) {
            if (!markdownBody) return undefined;

            // 寻找当前预览视口滚动容器（ByteMD preview 或 preview-only）
            const scrollContainer =
                markdownBody.closest('.bytemd-preview') ||
                markdownBody.closest('.preview-only') ||
                null;

            const observer = new IntersectionObserver(
                entries => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            const realSrc = img.dataset.src;

                            if (realSrc && img.src !== realSrc) {
                                img.src = realSrc;
                            }
                            observer.unobserve(img);
                        }
                    });
                },
                {
                    root: scrollContainer,
                    rootMargin: '400px 0px 400px 0px',
                    threshold: 0.01
                }
            );

            const imgs = markdownBody.querySelectorAll('img');

            imgs.forEach(img => {
                // 若已包装处理过，仅确保状态正常
                if (img.dataset.lazyHandled === 'true') {
                    return;
                }

                const originalSrc = img.getAttribute('src');
                if (!originalSrc || originalSrc.startsWith('data:image/svg+xml')) {
                    return;
                }

                img.dataset.lazyHandled = 'true';
                img.dataset.src = originalSrc;
                img.setAttribute('loading', 'lazy');
                img.setAttribute('decoding', 'async');

                // 创建包裹容器
                const container = document.createElement('span');
                container.className = 'note-image-container is-loading';

                // 创建微光呼吸骨架屏
                const skeleton = document.createElement('span');
                skeleton.className = 'note-image-skeleton';
                skeleton.innerHTML = `
                    <span class="skeleton-shimmer"></span>
                    <span class="skeleton-content">
                        <svg class="skeleton-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span class="skeleton-text">图片加载中...</span>
                    </span>
                `;

                // 创建加载失败异常卡片
                const errorCard = document.createElement('span');
                errorCard.className = 'note-image-error';
                errorCard.style.display = 'none';
                errorCard.innerHTML = `
                    <svg class="error-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <span class="error-msg">图片加载失败</span>
                    <button type="button" class="error-retry-btn">点击重试</button>
                `;

                // 点击重试逻辑
                const retryBtn = errorCard.querySelector('.error-retry-btn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        e.preventDefault();
                        container.classList.remove('is-error');
                        container.classList.add('is-loading');
                        errorCard.style.display = 'none';
                        skeleton.style.display = 'flex';

                        // 附加时间戳重新触发网络加载
                        const retrySrc = img.dataset.src;
                        const separator = retrySrc.includes('?') ? '&' : '?';
                        img.src = `${retrySrc}${separator}_retry=${Date.now()}`;
                    });
                }

                // 替换并挂载容器
                img.parentNode.insertBefore(container, img);
                container.appendChild(skeleton);
                container.appendChild(img);
                container.appendChild(errorCard);

                // 图片加载成功
                img.onload = () => {
                    // 过滤透明占位图触发的伪 onload
                    if (img.src === TRANSPARENT_PLACEHOLDER) {
                        return;
                    }
                    container.classList.remove('is-loading');
                    container.classList.remove('is-error');
                    container.classList.add('is-loaded');
                    skeleton.style.display = 'none';
                    errorCard.style.display = 'none';
                };

                // 图片加载失败
                img.onerror = () => {
                    if (img.src === TRANSPARENT_PLACEHOLDER) {
                        return;
                    }
                    container.classList.remove('is-loading');
                    container.classList.add('is-error');
                    skeleton.style.display = 'none';
                    errorCard.style.display = 'flex';
                };

                // 若图片早前已缓存在浏览器且加载完成
                if (img.complete && img.naturalWidth > 0) {
                    container.classList.remove('is-loading');
                    container.classList.add('is-loaded');
                    skeleton.style.display = 'none';
                } else {
                    // 设置轻量占位图并进入视口观察队列
                    img.src = TRANSPARENT_PLACEHOLDER;
                    observer.observe(img);
                }
            });

            return () => {
                observer.disconnect();
            };
        }
    };
}
