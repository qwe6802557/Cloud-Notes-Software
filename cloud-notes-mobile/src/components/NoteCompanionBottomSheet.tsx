import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isItemWeaved } from '../utils/weavingUtils';
import { getKnowledgeGraph } from '../api/notesApi';
import KnowledgeGalaxyView, { GraphNode, GraphLink } from './KnowledgeGalaxyView';
import GalaxyPeekCard from './GalaxyPeekCard';

export type CompanionTab = 'backlinks' | 'toc' | 'radar' | 'ai';

export interface TocItem {
  level: number;
  text: string;
}

export interface NoteCompanionBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  noteContent: string;
  tocList: TocItem[];
  backlinksData: {
    backlinks: any[];
    unresolvedMentions: any[];
    totalCount: number;
  };
  initialTab?: CompanionTab;
  onSelectTocItem: (item: TocItem) => void;
  onOpenNote: (targetNoteId: string, title?: string) => void;
  onWeaveBacklink: (item: any) => Promise<void> | void;
  onWeaveAllBacklinks: (items: any[]) => Promise<void> | void;
  onOpenAIAction: (actionKey: string) => void;
  isWeaving?: boolean;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const AI_QUICK_ACTIONS = [
  { key: 'full_summary', icon: 'document-text-outline', title: '核心摘要提炼', desc: '提炼全文关键论点与核心结论' },
  { key: 'extract_todos', icon: 'checkbox-outline', title: '行动待办提取', desc: '结构化梳理正文所有任务待办清单' },
  { key: 'mindmap_outline', icon: 'git-network-outline', title: '思维导图大纲', desc: '生成层次分明的概念思维框架' },
  { key: 'continue', icon: 'pencil-outline', title: '承接脉络续写', desc: '依循上下文深度拓展下文思考' },
  { key: 'custom', icon: 'chatbubbles-outline', title: '针对笔记问答', desc: '与 AI 助手就全篇笔记进行深度对话' },
];

