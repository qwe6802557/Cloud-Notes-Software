import React, { useMemo } from 'react';
import { CheckCircleOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { computeDiffStats, computeUnifiedDiff, computeSplitDiff } from './diffUtils';
import './DiffViewer.less';

/**
 * 代码行内容渲染(含词级差异高亮)
 */
const renderLineTokens = (text, tokens, fallbackClass) => {
    if (tokens && tokens.length > 0) {
        return tokens.map((tok, idx) => {
            if (tok.type === 'del') {
                return <span key={idx} className="diff-token-del">{tok.text}</span>;
            }
            if (tok.type === 'add') {
                return <span key={idx} className="diff-token-add">{tok.text}</span>;
            }
            return <span key={idx}>{tok.text}</span>;
        });
    }
    return <span className={fallbackClass || ''}>{text || ' '}</span>;
};

/**
 * 高精度可视化 Diff 差异对比器
 */
const DiffViewer = ({
    oldValue = '',
    newValue = '',
    oldTitle = '对比基准',
    newTitle = '历史快照',
    layout = 'split'
}) => {
    const stats = useMemo(() => computeDiffStats(oldValue, newValue), [oldValue, newValue]);
    const unifiedRows = useMemo(() => layout === 'unified' ? computeUnifiedDiff(oldValue, newValue) : [], [oldValue, newValue, layout]);
    const splitRows = useMemo(() => layout === 'split' ? computeSplitDiff(oldValue, newValue) : [], [oldValue, newValue, layout]);

    return (
        <div className="cloud-notes-diff-viewer">
            <div className="diff-header-bar">
                <div className="diff-header-titles">
                    <span className="diff-side-title">
                        <span className="diff-indicator-dot base-dot" />
                        <span>{oldTitle}</span>
                    </span>
                    <ArrowRightOutlined className="diff-title-arrow" />
                    <span className="diff-side-title">
                        <span className="diff-indicator-dot target-dot" />
                        <span>{newTitle}</span>
                    </span>
                </div>

                <div className="diff-stats-badges">
                    {stats.isIdentical ? (
                        <span className="diff-stat-item stat-identical">内容完全一致</span>
                    ) : (
                        <>
                            {stats.addedCount > 0 && (
                                <span className="diff-stat-item stat-added">+{stats.addedCount} 行</span>
                            )}
                            {stats.removedCount > 0 && (
                                <span className="diff-stat-item stat-removed">-{stats.removedCount} 行</span>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className="diff-body-container">
                {stats.isIdentical ? (
                    <div className="diff-identical-notice">
                        <CheckCircleOutlined className="identical-icon" />
                        <span className="identical-text">当前所选历史版本与对比基准内容完全一致</span>
                    </div>
                ) : layout === 'unified' ? (
                    <table className="diff-unified-table">
                        <tbody>
                            {unifiedRows.map((row, idx) => {
                                const sign = row.type === 'add' ? '+' : (row.type === 'del' ? '-' : ' ');
                                return (
                                    <tr key={idx} className={`row-${row.type}`}>
                                        <td className="gutter-num">{row.oldLineNum || ''}</td>
                                        <td className="gutter-num">{row.newLineNum || ''}</td>
                                        <td className="gutter-sign">{sign}</td>
                                        <td className="diff-code-cell">{row.text || ' '}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div className="diff-split-container">
                        <div className="split-pane pane-left">
                            <table className="split-table">
                                <tbody>
                                    {splitRows.map((row, idx) => (
                                        <tr key={idx} className={`cell-${row.left.type}`}>
                                            <td className="gutter-num">{row.left.lineNum || ''}</td>
                                            <td className="diff-code-cell">
                                                {renderLineTokens(row.left.text, row.left.tokens, row.left.type === 'del' ? 'diff-token-del' : '')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="split-pane pane-right">
                            <table className="split-table">
                                <tbody>
                                    {splitRows.map((row, idx) => (
                                        <tr key={idx} className={`cell-${row.right.type}`}>
                                            <td className="gutter-num">{row.right.lineNum || ''}</td>
                                            <td className="diff-code-cell">
                                                {renderLineTokens(row.right.text, row.right.tokens, row.right.type === 'add' ? 'diff-token-add' : '')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DiffViewer;
