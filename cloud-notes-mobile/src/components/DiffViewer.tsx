import React, { useMemo } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  computeDiffStats,
  computeSplitDiff,
  computeUnifiedDiff,
  DiffToken,
  SplitDiffRow,
  UnifiedDiffRow,
} from '../utils/diffUtils';

export interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  oldTitle?: string;
  newTitle?: string;
  layout?: 'unified' | 'split';
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/**
 * 差异行词级高亮渲染组件
 */
const TokenizedLineText = ({
  text,
  tokens,
  defaultColor = '#0f172a',
}: {
  text: string;
  tokens?: DiffToken[];
  defaultColor?: string;
}) => {
  if (tokens && tokens.length > 0) {
    return (
      <Text style={[styles.codeText, { color: defaultColor }]}>
        {tokens.map((tok, idx) => {
          if (tok.type === 'del') {
            return (
              <Text key={idx} style={styles.tokenDel}>
                {tok.text}
              </Text>
            );
          }
          if (tok.type === 'add') {
            return (
              <Text key={idx} style={styles.tokenAdd}>
                {tok.text}
              </Text>
            );
          }
          return (
            <Text key={idx} style={styles.tokenNormal}>
              {tok.text}
            </Text>
          );
        })}
      </Text>
    );
  }

  return (
    <Text style={[styles.codeText, { color: defaultColor }]}>
      {text || ' '}
    </Text>
  );
};