export default function NoteCompanionBottomSheet({
  visible,
  onClose,
  noteId,
  noteTitle,
  noteContent,
  tocList,
  backlinksData,
  initialTab = 'backlinks',
  onSelectTocItem,
  onOpenNote,
  onWeaveBacklink,
  onWeaveAllBacklinks,
  onOpenAIAction,
  isWeaving = false,
}: NoteCompanionBottomSheetProps) {
  const [activeTab, setActiveTab] = useState<CompanionTab>(initialTab);

  // 关系雷达与动态知识星系状态
  const [radarFocusId, setRadarFocusId] = useState<string>(noteId);
  const [radarFocusTitle, setRadarFocusTitle] = useState<string>(noteTitle);
  const [isDepth2, setIsDepth2] = useState<boolean>(false);
  const [radarLoading, setRadarLoading] = useState<boolean>(false);
  const [radarNodes, setRadarNodes] = useState<GraphNode[]>([]);
  const [radarLinks, setRadarLinks] = useState<GraphLink[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isFullScreenGalaxy, setIsFullScreenGalaxy] = useState<boolean>(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
      setRadarFocusId(noteId);
      setRadarFocusTitle(noteTitle);
      setSelectedNode(null);
    }
  }, [visible, initialTab, noteId, noteTitle]);

  // 加载知识图谱数据
  const loadRadarData = useCallback(async (targetFocusId: string, depth: number) => {
    if (!targetFocusId) return;
    setRadarLoading(true);
    try {
      const res = await getKnowledgeGraph({
        focusNoteId: targetFocusId,
        depth,
      });
      if (res?.code === 200 && res.data) {
        setRadarNodes(res.data.nodes || []);
        setRadarLinks(res.data.links || []);
      } else {
        setRadarNodes([]);
        setRadarLinks([]);
      }
    } catch {
      setRadarNodes([]);
      setRadarLinks([]);
    } finally {
      setRadarLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (visible && activeTab === 'radar' && radarFocusId) {
      loadRadarData(radarFocusId, isDepth2 ? 2 : 1);
    }
  }, [visible, activeTab, radarFocusId, isDepth2, loadRadarData]);

  // 计算当前选中节点与中心恒星的双链关系
  const selectedNodeRelation = useMemo(() => {
    if (!selectedNode) return 'out';
    const sId = radarFocusId;
    const tId = selectedNode.id;
    let hasOut = false;
    let hasIn = false;
    radarLinks.forEach((l) => {
      const src = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tgt = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (src === sId && tgt === tId) hasOut = true;
      if (src === tId && tgt === sId) hasIn = true;
    });
    if (hasOut && hasIn) return 'bidirectional';
    if (hasOut) return 'out';
    if (hasIn) return 'in';
    return 'indirect';
  }, [selectedNode, radarFocusId, radarLinks]);

  // 原地漫游：设置新节点为引力中心
  const handleFocusAsCenter = useCallback((nodeId: string, title: string) => {
    setRadarFocusId(nodeId);
    setRadarFocusTitle(title);
    setSelectedNode(null);
  }, []);

  // 重置回本篇笔记中心
  const handleResetFocus = useCallback(() => {
    setRadarFocusId(noteId);
    setRadarFocusTitle(noteTitle);
    setSelectedNode(null);
  }, [noteId, noteTitle]);

  // 过滤中心节点后的周边卫星列表
  const neighborNodes = useMemo(() => {
    return radarNodes.filter((n) => n.id !== radarFocusId);
  }, [radarNodes, radarFocusId]);

  // 统计未回织数量
  const unweavedBacklinks = useMemo(() => {
    return (backlinksData.backlinks || []).filter(item => !isItemWeaved(noteContent, item.title));
  }, [backlinksData.backlinks, noteContent]);

  const totalBacklinksCount = backlinksData.totalCount || 0;

  return (
    <>
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
              {/* 顶部指示条把手 */}
              <View style={styles.dragHandle} />

              {/* 头部标题与关闭按钮 */}
              <View style={styles.headerRow}>
                <View style={styles.headerTitleWrap}>
                  <Ionicons name="sparkles" size={17} color="#7c3aed" style={{ marginRight: 6 }} />
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    智能知识伴侣
                  </Text>
                  <Text style={styles.headerSubTitle} numberOfLines={1}>
                    · 《{noteTitle || '当前笔记'}》
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Tab 导航分段滑块控制器 (Segmented Control) */}
              <View style={styles.tabsBar}>
                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'backlinks' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('backlinks')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="git-network-outline"
                    size={13}
                    color={activeTab === 'backlinks' ? '#1890ff' : '#64748b'}
                  />
                  <Text numberOfLines={1} style={[styles.tabText, activeTab === 'backlinks' && styles.tabTextActive]}>
                    反向双链
                  </Text>
                  {totalBacklinksCount > 0 && (
                    <View style={[styles.tabBadge, activeTab === 'backlinks' && styles.tabBadgeActive]}>
                      <Text style={[styles.tabBadgeText, activeTab === 'backlinks' && styles.tabBadgeTextActive]}>
                        {totalBacklinksCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'toc' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('toc')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="list-outline"
                    size={13}
                    color={activeTab === 'toc' ? '#1890ff' : '#64748b'}
                  />
                  <Text numberOfLines={1} style={[styles.tabText, activeTab === 'toc' && styles.tabTextActive]}>
                    目录大纲
                  </Text>
                  {tocList.length > 0 && (
                    <View style={[styles.tabBadge, activeTab === 'toc' && styles.tabBadgeActive]}>
                      <Text style={[styles.tabBadgeText, activeTab === 'toc' && styles.tabBadgeTextActive]}>
                        {tocList.length}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'radar' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('radar')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="compass-outline"
                    size={13}
                    color={activeTab === 'radar' ? '#1890ff' : '#64748b'}
                  />
                  <Text numberOfLines={1} style={[styles.tabText, activeTab === 'radar' && styles.tabTextActive]}>
                    关系雷达
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabBtn, activeTab === 'ai' && styles.tabBtnActive]}
                  onPress={() => setActiveTab('ai')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={13}
                    color={activeTab === 'ai' ? '#7c3aed' : '#64748b'}
                  />
                  <Text numberOfLines={1} style={[styles.tabText, activeTab === 'ai' && styles.tabTextAiActive]}>
                    AI 伴侣
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 主内容区域 */}
              <View style={styles.bodyContainer}>
                {/* 1. 反向双链 Tab */}
                {activeTab === 'backlinks' && (
                  <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                  >
                    {/* 一键全部回织顶部操作栏 */}
                    <View style={styles.sectionHeaderRow}>
                      <View style={styles.sectionTitleWrap}>
                        <Text style={styles.sectionTitle}>显式引用本文的笔记</Text>
                        <Text style={styles.sectionSubTitle}>
                          共 {backlinksData.backlinks.length} 篇引用
                        </Text>
                      </View>

                      {backlinksData.backlinks.length > 0 && (
                        <TouchableOpacity
                          style={[
                            styles.weaveAllBtn,
                            unweavedBacklinks.length === 0 && styles.weaveAllBtnDisabled,
                          ]}
                          disabled={unweavedBacklinks.length === 0 || isWeaving}
                          onPress={() => onWeaveAllBacklinks(unweavedBacklinks)}
                          activeOpacity={0.8}
                        >
                          {isWeaving ? (
                            <ActivityIndicator size="small" color="#1890ff" />
                          ) : unweavedBacklinks.length > 0 ? (
                            <>
                              <Ionicons name="link" size={13} color="#ffffff" style={{ marginRight: 4 }} />
                              <Text style={styles.weaveAllBtnText}>
                                全部回织 ({unweavedBacklinks.length})
                              </Text>
                            </>
                          ) : (
                            <>
                              <Ionicons name="checkmark" size={13} color="#94a3b8" style={{ marginRight: 4 }} />
                              <Text style={styles.weaveAllBtnDisabledText}>已全部回织</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>

                    {backlinksData.backlinks.length === 0 ? (
                      <View style={styles.emptyContainer}>
                        <Ionicons name="git-network-outline" size={36} color="#cbd5e1" />
                        <Text style={styles.emptyTitle}>暂无显式反向链接</Text>
                        <Text style={styles.emptyDesc}>
                          在其他任意笔记中输入 [[{noteTitle || '当前笔记'}]] 即可自动建立双向互联
                        </Text>
                      </View>
                    ) : (
                      backlinksData.backlinks.map((item: any) => {
                        const isWeaved = isItemWeaved(noteContent, item.title);
                        const nbName = item.notebook?.name || item.notebookId?.name;
                        const nbColor = item.notebook?.color || '#3b82f6';
                        const snippet = (item.snippet || item.contextSnippet || '')
                          .replace(/==([^=]+)==/g, '$1');

                        return (
                          <View key={item._id} style={[styles.backlinkCard, isWeaved && styles.backlinkCardWeaved]}>
                            <TouchableOpacity
                              style={styles.cardHeader}
                              onPress={() => {
                                onClose();
                                onOpenNote(item._id, item.title);
                              }}
                              activeOpacity={0.7}
                            >
                              <View style={styles.cardTitleWrap}>
                                <Ionicons name="document-text-outline" size={15} color="#1890ff" style={{ marginRight: 6 }} />
                                <Text style={styles.cardNoteTitle} numberOfLines={1}>
                                  {item.title}
                                </Text>
                              </View>
                              {nbName && (
                                <View style={[styles.notebookTag, { borderColor: `${nbColor}40`, backgroundColor: `${nbColor}12` }]}>
                                  <View style={[styles.notebookDot, { backgroundColor: nbColor }]} />
                                  <Text style={[styles.notebookTagText, { color: nbColor }]}>{nbName}</Text>
                                </View>
                              )}
                            </TouchableOpacity>

                            {snippet ? (
                              <Text style={styles.cardSnippet} numberOfLines={2}>
                                “{snippet}”
                              </Text>
                            ) : null}

                            {/* 卡片回织操作条 */}
                            <View style={styles.cardFooter}>
                              <TouchableOpacity
                                style={styles.previewLinkBtn}
                                onPress={() => {
                                  onClose();
                                  onOpenNote(item._id, item.title);
                                }}
                              >
                                <Ionicons name="open-outline" size={13} color="#64748b" style={{ marginRight: 3 }} />
                                <Text style={styles.previewLinkText}>打开原笔记</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[styles.weaveSingleBtn, isWeaved && styles.weaveSingleBtnDisabled]}
                                disabled={isWeaved || isWeaving}
                                onPress={() => onWeaveBacklink(item)}
                                activeOpacity={0.8}
                              >
                                {isWeaved ? (
                                  <>
                                    <Ionicons name="checkmark-circle-outline" size={13} color="#94a3b8" style={{ marginRight: 3 }} />
                                    <Text style={styles.weaveSingleBtnDisabledText}>已回织</Text>
                                  </>
                                ) : (
                                  <>
                                    <Ionicons name="link" size={13} color="#1890ff" style={{ marginRight: 3 }} />
                                    <Text style={styles.weaveSingleBtnText}>一键回织</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}

                    {/* 未建链接提及 */}
                    {backlinksData.unresolvedMentions && backlinksData.unresolvedMentions.length > 0 && (
                      <View style={{ marginTop: 20 }}>
                        <View style={styles.sectionHeaderRow}>
                          <View style={styles.sectionTitleWrap}>
                            <Text style={styles.sectionTitle}>未建链接提及</Text>
                            <Text style={styles.sectionSubTitle}>
                              正文提及关键词但未包裹双链 ({backlinksData.unresolvedMentions.length})
                            </Text>
                          </View>
                        </View>

                        {backlinksData.unresolvedMentions.map((item: any) => {
                          const nbName = item.notebook?.name || item.notebookId?.name;
                          const snippet = (item.snippet || item.contextSnippet || '').replace(/==([^=]+)==/g, '$1');

                          return (
                            <TouchableOpacity
                              key={`mention-${item._id}`}
                              style={[styles.backlinkCard, styles.mentionCard]}
                              onPress={() => {
                                onClose();
                                onOpenNote(item._id, item.title);
                              }}
                              activeOpacity={0.7}
                            >
                              <View style={styles.cardHeader}>
                                <View style={styles.cardTitleWrap}>
                                  <Ionicons name="help-circle-outline" size={15} color="#d97706" style={{ marginRight: 6 }} />
                                  <Text style={styles.cardNoteTitle} numberOfLines={1}>
                                    {item.title}
                                  </Text>
                                </View>
                                {nbName && (
                                  <View style={[styles.notebookTag, { borderColor: '#fed7aa', backgroundColor: '#fffaf5' }]}>
                                    <Text style={[styles.notebookTagText, { color: '#d97706' }]}>{nbName}</Text>
                                  </View>
                                )}
                              </View>
                              {snippet ? (
                                <Text style={styles.cardSnippet} numberOfLines={2}>
                                  “{snippet}”
                                </Text>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </ScrollView>
                )}

                {/* 2. 目录大纲 Tab */}
                {activeTab === 'toc' && (
                  <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                  >
                    {tocList.length === 0 ? (
                      <View style={styles.emptyContainer}>
                        <Ionicons name="list-outline" size={36} color="#cbd5e1" />
                        <Text style={styles.emptyTitle}>暂无大纲目录</Text>
                        <Text style={styles.emptyDesc}>在正文中输入 # 标题 即可自动生成层级目录树</Text>
                      </View>
                    ) : (
                      tocList.map((item, idx) => {
                        const indent = Math.min((item.level - 1) * 16, 48);
                        return (
                          <TouchableOpacity
                            key={`${idx}-${item.text}`}
                            style={[styles.tocItemRow, { paddingLeft: 12 + indent }]}
                            onPress={() => {
                              onClose();
                              onSelectTocItem(item);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={[styles.tocDot, item.level === 1 && styles.tocDotH1]} />
                            <Text
                              style={[
                                styles.tocItemText,
                                item.level === 1 && styles.tocItemTextH1,
                                item.level === 2 && styles.tocItemTextH2,
                              ]}
                              numberOfLines={1}
                            >
                              {item.text}
                            </Text>
                            <Text style={styles.tocLevelBadge}>H{item.level}</Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                )}

                {/* 3. 关系雷达 Tab */}
                {activeTab === 'radar' && (
                  <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                  >
                    {/* 星系控制与状态栏 */}
                    <View style={styles.radarControlBar}>
                      <View style={styles.radarControlLeft}>
                        {radarFocusId !== noteId ? (
                          <TouchableOpacity
                            style={styles.resetFocusBtn}
                            onPress={handleResetFocus}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="arrow-undo-outline" size={12} color="#2563eb" style={{ marginRight: 4 }} />
                            <Text style={styles.resetFocusText} numberOfLines={1}>
                              返回原笔记
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.radarTitleGroup}>
                            <Ionicons name="git-network" size={15} color="#1890ff" style={{ marginRight: 5 }} />
                            <Text style={styles.radarBarTitle}>知识星系</Text>
                            <View style={styles.radarBadge}>
                              <Text style={styles.radarBadgeText}>{neighborNodes.length} 关联</Text>
                            </View>
                          </View>
                        )}
                      </View>

                      <View style={styles.radarControlRight}>
                        <Text style={styles.radarSwitchLabel}>2度网络</Text>
                        <Switch
                          value={isDepth2}
                          onValueChange={setIsDepth2}
                          trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                          thumbColor={isDepth2 ? '#2563eb' : '#f8fafc'}
                          style={{ transform: [{ scaleX: 0.72 }, { scaleY: 0.72 }] }}
                        />
                        <TouchableOpacity
                          style={styles.expandFullscreenBtn}
                          onPress={() => setIsFullScreenGalaxy(true)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="expand-outline" size={17} color="#475569" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* 动态星系图谱画布与内容 */}
                    {radarLoading ? (
                      <View style={styles.centerBox}>
                        <ActivityIndicator size="small" color="#1890ff" />
                        <Text style={styles.loadingText}>计算知识引力星系中...</Text>
                      </View>
                    ) : neighborNodes.length === 0 ? (
                      <View style={styles.emptyContainer}>
                        <Ionicons name="compass-outline" size={36} color="#cbd5e1" />
                        <Text style={styles.emptyTitle}>暂无直接关联节点</Text>
                        <Text style={styles.emptyDesc}>
                          使用 [[双链]] 链接其他笔记，即可点亮本篇笔记的星系雷达
                        </Text>
                      </View>
                    ) : (
                      <View>
                        {/* 硬件加速极坐标星系球 */}
                        <KnowledgeGalaxyView
                          nodes={radarNodes}
                          links={radarLinks}
                          focusNodeId={radarFocusId}
                          focusNodeTitle={radarFocusTitle}
                          mode="compact"
                          height={230}
                          isDepth2={isDepth2}
                          selectedNodeId={selectedNode?.id}
                          onSelectNode={setSelectedNode}
                          onSelectCenter={handleResetFocus}
                        />

                        {/* 选中的卫星节点窥探卡片 */}
                        {selectedNode && (
                          <GalaxyPeekCard
                            node={selectedNode}
                            focusNodeTitle={radarFocusTitle}
                            linkRelation={selectedNodeRelation}
                            onClose={() => setSelectedNode(null)}
                            onNavigate={(id, title) => {
                              onClose();
                              onOpenNote(id, title);
                            }}
                            onFocusAsCenter={handleFocusAsCenter}
                          />
                        )}

                        {/* 关联笔记卡片列表 */}
                        <View style={styles.radarListHeader}>
                          <Text style={styles.radarListTitle}>
                            {radarFocusId !== noteId ? `《${radarFocusTitle}》的关联` : '关联笔记列表'} ({neighborNodes.length})
                          </Text>
                        </View>

                        <View style={{ gap: 8 }}>
                          {neighborNodes.map((node) => {
                            const isSelected = selectedNode?.id === node.id;
                            return (
                              <TouchableOpacity
                                key={`radar-node-${node.id}`}
                                style={[styles.radarNodeCard, isSelected && styles.radarNodeCardActive]}
                                onPress={() => setSelectedNode(node)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.radarNodeLeft}>
                                  <View style={[styles.radarDot, { backgroundColor: node.notebookColor || '#1890ff' }]} />
                                  <Text style={[styles.radarNodeTitle, isSelected && styles.radarNodeTitleActive]} numberOfLines={1}>
                                    {node.title}
                                  </Text>
                                </View>
                                <View style={styles.radarNodeRight}>
                                  <Text style={styles.radarNodeNbText} numberOfLines={1}>
                                    {node.notebookName || '默认'}
                                  </Text>
                                  <Ionicons name="chevron-forward" size={14} color={isSelected ? '#1890ff' : '#94a3b8'} />
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </ScrollView>
                )}

                {/* 4. AI 伴侣 Tab */}
                {activeTab === 'ai' && (
                  <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                  >
                    <View style={styles.aiBanner}>
                      <Ionicons name="sparkles" size={16} color="#7c3aed" style={{ marginRight: 6 }} />
                      <Text style={styles.aiBannerText}>
                        结合全篇思考，由大模型为您深度提炼与推理
                      </Text>
                    </View>

                    <View style={styles.aiActionList}>
                      {AI_QUICK_ACTIONS.map(action => (
                        <TouchableOpacity
                          key={action.key}
                          style={styles.aiActionCard}
                          onPress={() => {
                            onClose();
                            onOpenAIAction(action.key);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={styles.aiActionIconWrap}>
                            <Ionicons name={action.icon as any} size={20} color="#7c3aed" />
                          </View>
                          <View style={styles.aiActionInfo}>
                            <Text style={styles.aiActionTitle}>{action.title}</Text>
                            <Text style={styles.aiActionDesc}>{action.desc}</Text>
                          </View>
                          <Ionicons name="arrow-forward" size={15} color="#94a3b8" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>

    {/* 全屏沉浸知识星系探索 Modal */}
    <Modal
      visible={isFullScreenGalaxy}
      animationType="fade"
      transparent={false}
      onRequestClose={() => setIsFullScreenGalaxy(false)}
    >
      <View style={styles.fullScreenGalaxyContainer}>
        {/* 顶部控制栏 */}
        <View style={styles.fullScreenHeader}>
          <TouchableOpacity
            style={styles.fullScreenBackBtn}
            onPress={() => setIsFullScreenGalaxy(false)}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color="#0f172a" />
            <Text style={styles.fullScreenBackText}>返回伴侣</Text>
          </TouchableOpacity>

          <View style={styles.fullScreenTitleWrap}>
            <Text style={styles.fullScreenTitle} numberOfLines={1}>
              《{radarFocusTitle}》知识全息星系
            </Text>
          </View>

          <View style={styles.fullScreenHeaderRight}>
            <Text style={styles.radarSwitchLabel}>2度网络</Text>
            <Switch
              value={isDepth2}
              onValueChange={setIsDepth2}
              trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
              thumbColor={isDepth2 ? '#2563eb' : '#f8fafc'}
              style={{ transform: [{ scaleX: 0.72 }, { scaleY: 0.72 }] }}
            />
          </View>
        </View>

        {/* 全屏星系大画布 */}
        <View style={styles.fullScreenCanvasWrap}>
          <KnowledgeGalaxyView
            nodes={radarNodes}
            links={radarLinks}
            focusNodeId={radarFocusId}
            focusNodeTitle={radarFocusTitle}
            mode="fullscreen"
            height={380}
            isDepth2={isDepth2}
            selectedNodeId={selectedNode?.id}
            onSelectNode={setSelectedNode}
            onSelectCenter={handleResetFocus}
          />
        </View>

        {/* 底部悬浮卡片或操作指引 */}
        <View style={styles.fullScreenFooterWrap}>
          {selectedNode ? (
            <GalaxyPeekCard
              node={selectedNode}
              focusNodeTitle={radarFocusTitle}
              linkRelation={selectedNodeRelation}
              onClose={() => setSelectedNode(null)}
              onNavigate={(id, title) => {
                setIsFullScreenGalaxy(false);
                onClose();
                onOpenNote(id, title);
              }}
              onFocusAsCenter={handleFocusAsCenter}
            />
          ) : (
            <View style={styles.fullScreenTipBox}>
              <Ionicons name="finger-print-outline" size={18} color="#94a3b8" />
              <Text style={styles.fullScreenTipText}>
                轻触周边卫星节点可查看引力双链，并可原地重新聚焦漫游
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  </>
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
    maxHeight: SCREEN_HEIGHT * 0.82,
    minHeight: SCREEN_HEIGHT * 0.52,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerSubTitle: {
    fontSize: 13,
    color: '#64748b',
    flex: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  tabsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginVertical: 8,
    padding: 2.5,
    backgroundColor: '#f1f5f9',
    borderRadius: 9,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6.5,
    paddingHorizontal: 1,
    borderRadius: 7,
    backgroundColor: 'transparent',
    gap: 2,
  },
  tabBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
    letterSpacing: -0.2,
  },
  tabTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  tabTextAiActive: {
    color: '#7c3aed',
    fontWeight: '700',
  },
  tabBadge: {
    paddingHorizontal: 3.5,
    paddingVertical: 0.5,
    borderRadius: 5,
    backgroundColor: '#e2e8f0',
    minWidth: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: {
    backgroundColor: '#eff6ff',
  },
  tabBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 12,
  },
  tabBadgeTextActive: {
    color: '#1890ff',
    fontWeight: '700',
  },
  bodyContainer: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleWrap: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionSubTitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  weaveAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1890ff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  weaveAllBtnDisabled: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  weaveAllBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  weaveAllBtnDisabledText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  backlinkCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  backlinkCardWeaved: {
    backgroundColor: '#fafbfc',
    borderColor: '#e2e8f0',
    opacity: 0.88,
  },
  mentionCard: {
    borderColor: '#fed7aa',
    backgroundColor: '#fffdfa',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardNoteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  notebookTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  notebookDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  notebookTagText: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardSnippet: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  previewLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  previewLinkText: {
    fontSize: 12,
    color: '#64748b',
  },
  weaveSingleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  weaveSingleBtnDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  weaveSingleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1890ff',
  },
  weaveSingleBtnDisabledText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  tocItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 12,
    borderRadius: 8,
    marginBottom: 2,
  },
  tocDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#94a3b8',
    marginRight: 8,
  },
  tocDotH1: {
    backgroundColor: '#1890ff',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tocItemText: {
    fontSize: 14,
    color: '#334155',
    flex: 1,
  },
  tocItemTextH1: {
    fontWeight: '700',
    color: '#0f172a',
  },
  tocItemTextH2: {
    fontWeight: '600',
    color: '#1e293b',
  },
  tocLevelBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  radarControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginBottom: 6,
  },
  radarControlLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  radarTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radarBarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginRight: 6,
  },
  radarBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bfdbfe',
  },
  radarBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1890ff',
  },
  resetFocusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  resetFocusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563eb',
    maxWidth: 130,
  },
  radarControlRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  radarSwitchLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  expandFullscreenBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    marginLeft: 2,
  },
  radarListHeader: {
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  radarListTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  radarNodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  radarNodeCardActive: {
    borderColor: '#1890ff',
    backgroundColor: '#f0f9ff',
  },
  radarNodeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  radarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  radarNodeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  radarNodeTitleActive: {
    color: '#1890ff',
  },
  radarNodeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  radarNodeNbText: {
    fontSize: 12,
    color: '#64748b',
    maxWidth: 90,
  },
  fullScreenGalaxyContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
  },
  fullScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  fullScreenBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  fullScreenBackText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginLeft: 2,
  },
  fullScreenTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  fullScreenTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  fullScreenHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fullScreenCanvasWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  fullScreenFooterWrap: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  fullScreenTipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fullScreenTipText: {
    fontSize: 12,
    color: '#64748b',
    flex: 1,
    lineHeight: 18,
  },
  aiBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f3ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ede9fe',
  },
  aiBannerText: {
    fontSize: 13,
    color: '#6d28d9',
    fontWeight: '500',
    flex: 1,
  },
  aiActionList: {
    gap: 10,
  },
  aiActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
  },
  aiActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  aiActionInfo: {
    flex: 1,
    marginRight: 8,
  },
  aiActionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  aiActionDesc: {
    fontSize: 12,
    color: '#64748b',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },
});
