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
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as notesApi from '../../api/notesApi';
import { Note } from '../../api/types';
import { useAuth } from '../../context/AuthContext';

interface TocItem {
  level: number;
  text: string;
}

function MarkdownImage({
  sourceUri,
  alt,
  style,
}: {
  sourceUri: string;
  alt?: string;
  style?: any;
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
    <View style={imageComponentStyles.container}>
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
    </View>
  );
}

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
  const [tocList, setTocList] = useState<TocItem[]>([]);

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
          />
        );
      },
    }),
    [serverUrl]
  );

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

              {/* 收藏按钮 */}
              <TouchableOpacity style={styles.headerActionBtn} onPress={handleToggleStar}>
                <Ionicons
                  name={note?.isStarred ? 'star' : 'star-outline'}
                  size={22}
                  color={note?.isStarred ? '#eab308' : '#0f172a'}
                />
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
          <Text style={styles.noteTitle}>{note.title || '无标题笔记'}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color="#94a3b8" />
            <Text style={styles.metaText}>更新于 {formatDate(note.updatedAt || note.createdAt)}</Text>
          </View>

          {/* 原生 Markdown 渲染主体 */}
          <View style={styles.markdownWrapper}>
            <Markdown style={markdownStyles} rules={markdownRules}>
              {note.content || '*该笔记暂无正文内容*'}
            </Markdown>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>笔记不存在或已被删除</Text>
        </View>
      )}

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
    </View>
  );
}

const markdownStyles = {
  body: {
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
});
