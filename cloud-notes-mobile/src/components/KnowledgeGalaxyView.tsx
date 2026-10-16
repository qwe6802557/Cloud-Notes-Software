import React, { useMemo, useEffect, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface GraphNode {
  id: string;
  title: string;
  notebookId?: string;
  notebookName?: string;
  notebookColor?: string;
  backlinkCount?: number;
  outlinkCount?: number;
  totalDegree?: number;
  updatedAt?: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface KnowledgeGalaxyViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  focusNodeId: string;
  focusNodeTitle: string;
  mode?: 'compact' | 'fullscreen';
  width?: number;
  height?: number;
  isDepth2?: boolean;
  selectedNodeId?: string | null;
  onSelectNode: (node: GraphNode) => void;
  onSelectCenter?: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function KnowledgeGalaxyView({
  nodes,
  links,
  focusNodeId,
  focusNodeTitle,
  mode = 'compact',
  width: customWidth,
  height: customHeight,
  isDepth2 = false,
  selectedNodeId,
  onSelectNode,
  onSelectCenter,
}: KnowledgeGalaxyViewProps) {
  // 画布尺寸计算
  const canvasWidth = customWidth || (mode === 'fullscreen' ? SCREEN_WIDTH - 32 : SCREEN_WIDTH - 48);
  const canvasHeight = customHeight || (mode === 'fullscreen' ? 360 : 230);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  // 呼吸光晕动画
  const [pulseAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // 极坐标几何计算
  const { nodePositions, lineElements, firstNodes, secondNodes } = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; isFocus: boolean; isFirstDegree: boolean }>();

    // 锚定中心恒星
    positions.set(focusNodeId, {
      x: centerX,
      y: centerY,
      isFocus: true,
      isFirstDegree: false,
    });

    // 区分 1 度与 2 度节点
    const firstDegreeIdSet = new Set<string>();
    links.forEach((l) => {
      const s = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const t = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (s === focusNodeId) firstDegreeIdSet.add(t);
      if (t === focusNodeId) firstDegreeIdSet.add(s);
    });

    const otherNodes = nodes.filter((n) => n.id !== focusNodeId);
    const first = otherNodes.filter((n) => firstDegreeIdSet.has(n.id));
    const second = isDepth2 ? otherNodes.filter((n) => !firstDegreeIdSet.has(n.id)) : [];

    // 轨道半径配置
    const r1 = mode === 'fullscreen' ? Math.min(canvasWidth, canvasHeight) * 0.32 : Math.min(canvasWidth, canvasHeight) * 0.33;
    const r2 = mode === 'fullscreen' ? Math.min(canvasWidth, canvasHeight) * 0.44 : Math.min(canvasWidth, canvasHeight) * 0.45;

    // 1 度卫星排布 (起始角 -π/2 正北向上)
    first.forEach((n, idx) => {
      const angle = (idx / Math.max(1, first.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, {
        x: centerX + Math.cos(angle) * r1,
        y: centerY + Math.sin(angle) * r1,
        isFocus: false,
        isFirstDegree: true,
      });
    });

    // 2 度卫星排布 (错开 -π/4 避免重合)
    second.forEach((n, idx) => {
      const angle = (idx / Math.max(1, second.length)) * Math.PI * 2 - Math.PI / 4;
      positions.set(n.id, {
        x: centerX + Math.cos(angle) * r2,
        y: centerY + Math.sin(angle) * r2,
        isFocus: false,
        isFirstDegree: false,
      });
    });

    // 硬件加速线段几何构造
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

      const isHighLightLine =
        selectedNodeId && (sId === selectedNodeId || tId === selectedNodeId);
      const isCenterLine = p1.isFocus || p2.isFocus;

      return (
        <View
          key={`line-${index}-${sId}-${tId}`}
          style={{
            position: 'absolute',
            left: (p1.x + p2.x) / 2 - length / 2,
            top: (p1.y + p2.y) / 2 - 0.75,
            width: length,
            height: isHighLightLine ? 2 : 1,
            backgroundColor: isHighLightLine
              ? '#2563eb'
              : isCenterLine
              ? '#bfdbfe'
              : '#e2e8f0',
            opacity: isHighLightLine ? 1 : isCenterLine ? 0.75 : 0.45,
            transform: [{ rotate: `${angle}rad` }],
          }}
        />
      );
    }).filter(Boolean);

    return {
      nodePositions: positions,
      lineElements: lines,
      firstNodes: first,
      secondNodes: second,
    };
  }, [nodes, links, focusNodeId, centerX, centerY, canvasWidth, canvasHeight, mode, isDepth2, selectedNodeId]);

  // 轨道环尺寸
  const orbit1Radius = mode === 'fullscreen' ? Math.min(canvasWidth, canvasHeight) * 0.32 : Math.min(canvasWidth, canvasHeight) * 0.33;
  const orbit2Radius = mode === 'fullscreen' ? Math.min(canvasWidth, canvasHeight) * 0.44 : Math.min(canvasWidth, canvasHeight) * 0.45;

  return (
    <View style={[styles.container, { width: canvasWidth, height: canvasHeight }]}>
      {/* 1度同心圆引力轨道 */}
      <View
        style={[
          styles.orbitTrack,
          {
            width: orbit1Radius * 2,
            height: orbit1Radius * 2,
            left: centerX - orbit1Radius,
            top: centerY - orbit1Radius,
            borderColor: '#e2e8f0',
          },
        ]}
      />

      {/* 2度同心圆远轨 */}
      {isDepth2 && (
        <View
          style={[
            styles.orbitTrack,
            {
              width: orbit2Radius * 2,
              height: orbit2Radius * 2,
              left: centerX - orbit2Radius,
              top: centerY - orbit2Radius,
              borderColor: '#f1f5f9',
              borderStyle: 'dashed',
            },
          ]}
        />
      )}

      {/* 硬件加速线段层 */}
      {lineElements}

      {/* 卫星节点渲染层 */}
      {nodes.map((node) => {
        if (node.id === focusNodeId) return null;
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        const isSelected = selectedNodeId === node.id;
        const isFirst = pos.isFirstDegree;
        const nodeSize = isFirst ? (mode === 'fullscreen' ? 28 : 24) : (mode === 'fullscreen' ? 22 : 18);
        const color = node.notebookColor || '#3b82f6';

        return (
          <TouchableOpacity
            key={`galaxy-node-${node.id}`}
            style={[
              styles.satelliteNodeWrap,
              {
                left: pos.x - nodeSize / 2,
                top: pos.y - nodeSize / 2,
                zIndex: isSelected ? 20 : 10,
              },
            ]}
            onPress={() => onSelectNode(node)}
            activeOpacity={0.8}
          >
            {/* 卫星主体球 */}
            <View
              style={[
                styles.satelliteCircle,
                {
                  width: nodeSize,
                  height: nodeSize,
                  borderRadius: nodeSize / 2,
                  borderColor: isSelected ? '#1890ff' : color,
                  backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                },
                isSelected && styles.satelliteSelected,
              ]}
            >
              <View
                style={[
                  styles.satelliteCoreDot,
                  {
                    backgroundColor: isSelected ? '#1890ff' : color,
                    width: isFirst ? 8 : 6,
                    height: isFirst ? 8 : 6,
                    borderRadius: 4,
                  },
                ]}
              />
            </View>

            {/* 卫星节点标题微胶囊 */}
            <View
              style={[
                styles.titleBadge,
                isSelected && styles.titleBadgeSelected,
                !isFirst && styles.titleBadgeSecond,
              ]}
            >
              <Text
                style={[
                  styles.titleText,
                  isSelected && styles.titleTextSelected,
                  !isFirst && styles.titleTextSecond,
                ]}
                numberOfLines={1}
              >
                {node.title}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {/* 中心引力恒星 */}
      <TouchableOpacity
        style={[
          styles.centerStarWrap,
          {
            left: centerX - 24,
            top: centerY - 24,
            zIndex: 15,
          },
        ]}
        onPress={onSelectCenter}
        activeOpacity={0.85}
      >
        {/* 呼吸外晕 */}
        <Animated.View
          style={[
            styles.centerAura,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
        {/* 恒星核心球 */}
        <View style={styles.centerStarBody}>
          <Ionicons name="sparkles" size={14} color="#ffffff" />
        </View>
        {/* 中心节点常驻标题 */}
        <View style={styles.centerTitleBadge}>
          <Text style={styles.centerTitleText} numberOfLines={1}>
            {focusNodeTitle || '当前核心'}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: '#fafbfc',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#f1f5f9',
    alignSelf: 'center',
    marginVertical: 4,
  },
  orbitTrack: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 9999,
  },
  centerStarWrap: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerAura: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(24, 144, 255, 0.16)',
  },
  centerStarBody: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  centerTitleBadge: {
    position: 'absolute',
    top: 36,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    maxWidth: 96,
  },
  centerTitleText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
  satelliteNodeWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  satelliteCircle: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  satelliteSelected: {
    borderWidth: 2,
    borderColor: '#1890ff',
    transform: [{ scale: 1.15 }],
  },
  satelliteCoreDot: {},
  titleBadge: {
    marginTop: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    maxWidth: 80,
  },
  titleBadgeSelected: {
    backgroundColor: '#1890ff',
    borderColor: '#1890ff',
  },
  titleBadgeSecond: {
    backgroundColor: 'rgba(248, 250, 252, 0.88)',
    borderColor: '#f1f5f9',
  },
  titleText: {
    fontSize: 9.5,
    color: '#334155',
    fontWeight: '500',
  },
  titleTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  titleTextSecond: {
    fontSize: 8.5,
    color: '#94a3b8',
  },
});
