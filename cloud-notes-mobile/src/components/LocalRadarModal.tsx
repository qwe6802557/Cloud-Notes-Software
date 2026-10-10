import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getKnowledgeGraph } from '../api/notesApi';

interface LocalRadarModalProps {
  visible: boolean;
  onClose: () => void;
  focusNoteId: string;
  focusNoteTitle: string;
  onSelectNote: (noteId: string) => void;
}

interface GraphNode {
  id: string;
  title: string;
  notebookId: string;
  notebookName: string;
  notebookColor: string;
}

interface GraphLink {
  source: string;
  target: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_SIZE = Math.min(SCREEN_WIDTH - 32, 340);
const CENTER_X = CANVAS_SIZE / 2;
const CENTER_Y = CANVAS_SIZE / 2;

export default function LocalRadarModal({
  visible,
  onClose,
  focusNoteId,
  focusNoteTitle,
  onSelectNote,
}: LocalRadarModalProps) {
  const [loading, setLoading] = useState(false);
  const [isDepth2, setIsDepth2] = useState(false);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);

  // 加载局部图谱数据
  const loadLocalGraph = useCallback(async (depth: number) => {
    if (!focusNoteId) return;
    setLoading(true);
    try {
      const res = await getKnowledgeGraph({
        focusNoteId,
        depth,
      });
      if (res?.code === 200 && res.data) {
        setNodes(res.data.nodes || []);
        setLinks(res.data.links || []);
      } else {
        setNodes([]);
        setLinks([]);
      }
    } catch {
      setNodes([]);
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [focusNoteId]);

  useEffect(() => {
    if (visible && focusNoteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadLocalGraph(isDepth2 ? 2 : 1);
    }
  }, [visible, focusNoteId, isDepth2, loadLocalGraph]);

  // 极坐标几何计算节点与连线排布
  const { nodePositions, lineElements } = useMemo(() => {
    if (!nodes.length) return { nodePositions: new Map(), lineElements: [] };

    const positions = new Map<string, { x: number; y: number; isFocus: boolean }>();

    // 1. 中心锚定当前笔记
    positions.set(focusNoteId, { x: CENTER_X, y: CENTER_Y, isFocus: true });

    // 2. 区分 1 度邻居与 2 度邻居
    const firstDegreeSet = new Set<string>();
    links.forEach(l => {
      const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (s === focusNoteId) firstDegreeSet.add(t);
      if (t === focusNoteId) firstDegreeSet.add(s);
    });

    const otherNodes = nodes.filter(n => n.id !== focusNoteId);
    const firstNodes = otherNodes.filter(n => firstDegreeSet.has(n.id));
    const secondNodes = otherNodes.filter(n => !firstDegreeSet.has(n.id));

    // 内圈 1 度邻居半径
    const r1 = Math.min(CANVAS_SIZE * 0.35, 105);
    firstNodes.forEach((n, idx) => {
      const angle = (idx / Math.max(1, firstNodes.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, {
        x: CENTER_X + Math.cos(angle) * r1,
        y: CENTER_Y + Math.sin(angle) * r1,
        isFocus: false,
      });
    });

    // 外圈 2 度邻居半径
    const r2 = Math.min(CANVAS_SIZE * 0.44, 138);
    secondNodes.forEach((n, idx) => {
      const angle = (idx / Math.max(1, secondNodes.length)) * Math.PI * 2 - Math.PI / 4;
      positions.set(n.id, {
        x: CENTER_X + Math.cos(angle) * r2,
        y: CENTER_Y + Math.sin(angle) * r2,
        isFocus: false,
      });
    });

    // 3. 构建硬件加速纯几何连线
    const lines = links.map((l, index) => {
      const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
      const p1 = positions.get(sId);
      const p2 = positions.get(tId);
      if (!p1 || !p2) return null;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      return (
        <View
          key={`line-${index}-${sId}-${tId}`}
          style={{
            position: 'absolute',
            left: (p1.x + p2.x) / 2 - length / 2,
            top: (p1.y + p2.y) / 2 - 0.75,
            width: length,
            height: 1.5,
            backgroundColor: (p1.isFocus || p2.isFocus) ? '#93c5fd' : '#e2e8f0',
            transform: [{ rotate: `${angle}rad` }],
          }}
        />
      );
    }).filter(Boolean);

    return { nodePositions: positions, lineElements: lines };
  }, [nodes, links, focusNoteId]);

  const neighborCount = Math.max(0, nodes.length - 1);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              {/* 顶部指示条 */}
              <View style={styles.dragHandle} />

              {/* 标题控制栏 */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Ionicons name="git-network" size={20} color="#2563eb" style={{ marginRight: 6 }} />
                  <Text style={styles.title}>局部关系雷达</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{neighborCount} 关联</Text>
                  </View>
                </View>

                <View style={styles.headerRight}>
                  <Text style={styles.switchLabel}>2度网络</Text>
                  <Switch
                    value={isDepth2}
                    onValueChange={setIsDepth2}
                    trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                    thumbColor={isDepth2 ? '#2563eb' : '#f8fafc'}
                    style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                  />
                  <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* 可视化绘图区 */}
              <View style={styles.canvasWrapper}>
                {loading ? (
                  <View style={styles.centerBox}>
                    <ActivityIndicator size="large" color="#2563eb" />
                    <Text style={styles.loadingText}>计算关系雷达中...</Text>
                  </View>
                ) : neighborCount === 0 ? (
                  <View style={styles.centerBox}>
                    <Ionicons name="git-commit-outline" size={48} color="#cbd5e1" />
                    <Text style={styles.emptyTitle}>暂无关联双链</Text>
                    <Text style={styles.emptySub}>在正文中使用 [[笔记标题]] 即可与此笔记建立双链</Text>
                  </View>
                ) : (
                  <View style={[styles.canvas, { width: CANVAS_SIZE, height: CANVAS_SIZE }]}>
                    {/* 背景同心圆轨道 */}
                    <View
                      style={[
                        styles.orbitCircle,
                        {
                          width: CANVAS_SIZE * 0.7,
                          height: CANVAS_SIZE * 0.7,
                          left: CANVAS_SIZE * 0.15,
                          top: CANVAS_SIZE * 0.15,
                        },
                      ]}
                    />
                    {isDepth2 && (
                      <View
                        style={[
                          styles.orbitCircle,
                          {
                            width: CANVAS_SIZE * 0.88,
                            height: CANVAS_SIZE * 0.88,
                            left: CANVAS_SIZE * 0.06,
                            top: CANVAS_SIZE * 0.06,
                            borderColor: '#e2e8f0',
                          },
                        ]}
                      />
                    )}

                    {/* 几何连线层 */}
                    {lineElements}

                    {/* 节点气泡层 */}
                    {nodes.map(node => {
                      const pos = nodePositions.get(node.id);
                      if (!pos) return null;
                      const isFocus = pos.isFocus;

                      return (
                        <TouchableOpacity
                          key={node.id}
                          style={[
                            styles.nodeBubble,
                            isFocus ? styles.focusBubble : styles.neighborBubble,
                            {
                              left: pos.x - (isFocus ? 54 : 44),
                              top: pos.y - (isFocus ? 22 : 18),
                            },
                          ]}
                          onPress={() => {
                            if (!isFocus) {
                              onClose();
                              onSelectNote(node.id);
                            }
                          }}
                          activeOpacity={isFocus ? 1 : 0.7}
                        >
                          <View
                            style={[
                              styles.colorDot,
                              { backgroundColor: node.notebookColor || (isFocus ? '#2563eb' : '#64748b') },
                            ]}
                          />
                          <Text
                            style={[
                              styles.nodeText,
                              isFocus && styles.focusNodeText,
                            ]}
                            numberOfLines={1}
                          >
                            {isFocus ? (focusNoteTitle || node.title) : node.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* 底部交互提示 */}
              <View style={styles.footerHint}>
                <Ionicons name="sparkles-outline" size={13} color="#64748b" style={{ marginRight: 4 }} />
                <Text style={styles.hintText}>点击周边微节点，即刻跳转穿透至对应笔记</Text>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 16,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  badge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563eb',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 12,
    color: '#64748b',
    marginRight: -4,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 6,
  },
  canvasWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: CANVAS_SIZE,
  },
  canvas: {
    position: 'relative',
  },
  orbitCircle: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e0e7ff',
    borderStyle: 'dashed',
  },
  nodeBubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 10,
  },
  focusBubble: {
    width: 108,
    height: 44,
    backgroundColor: '#2563eb',
    borderColor: '#1d4ed8',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  neighborBubble: {
    width: 88,
    height: 36,
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  colorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  nodeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#334155',
    flex: 1,
  },
  focusNodeText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 240,
  },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  hintText: {
    fontSize: 11,
    color: '#64748b',
  },
});
