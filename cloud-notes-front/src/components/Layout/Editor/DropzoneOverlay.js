import React from 'react';
import { CloudUploadOutlined } from '@ant-design/icons';
import './DropzoneOverlay.less';

/**
 * 编辑区外部文件拖拽毛玻璃引导遮罩 (Stitch 规范)
 */
const DropzoneOverlay = ({
    visible = false,
    title = '释放以智能插入内容或上传附件',
    subtitle = '支持图片直接插入 · Markdown/Txt 文本直入 · PDF/文档等上传为附件'
}) => {
    if (!visible) return null;

    return (
        <div className="editor-dropzone-overlay">
            <div className="dropzone-box">
                <div className="dropzone-icon-wrap">
                    <CloudUploadOutlined className="dropzone-icon" />
                </div>
                <div className="dropzone-title">{title}</div>
                <div className="dropzone-subtitle">{subtitle}</div>
            </div>
        </div>
    );
};

export default DropzoneOverlay;
