import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as notesApi from '../../api/notesApi';
import { Note } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import * as Clipboard from 'expo-clipboard';
import AIAssistantModal from '../../components/AIAssistantModal';
import VersionHistoryModal from '../../components/VersionHistoryModal';
import ImageViewerModal from '../../components/ImageViewerModal';

interface TocItem {
  level: number;
  text: string;
}

function MarkdownImage({
  sourceUri,
  alt,
  style,
  onPress,
}: {
  sourceUri: string;
  alt?: string;
  style?: any;
  onPress?: () => void;
}) {
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!sourceUri) return;
    Image.getSize(
      sourceUri,
      (width, height) => {
        if (width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      },
      () => {}
    );
  }, [sourceUri]);

  return (
    <TouchableOpacity
      style={imageComponentStyles.container}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <Image
        source={{ uri: sourceUri }}
        accessibilityLabel={alt}
        accessible={!!alt}
        resizeMode="contain"
        style={[
          imageComponentStyles.image,
          aspectRatio ? { aspectRatio } : { height: 220 },
          style,
        ]}
      />
    </TouchableOpacity>
  );
}

function CodeBlockItem({
  language,
  code,
  style,
}: {
  language?: string;
  code: string;
  style?: any;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[codeBlockStyles.container, style]}>
      <View style={codeBlockStyles.header}>
        <Text style={codeBlockStyles.langText}>
          {language ? language.toUpperCase() : 'CODE'}
        </Text>
        <TouchableOpacity
          style={codeBlockStyles.copyBtn}
          onPress={handleCopyCode}
          activeOpacity={0.7}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={13}
            color={copied ? '#10b981' : '#94a3b8'}
          />
          <Text style={[codeBlockStyles.copyText, copied && { color: '#10b981' }]}>
            {copied ? '已复制' : '复制代码'}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={codeBlockStyles.codeScroll}>
        <Text style={codeBlockStyles.codeText} selectable={true}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const codeBlockStyles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    marginVertical: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  langText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  copyText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  codeScroll: {
    padding: 12,
  },
  codeText: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
});

