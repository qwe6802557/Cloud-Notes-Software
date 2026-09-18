import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notesApi from '../../api/notesApi';
import { Config } from '../../constants/Config';

export default function NoteEditScreen() {
  const router = useRouter();
  const { id, notebookId: initialNotebookId, parentId: initialParentId } = useLocalSearchParams<{
    id?: string;
    notebookId?: string;
    parentId?: string;
  }>();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [notebookId, setNotebookId] = useState<string>(initialNotebookId || '');
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // 记录光标位置以便精准插入 Markdown 符号
  const [cursorPosition, setCursorPosition] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  const contentInputRef = useRef<TextInput>(null);

  // 加载既有笔记数据（若为编辑模式）
  useEffect(() => {
    const fetchNote = async () => {
      if (!id) {
        // 新建模式，如果本地有上次未保存的草稿则加载
        try {
          const draftKey = `${Config.storageKeys.draftsPrefix}new`;
          const savedDraft = await AsyncStorage.getItem(draftKey);
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft);
            if (parsed.title) setTitle(parsed.title);
            if (parsed.content) setContent(parsed.content);
          }
        } catch (e) {}
        setIsLoading(false);
        return;
      }

      try {
        const res = await notesApi.getNoteDetail(id);
        if (res.code === 200 && res.data) {
          setTitle(res.data.title || '');
          setContent(res.data.content || '');
          setNotebookId(res.data.notebookId);
        }
      } catch (e: any) {
        Alert.alert('加载错误', e.message || '获取笔记内容失败');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNote();
  }, [id]);

  // 自动保存草稿到本地存储
  useEffect(() => {
    if (!title && !content) return;
    const timer = setTimeout(async () => {
      try {
        const draftKey = `${Config.storageKeys.draftsPrefix}${id || 'new'}`;
        await AsyncStorage.setItem(
          draftKey,
          JSON.stringify({ title, content, notebookId, savedAt: Date.now() })
        );
      } catch (e) {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [title, content, notebookId, id]);

  // 插入 Markdown 辅助标记符号
  const insertText = (prefix: string, suffix = '') => {
    const { start, end } = cursorPosition;
    const before = content.substring(0, start);
    const selected = content.substring(start, end);
    const after = content.substring(end);

    const inserted = `${prefix}${selected}${suffix}`;
    const newContent = `${before}${inserted}${after}`;
    setContent(newContent);

    // 重新聚焦
    const newPos = start + prefix.length + selected.length;
    setCursorPosition({ start: newPos, end: newPos });
  };

  // 选择相册或拍照插入图片
  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要权限', '请在系统设置中允许访问相册以上传笔记配图');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setIsUploadingImage(true);

      const res = await notesApi.uploadNoteImage(asset);
      if (res.code === 200 && res.data && res.data.url) {
        // 在光标处插入 Markdown 图像引用
        const imgMarkdown = `\n![${asset.fileName || 'image'}](${res.data.url})\n`;
        insertText(imgMarkdown);
        Alert.alert('上传成功', '图片已插入至当前正文');
      } else {
        throw new Error(res.message || '上传失败');
      }
    } catch (e: any) {
      Alert.alert('图片上传错误', e.message || '网络连接异常');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // 保存笔记
  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('提示', '请输入笔记标题');
      return;
    }

    try {
      setIsSaving(true);
      if (id) {
        // 更新现有笔记
        const res = await notesApi.updateNote(id, { title: title.trim(), content });
        if (res.code === 200) {
          // 清理草稿
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${id}`);
          Alert.alert('成功', '笔记已保存');
          router.back();
        } else {
          throw new Error(res.message);
        }
      } else {
        // 新建笔记：若无 notebookId，先自动绑定首个笔记本
        let targetNbId = notebookId;
        if (!targetNbId) {
          const nbRes = await notesApi.getNotebooks();
          if (nbRes.code === 200 && nbRes.data.length > 0) {
            targetNbId = nbRes.data[0]._id;
          } else {
            throw new Error('请先在“笔记本”标签页创建一个笔记本');
          }
        }

        const res = await notesApi.createNote({
          title: title.trim(),
          content,
          notebookId: targetNbId,
          parentId: initialParentId || null,
        });

        if (res.code === 200) {
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}new`);
          Alert.alert('成功', '笔记已创建');
          router.back();
        } else {
          throw new Error(res.message);
        }
      }
    } catch (e: any) {
      Alert.alert('保存失败', e.message || '网络错误');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: id ? '编辑笔记' : '新建笔记',
          headerRight: () => (
            <TouchableOpacity
              style={[styles.saveHeaderBtn, isSaving && styles.saveHeaderBtnDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveHeaderBtnText}>保存</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        >
          <ScrollView
            style={styles.editorScroll}
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 标题输入 */}
            <TextInput
              style={styles.titleInput}
              placeholder="请输入标题..."
              placeholderTextColor="#94a3b8"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
            />

            {/* 正文输入 */}
            <TextInput
              ref={contentInputRef}
              style={styles.contentInput}
              placeholder="开始记录您的思考 (支持 Markdown 语法)..."
              placeholderTextColor="#94a3b8"
              value={content}
              onChangeText={setContent}
              multiline
              scrollEnabled={Platform.OS === 'web' ? true : false}
              textAlignVertical="top"
              onSelectionChange={e => setCursorPosition(e.nativeEvent.selection)}
            />
          </ScrollView>

          {/* 键盘上方快捷工具栏 */}
          <View style={styles.toolbar}>
            {/* 左侧固定功能：相册插图 */}
            <TouchableOpacity
              style={[styles.toolBtn, styles.imageToolBtn]}
              onPress={handlePickImage}
              disabled={isUploadingImage}
              activeOpacity={0.7}
            >
              {isUploadingImage ? (
                <ActivityIndicator size="small" color="#1890ff" />
              ) : (
                <Ionicons name="image-outline" size={20} color="#1890ff" />
              )}
            </TouchableOpacity>

            {/* 功能分区指示隔断 */}
            <View style={styles.toolbarDivider} />

            {/* 右侧横向滚动的快捷格式标记工具 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.toolbarScroll}
              contentContainerStyle={styles.toolbarContent}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('## ')}>
                <Text style={styles.toolText}>H2</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('### ')}>
                <Text style={styles.toolText}>H3</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('**', '**')}>
                <Ionicons name="text" size={18} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('- ')}>
                <Ionicons name="list" size={18} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('- [ ] ')}>
                <Ionicons name="checkbox-outline" size={18} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('> ')}>
                <Ionicons name="chatbox-ellipses-outline" size={18} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('`', '`')}>
                <Ionicons name="code-slash" size={18} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => insertText('```\n', '\n```')}>
                <Ionicons name="terminal-outline" size={18} color="#0f172a" />
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  keyboardContainer: {
    flex: 1,
  },
  saveHeaderBtn: {
    backgroundColor: '#1890ff',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveHeaderBtnDisabled: {
    opacity: 0.6,
  },
  saveHeaderBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  editorScroll: {
    flex: 1,
  },
  editorContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  contentInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 26,
    color: '#1e293b',
    minHeight: 480,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          fieldSizing: 'content',
        } as any)
      : {}),
  },
  toolbar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 8,
  },
  toolbarScroll: {
    flex: 1,
  },
  toolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 16,
  },
  toolBtn: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageToolBtn: {
    backgroundColor: '#e6f7ff',
    borderWidth: 1,
    borderColor: '#bae0ff',
  },
  toolText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
