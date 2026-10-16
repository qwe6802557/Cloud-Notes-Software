import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GraphNode } from './KnowledgeGalaxyView';

export interface GalaxyPeekCardProps {
  node: GraphNode;
  focusNodeTitle: string;
  linkRelation?: 'in' | 'out' | 'bidirectional' | 'indirect';
  onClose: () => void;
  onNavigate: (nodeId: string, title: string) => void;
  onFocusAsCenter: (nodeId: string, title: string) => void;
}

export default function GalaxyPeekCard({
  node,
  focusNodeTitle,
  linkRelation = 'out',
  onClose,
  onNavigate,
  onFocusAsCenter,
}: GalaxyPeekCardProps) {
  const nbColor = node.notebookColor || '#3b82f6';
  const nbName = node.notebookName || '默认笔记本';

  // 双链引力关系文本与图标
  const relationMeta = {
    bidirectional: { text: '双向互引', icon: 'swap-horizontal', color: '#7c3aed', bg: '#f5f3ff' },
    in: { text: `引用了《${focusNodeTitle || '本篇'}》`, icon: 'arrow-down', color: '#059669', bg: '#ecfdf5' },
    out: { text: `被《${focusNodeTitle || '本篇'}》引用`, icon: 'arrow-up', color: '#2563eb', bg: '#eff6ff' },
    indirect: { text: '2度延伸关联', icon: 'git-commit-outline', color: '#d97706', bg: '#fffbeb' },
  }[linkRelation] || { text: '知识关联', icon: 'link', color: '#64748b', bg: '#f8fafc' };

  return (
    <View style={styles.cardContainer}>
      {/* 头部元信息栏 */}
      <View style={styles.headerRow}>
        <View style={styles.headerTags}>
          {/* 关系胶囊 */}
          <View style={[styles.relationBadge, { backgroundColor: relationMeta.bg }]}>
            <Ionicons name={relationMeta.icon as any} size={11} color={relationMeta.color} style={{ marginRight: 3 }} />
            <Text style={[styles.relationText, { color: relationMeta.color }]} numberOfLines={1}>
              {relationMeta.text}
            </Text>
          </View>

          {/* 笔记本胶囊 */}
          <View style={[styles.notebookBadge, { borderColor: `${nbColor}40`, backgroundColor: `${nbColor}12` }]}>
            <View style={[styles.notebookDot, { backgroundColor: nbColor }]} />
            <Text style={[styles.notebookText, { color: nbColor }]} numberOfLines={1}>
              {nbName}
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* 笔记标题与度数统计 */}
      <View style={styles.bodyWrap}>
        <Text style={styles.nodeTitle} numberOfLines={2}>
          {node.title}
        </Text>
        <View style={styles.degreeRow}>
          <Text style={styles.degreeText}>
            总关联度 <Text style={styles.degreeNumber}>{node.totalDegree ?? ((node.backlinkCount || 0) + (node.outlinkCount || 0))}</Text>
          </Text>
          <Text style={styles.degreeDivider}>·</Text>
          <Text style={styles.degreeText}>入链 {node.backlinkCount || 0}</Text>
          <Text style={styles.degreeDivider}>·</Text>
          <Text style={styles.degreeText}>出链 {node.outlinkCount || 0}</Text>
        </View>
      </View>

      {/* 底部双操作按钮栏 */}
      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.roamBtn}
          onPress={() => onFocusAsCenter(node.id, node.title)}
          activeOpacity={0.75}
        >
          <Ionicons name="git-network-outline" size={13} color="#2563eb" style={{ marginRight: 4 }} />
          <Text style={styles.roamBtnText}>以它为中心漫游</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.openBtn}
          onPress={() => onNavigate(node.id, node.title)}
          activeOpacity={0.8}
        >
          <Text style={styles.openBtnText}>阅读全文</Text>
          <Ionicons name="arrow-forward" size={13} color="#ffffff" style={{ marginLeft: 3 }} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    marginHorizontal: 2,
    marginVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTags: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  relationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 160,
  },
  relationText: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  notebookBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 100,
  },
  notebookDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  notebookText: {
    fontSize: 10,
    fontWeight: '500',
  },
  closeBtn: {
    padding: 2,
  },
  bodyWrap: {
    marginBottom: 10,
  },
  nodeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 19,
    marginBottom: 4,
  },
  degreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  degreeText: {
    fontSize: 11,
    color: '#64748b',
  },
  degreeNumber: {
    fontWeight: '600',
    color: '#1890ff',
  },
  degreeDivider: {
    fontSize: 11,
    color: '#cbd5e1',
    marginHorizontal: 5,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roamBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingVertical: 7,
  },
  roamBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  openBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1890ff',
    borderRadius: 8,
    paddingVertical: 7,
  },
  openBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
});