export default function DiffViewer({
  oldValue = '',
  newValue = '',
  oldTitle = '对比基准',
  newTitle = '快照内容',
  layout = 'unified',
}: DiffViewerProps) {
  const stats = useMemo(() => computeDiffStats(oldValue, newValue), [oldValue, newValue]);
  const unifiedRows = useMemo(
    () => (layout === 'unified' ? computeUnifiedDiff(oldValue, newValue) : []),
    [oldValue, newValue, layout]
  );
  const splitRows = useMemo(
    () => (layout === 'split' ? computeSplitDiff(oldValue, newValue) : []),
    [oldValue, newValue, layout]
  );

  return (
    <View style={styles.container}>
      {/* 顶部基准说明与增删行统计条 */}
      <View style={styles.headerBar}>
        <View style={styles.headerTitles}>
          <View style={styles.sideTitleBadge}>
            <View style={[styles.dot, styles.baseDot]} />
            <Text style={styles.sideTitleText} numberOfLines={1}>
              {oldTitle}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={13} color="#94a3b8" />
          <View style={styles.sideTitleBadge}>
            <View style={[styles.dot, styles.targetDot]} />
            <Text style={styles.sideTitleText} numberOfLines={1}>
              {newTitle}
            </Text>
          </View>
        </View>

        <View style={styles.statsCluster}>
          {stats.isIdentical ? (
            <View style={styles.identicalBadge}>
              <Text style={styles.identicalBadgeText}>完全一致</Text>
            </View>
          ) : (
            <View style={styles.statBadges}>
              {stats.addedCount > 0 && (
                <View style={styles.statAddedBadge}>
                  <Text style={styles.statAddedText}>+{stats.addedCount} 行</Text>
                </View>
              )}
              {stats.removedCount > 0 && (
                <View style={styles.statRemovedBadge}>
                  <Text style={styles.statRemovedText}>-{stats.removedCount} 行</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* 差异主体渲染区 */}
      {stats.isIdentical ? (
        <View style={styles.identicalEmptyBox}>
          <Ionicons name="checkmark-circle-outline" size={36} color="#059669" />
          <Text style={styles.identicalTitle}>版本内容完全一致</Text>
          <Text style={styles.identicalSubtitle}>当前快照相比对比基准没有发生任何字符增删</Text>
        </View>
      ) : layout === 'unified' ? (
        <ScrollView
          style={styles.diffScroll}
          contentContainerStyle={styles.diffScrollContent}
          showsVerticalScrollIndicator={true}
        >
          {unifiedRows.map((row: UnifiedDiffRow, idx: number) => {
            const isAdd = row.type === 'add';
            const isDel = row.type === 'del';
            const sign = isAdd ? '+' : isDel ? '-' : ' ';

            return (
              <View
                key={idx}
                style={[
                  styles.unifiedRow,
                  isAdd && styles.rowAdd,
                  isDel && styles.rowDel,
                ]}
              >
                <View style={styles.gutter}>
                  <Text style={styles.gutterNum}>{row.oldLineNum ?? ''}</Text>
                  <Text style={styles.gutterNum}>{row.newLineNum ?? ''}</Text>
                  <Text
                    style={[
                      styles.gutterSign,
                      isAdd && styles.signAdd,
                      isDel && styles.signDel,
                    ]}
                  >
                    {sign}
                  </Text>
                </View>

                <View style={styles.codeCell}>
                  <TokenizedLineText
                    text={row.text}
                    tokens={row.tokens}
                    defaultColor={isDel ? '#b91c1c' : isAdd ? '#047857' : '#0f172a'}
                  />
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.splitOuterScroll}>
          <ScrollView
            style={styles.diffScroll}
            contentContainerStyle={[styles.diffScrollContent, { minWidth: 620 }]}
          >
            {splitRows.map((row: SplitDiffRow, idx: number) => (
              <View key={idx} style={styles.splitRow}>
                {/* 左栏 (基准/旧) */}
                <View
                  style={[
                    styles.splitSide,
                    styles.splitSideLeft,
                    row.left.type === 'del' && styles.rowDel,
                  ]}
                >
                  <Text style={styles.gutterNumSingle}>{row.left.lineNum ?? ''}</Text>
                  <View style={styles.splitCodeCell}>
                    <TokenizedLineText
                      text={row.left.text}
                      tokens={row.left.tokens}
                      defaultColor={row.left.type === 'del' ? '#b91c1c' : '#0f172a'}
                    />
                  </View>
                </View>

                {/* 右栏 (快照/新) */}
                <View
                  style={[
                    styles.splitSide,
                    row.right.type === 'add' && styles.rowAdd,
                  ]}
                >
                  <Text style={styles.gutterNumSingle}>{row.right.lineNum ?? ''}</Text>
                  <View style={styles.splitCodeCell}>
                    <TokenizedLineText
                      text={row.right.text}
                      tokens={row.right.tokens}
                      defaultColor={row.right.type === 'add' ? '#047857' : '#0f172a'}
                    />
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitles: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  sideTitleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 130,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  baseDot: {
    backgroundColor: '#94a3b8',
  },
  targetDot: {
    backgroundColor: '#1890ff',
  },
  sideTitleText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  statsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identicalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  identicalBadgeText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },
  statBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statAddedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  statAddedText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: '#059669',
    fontWeight: '600',
  },
  statRemovedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  statRemovedText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: '#dc2626',
    fontWeight: '600',
  },
  identicalEmptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  identicalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 10,
  },
  identicalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    textAlign: 'center',
  },
  diffScroll: {
    flex: 1,
  },
  diffScrollContent: {
    paddingVertical: 4,
  },
  unifiedRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  rowAdd: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  rowDel: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  gutter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#f8fafc',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  gutterNum: {
    width: 28,
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
    paddingRight: 4,
  },
  gutterSign: {
    width: 14,
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    fontWeight: '600',
  },
  signAdd: {
    color: '#059669',
  },
  signDel: {
    color: '#dc2626',
  },
  codeCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  codeText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
  },
  tokenNormal: {
    color: '#0f172a',
  },
  tokenDel: {
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    color: '#b91c1c',
    borderRadius: 2,
  },
  tokenAdd: {
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
    color: '#047857',
    borderRadius: 2,
  },
  splitOuterScroll: {
    flex: 1,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  splitSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  splitSideLeft: {
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  gutterNumSingle: {
    width: 32,
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#94a3b8',
    backgroundColor: '#f8fafc',
    textAlign: 'right',
    paddingRight: 6,
    paddingVertical: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e2e8f0',
  },
  splitCodeCell: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    justifyContent: 'center',
  },
});