const imageComponentStyles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  image: {
    width: '100%',
    maxWidth: '100%',
    borderRadius: 8,
  },
});

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { serverUrl } = useAuth();

  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTocModal, setShowTocModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [tocList, setTocList] = useState<TocItem[]>([]);
  const [backlinksData, setBacklinksData] = useState<{ backlinks: any[]; unresolvedMentions: any[]; totalCount: number }>({
    backlinks: [],
    unresolvedMentions: [],
    totalCount: 0,
  });

  const processedContent = useMemo(() => {
    if (!note?.content) return '*该笔记暂无正文内容*';
    return note.content.replace(/\[\[([^[\]\r\n]+)\]\]/g, (match, p1) => {
      const raw = p1.trim();
      let title = raw;
      let alias = raw;
      if (raw.includes('|')) {
        const parts = raw.split('|');
        title = parts[0].trim();
        alias = parts.slice(1).join('|').trim() || title;
      }
      return `[${alias}](wikilink://${encodeURIComponent(title)})`;
    });
  }, [note?.content]);

  const handleWikiLinkPress = async (targetTitle: string) => {
    try {
      const res = await notesApi.suggestNoteLinks(targetTitle);
      const list = res?.data?.suggestions || [];
      const match = list.find((n: any) => n.title.trim().toLowerCase() === targetTitle.trim().toLowerCase());
      if (match) {
        router.push({
          pathname: '/note/[id]',
          params: { id: match._id },
        });
      } else {
        Alert.alert('双向链接', `笔记《${targetTitle}》尚未创建。`);
      }
    } catch {
      Alert.alert('提示', '无法获取关联笔记');
    }
  };

  // 提取正文所有图片，组成连续画廊数组
  const docImages = useMemo(() => {
    if (!note?.content) return [];
    const regex = /!\[.*?\]\((.*?)\)/g;
    const images: string[] = [];
    let match;
    while ((match = regex.exec(note.content)) !== null) {
      const rawTarget = match[1]?.trim();
      if (rawTarget) {
        const urlMatch = rawTarget.match(/^(?:<([^>]+)>|([^\s\)\"']+))/);
        let url = urlMatch ? (urlMatch[1] || urlMatch[2]) : rawTarget;
        if (url.startsWith('/') && serverUrl) {
          url = `${serverUrl.replace(/\/+$/, '')}${url}`;
        }
        images.push(url);
      }
    }
    return images;
  }, [note?.content, serverUrl]);

  const handleOpenImage = (imageUrl: string) => {
    const index = docImages.findIndex(img => img === imageUrl);
    setViewerInitialIndex(index >= 0 ? index : 0);
    setShowImageViewer(true);
  };

  const markdownRules = useMemo(
    () => ({
      image: (
        node: any,
        children: any,
        parent: any,
        styles: any,
        allowedImageHandlers: string[] = [
          'data:image/png;base64',
          'data:image/gif;base64',
          'data:image/jpeg;base64',
          'https://',
          'http://',
        ],
        defaultImageHandler: string | null = null
      ) => {
        const { src, alt } = node.attributes;
        if (!src) return null;

        const show = (allowedImageHandlers || []).some((prefix: string) =>
          src.toLowerCase().startsWith(prefix.toLowerCase())
        );
        let resolvedUri = show ? src : defaultImageHandler ? `${defaultImageHandler}${src}` : src;
        if (resolvedUri.startsWith('/') && serverUrl) {
          resolvedUri = `${serverUrl.replace(/\/+$/, '')}${resolvedUri}`;
        }

        return (
          <MarkdownImage
            key={node.key}
            sourceUri={resolvedUri}
            alt={alt}
            style={styles._VIEW_SAFE_image || styles.image}
            onPress={() => handleOpenImage(resolvedUri)}
          />
        );
      },
      paragraph: (node: any, children: any, parent: any, styles: any) => {
        const hasBlockChild = node.children?.some(
          (c: any) => c.type === 'image' || c.type === 'fence' || c.type === 'code_block'
        );
        if (hasBlockChild) {
          return (
            <View key={node.key} style={styles._VIEW_SAFE_paragraph}>
              {children}
            </View>
          );
        }
        return (
          <Text key={node.key} style={styles.paragraph} selectable={true}>
            {children}
          </Text>
        );
      },
      text: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => (
        <Text key={node.key} style={[inheritedStyles, styles.text]} selectable={true}>
          {node.content}
        </Text>
      ),
      textgroup: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.textgroup} selectable={true}>
          {children}
        </Text>
      ),
      heading1: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading1} selectable={true}>
          {children}
        </Text>
      ),
      heading2: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading2} selectable={true}>
          {children}
        </Text>
      ),
      heading3: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading3} selectable={true}>
          {children}
        </Text>
      ),
      heading4: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading4} selectable={true}>
          {children}
        </Text>
      ),
      heading5: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading5} selectable={true}>
          {children}
        </Text>
      ),
      heading6: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.heading6} selectable={true}>
          {children}
        </Text>
      ),
      strong: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.strong} selectable={true}>
          {children}
        </Text>
      ),
      em: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.em} selectable={true}>
          {children}
        </Text>
      ),
      s: (node: any, children: any, parent: any, styles: any) => (
        <Text key={node.key} style={styles.s} selectable={true}>
          {children}
        </Text>
      ),
      code_inline: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => (
        <Text key={node.key} style={[inheritedStyles, styles.code_inline]} selectable={true}>
          {node.content}
        </Text>
      ),
      fence: (node: any, children: any, parent: any, styles: any) => {
        let content = node.content;
        if (typeof content === 'string' && content.endsWith('\n')) {
          content = content.slice(0, -1);
        }
        return (
          <CodeBlockItem
            key={node.key}
            language={node.sourceInfo}
            code={content}
          />
        );
      },
      code_block: (node: any, children: any, parent: any, styles: any) => {
        let content = node.content;
        if (typeof content === 'string' && content.endsWith('\n')) {
          content = content.slice(0, -1);
        }
        return (
          <CodeBlockItem
            key={node.key}
            language=""
            code={content}
          />
        );
      },
      link: (node: any, children: any, parent: any, styles: any) => {
        const href = node.attributes?.href || '';
        if (href.startsWith('wikilink://')) {
          const targetTitle = decodeURIComponent(href.replace('wikilink://', ''));
          return (
            <TouchableOpacity
              key={node.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#eff6ff',
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 4,
                marginHorizontal: 2,
                borderWidth: 1,
                borderColor: '#bfdbfe',
              }}
              onPress={() => handleWikiLinkPress(targetTitle)}
              activeOpacity={0.7}
            >
              <Ionicons name="link" size={11} color="#2563eb" style={{ marginRight: 2 }} />
              <Text style={{ color: '#1d4ed8', fontWeight: '500', fontSize: 13 }}>
                {children}
              </Text>
            </TouchableOpacity>
          );
        }
        return (
          <Text
            key={node.key}
            style={styles.link}
            onPress={() => {
              if (href) Linking.openURL(href).catch(() => {});
            }}
          >
            {children}
          </Text>
        );
      },
    }),
    [serverUrl, docImages]
  );

  const fetchBacklinks = async () => {
    if (!id) return;
    try {
      const res = await notesApi.getNoteBacklinks(id);
      if (res?.data) {
        setBacklinksData(res.data);
      }
    } catch {
      // 忽略
    }
  };

  const fetchNote = async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const res = await notesApi.getNoteDetail(id);
      if (res.code === 200 && res.data) {
        setNote(res.data);
        parseToc(res.data.content);
      }
    } catch (e: any) {
      Alert.alert('加载失败', e.message || '无法获取笔记内容');
    } finally {
      setIsLoading(false);
    }
  };

  const parseToc = (content: string) => {
    if (!content) return;
    const lines = content.split('\n');
    const items: TocItem[] = [];
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        items.push({
          level: match[1].length,
          text: match[2].trim(),
        });
      }
    });
    setTocList(items);
  };

  useEffect(() => {
    fetchNote();
    fetchBacklinks();
  }, [id]);

  const handleDeleteNote = () => {
    const executeDelete = async () => {
      try {
        if (!id) return;
        await notesApi.deleteNote(id);
        if (Platform.OS === 'web') {
          window.alert('笔记已成功删除');
        } else {
          Alert.alert('已删除', '笔记已成功删除');
        }
        router.back();
      } catch (e: any) {
        if (Platform.OS === 'web') {
          window.alert('删除失败: ' + e.message);
        } else {
          Alert.alert('删除失败', e.message);
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('确定要将这篇笔记移入回收站吗？')) {
        executeDelete();
      }
      return;
    }

    Alert.alert('删除确认', '确定要将这篇笔记移入回收站吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: executeDelete,
      },
    ]);
  };

  const handleToggleStar = async () => {
    if (!note) return;
    const nextStatus = !note.isStarred;
    setNote({ ...note, isStarred: nextStatus });
    try {
      await notesApi.updateNoteStarred(note._id, nextStatus);
    } catch (e) {
      setNote({ ...note, isStarred: !nextStatus });
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: note?.title ? note.title : '笔记详情',
          headerRight: () => (
            <View style={styles.headerRightActions}>
              {/* 大纲按钮 */}
              {tocList.length > 0 && (
                <TouchableOpacity
                  style={styles.headerActionBtn}
                  onPress={() => setShowTocModal(true)}
                >
                  <Ionicons name="list-outline" size={22} color="#0f172a" />
                </TouchableOpacity>
              )}

              {/* 历史版本快照 */}
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => setShowHistoryModal(true)}
              >
                <Ionicons name="time-outline" size={22} color="#0f172a" />
              </TouchableOpacity>

              {/* 收藏按钮 */}
              <TouchableOpacity style={styles.headerActionBtn} onPress={handleToggleStar}>
                <Ionicons
                  name={note?.isStarred ? 'star' : 'star-outline'}
                  size={22}
                  color={note?.isStarred ? '#eab308' : '#0f172a'}
                />
              </TouchableOpacity>

              {/* AI 创作分析 */}
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => setShowAIModal(true)}
              >
                <Ionicons name="sparkles" size={20} color="#7c3aed" />
              </TouchableOpacity>

              {/* 编辑按钮 */}
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() =>
                  router.push({
                    pathname: '/note/edit',
                    params: { id: note?._id },
                  })
                }
              >
                <Ionicons name="create-outline" size={22} color="#1890ff" />
              </TouchableOpacity>

              {/* 删除按钮 */}
              <TouchableOpacity style={styles.headerActionBtn} onPress={handleDeleteNote}>
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : note ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* 笔记标题与元信息 */}
          <Text style={styles.noteTitle} selectable={true}>
            {note.title || '无标题笔记'}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color="#94a3b8" />
            <Text style={styles.metaText}>更新于 {formatDate(note.updatedAt || note.createdAt)}</Text>
          </View>

          {/* 原生 Markdown 渲染主体 */}
          <View style={styles.markdownWrapper}>
            <Markdown style={markdownStyles} rules={markdownRules}>
              {processedContent}
            </Markdown>
          </View>

          {/* 反向链接面板 (Backlinks) */}
          {backlinksData.totalCount > 0 && (
            <View style={styles.backlinksContainer}>
              <View style={styles.backlinksHeader}>
                <Ionicons name="git-network-outline" size={16} color="#2563eb" />
                <Text style={styles.backlinksTitle}>反向链接 (Backlinks)</Text>
                <View style={styles.backlinksBadge}>
                  <Text style={styles.backlinksBadgeText}>{backlinksData.totalCount}</Text>
                </View>
              </View>

              {backlinksData.backlinks.map((item: any) => (
                <TouchableOpacity
                  key={item._id}
                  style={styles.backlinkCard}
                  onPress={() => router.push({ pathname: '/note/[id]', params: { id: item._id } })}
                  activeOpacity={0.7}
                >
                  <View style={styles.backlinkTopRow}>
                    <Ionicons name="document-text-outline" size={14} color="#3b82f6" />
                    <Text style={styles.backlinkNoteTitle} numberOfLines={1}>{item.title}</Text>
                    {item.notebookId?.name && (
                      <View style={styles.backlinkNotebookTag}>
                        <Text style={styles.backlinkNotebookText}>{item.notebookId.name}</Text>
                      </View>
                    )}
                  </View>
                  {item.contextSnippet && (
                    <Text style={styles.backlinkSnippet} numberOfLines={2}>
                      “{item.contextSnippet.replace(/==/g, '')}”
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>笔记不存在或已被删除</Text>
        </View>
      )}

      {/* 全屏手势图片查看器与画廊 */}
      <ImageViewerModal
        visible={showImageViewer}
        images={docImages}
        initialIndex={viewerInitialIndex}
        onClose={() => setShowImageViewer(false)}
      />

      {/* 目录大纲弹窗 */}
      <Modal visible={showTocModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>文章大纲目录</Text>
              <TouchableOpacity onPress={() => setShowTocModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.tocScroll}>
              {tocList.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.tocItem,
                    { paddingLeft: 12 + (item.level - 1) * 16 },
                  ]}
                  onPress={() => setShowTocModal(false)}
                >
                  <Text style={styles.tocBullet}>•</Text>
                  <Text style={[styles.tocText, item.level === 1 && styles.tocH1]}>
                    {item.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* AI 创作助手 */}
      <AIAssistantModal
        visible={showAIModal}
        onClose={() => setShowAIModal(false)}
        noteTitle={note?.title || ''}
        noteContent={note?.content || ''}
        isEditable={false}
      />

      {/* 历史版本快照与 Diff 对比 */}
      {note && (
        <VersionHistoryModal
          visible={showHistoryModal}
          onClose={() => setShowHistoryModal(false)}
          noteId={note._id}
          currentContent={note.content || ''}
          onRollbackSuccess={updatedNote => {
            setNote(updatedNote);
          }}
        />
      )}
    </View>
  );
}

const markdownStyles = {
  body: {
    fontSize: 16,
    lineHeight: 28,
    color: '#1e293b',
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 16,
    lineHeight: 28,
    color: '#1e293b',
  },
  heading1: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    color: '#0f172a',
    marginTop: 24,
    marginBottom: 12,
  },
  heading2: {
    fontSize: 20,
    fontWeight: 'bold' as const,
    color: '#0f172a',
    marginTop: 20,
    marginBottom: 10,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: '#1e293b',
    marginTop: 16,
    marginBottom: 8,
  },
  code_inline: {
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  code_block: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginVertical: 12,
  },
  fence: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginVertical: 12,
  },
  blockquote: {
    backgroundColor: '#f8fafc',
    borderLeftColor: '#1890ff',
    borderLeftWidth: 4,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 10,
    color: '#475569',
  },
  link: {
    color: '#1890ff',
    textDecorationLine: 'underline' as const,
  },
  image: {
    borderRadius: 8,
    marginVertical: 12,
    width: Dimensions.get('window').width - 48,
    height: 220,
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerActionBtn: {
    padding: 4,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  noteTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    lineHeight: 32,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  markdownWrapper: {
    marginTop: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#94a3b8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  tocScroll: {
    padding: 16,
  },
  tocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  tocBullet: {
    color: '#1890ff',
    marginRight: 8,
    fontSize: 16,
  },
  tocText: {
    fontSize: 14,
    color: '#334155',
    flex: 1,
  },
  tocH1: {
    fontWeight: '600',
    color: '#0f172a',
  },
  backlinksContainer: {
    marginTop: 24,
    marginBottom: 40,
    padding: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  backlinksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  backlinksTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  backlinksBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  backlinksBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563eb',
  },
  backlinkCard: {
    padding: 12,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  backlinkTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backlinkNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  backlinkNotebookTag: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  backlinkNotebookText: {
    fontSize: 10,
    color: '#64748b',
  },
  backlinkSnippet: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 4,
  },
});
