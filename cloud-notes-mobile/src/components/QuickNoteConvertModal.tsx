import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as notesApi from '../api/notesApi';
import * as quickNotesApi from '../api/quickNotesApi';
import { QuickMemoItem } from '../api/quickNotesApi';
import { Note, Notebook } from '../api/types';
import { Config } from '../constants/Config';
import { useTheme } from '../hooks/use-theme';
import { useColorScheme } from '../hooks/use-color-scheme';
import { markNotesDataDirty } from '../utils/notebookNavigationHelper';
import { buildDefaultNoteTitle } from '../utils/quickNoteHelper';

export interface QuickNoteConvertModalProps {
  visible: boolean;
  item: QuickMemoItem | null;
  onClose: () => void;
  onConverted: (memo: QuickMemoItem, note: Note) => void;
}

function ConvertModalBody({
  item,
  onClose,
  onConverted,
}: {
  item: QuickMemoItem;
  onClose: () => void;
  onConverted: (memo: QuickMemoItem, note: Note) => void;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const accentColor = isDark ? '#38bdf8' : '#1890ff';

  const [title, setTitle] = useState(() => buildDefaultNoteTitle(item));
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('');
  const [loadingNotebooks, setLoadingNotebooks] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([
      notesApi.getNotebooks().catch(() => null),
      AsyncStorage.getItem(Config.storageKeys.activeNotebookId).catch(() => null),
    ])
      .then(([nbRes, activeNbId]) => {
        if (!active) return;
        const list = nbRes?.code === 200 && Array.isArray(nbRes.data) ? nbRes.data : [];
        const sorted = [...list].sort((a, b) => {
          const aDef = (a.title || a.name) === '默认笔记本';
          const bDef = (b.title || b.name) === '默认笔记本';
          if (aDef && !bDef) return -1;
          if (!aDef && bDef) return 1;
          return 0;
        });
        setNotebooks(sorted);

        const plainNotebooks = sorted.filter(n => !n.isEncrypted);
        if (activeNbId && plainNotebooks.some(n => n._id === activeNbId)) {
          setSelectedNotebookId(activeNbId);
        } else if (plainNotebooks.length > 0) {
          setSelectedNotebookId(plainNotebooks[0]._id);
        } else {
          setSelectedNotebookId('');
        }
      })
      .finally(() => {
        if (active) setLoadingNotebooks(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const plainCount = notebooks.filter(nb => !nb.isEncrypted).length;
  const canConfirm = !submitting && !loadingNotebooks && Boolean(selectedNotebookId) && plainCount > 0;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const itemId = item._id || item.id;
    const cleanTitle = title.trim() || buildDefaultNoteTitle(item);

    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await quickNotesApi.convertQuickMemoToNote(itemId, {
        notebookId: selectedNotebookId || undefined,
        title: cleanTitle,
      });
      if ((res.code === 200 || res.code === 201) && res.data?.note) {
        markNotesDataDirty();
        onConverted(res.data.memo || { ...item, convertedNoteId: res.data.note._id }, res.data.note);
        onClose();
      } else {
        throw new Error(res.message || '转存失败');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || '转存为笔记失败，请检查网络');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.backdrop}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <View style={[styles.dialog, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <Ionicons name="document-text-outline" size={19} color={accentColor} />
            <Text style={[styles.title, { color: theme.text }]}>转存为正式笔记</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={submitting}>
            <Ionicons name="close" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          原随心记将保留并标记为已转存，附件会自动持久归档至笔记目录。
        </Text>

        <Text style={[styles.label, { color: theme.text }]}>笔记标题</Text>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="请输入笔记标题"
          placeholderTextColor={theme.textSecondary}
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={() => void handleConfirm()}
        />

        <Text style={[styles.label, { color: theme.text }]}>目标笔记本</Text>
        {loadingNotebooks ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={accentColor} />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>正在读取笔记本...</Text>
          </View>
        ) : plainCount === 0 ? (
          <Text style={styles.errorText}>
            暂无可用的普通笔记本（加密笔记本不支持直接转存）
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.nbScroll}
          >
            {notebooks.map(nb => {
              const isEnc = Boolean(nb.isEncrypted);
              const selected = !isEnc && nb._id === selectedNotebookId;
              return (
                <TouchableOpacity
                  key={nb._id}
                  disabled={isEnc}
                  style={[
                    styles.nbChip,
                    {
                      backgroundColor: selected
                        ? isDark
                          ? 'rgba(56, 189, 248, 0.16)'
                          : '#eff6ff'
                        : theme.backgroundElement,
                      borderColor: selected ? accentColor : theme.border,
                    },
                    isEnc && styles.disabledBtn,
                  ]}
                  onPress={() => setSelectedNotebookId(nb._id)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={isEnc ? 'lock-closed-outline' : selected ? 'folder' : 'folder-outline'}
                    size={15}
                    color={isEnc ? theme.textSecondary : selected ? accentColor : theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.nbChipText,
                      { color: isEnc ? theme.textSecondary : selected ? accentColor : theme.text },
                    ]}
                    numberOfLines={1}
                  >
                    {nb.title || nb.name}
                    {isEnc ? ' (加密)' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {Boolean(errorMsg) && <Text style={styles.errorText}>{errorMsg}</Text>}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.backgroundElement }]}
            onPress={onClose}
            disabled={submitting}
            activeOpacity={0.75}
          >
            <Text style={[styles.cancelText, { color: theme.textSecondary }]}>取消</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.confirmBtn, !canConfirm && styles.disabledBtn]}
            onPress={() => void handleConfirm()}
            disabled={!canConfirm}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.confirmText}>确认转存</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function QuickNoteConvertModal({
  visible,
  item,
  onClose,
  onConverted,
}: QuickNoteConvertModalProps) {
  return (
    <Modal
      visible={visible && Boolean(item)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {visible && item ? (
        <ConvertModalBody
          key={item._id || item.id}
          item={item}
          onClose={onClose}
          onConverted={onConverted}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    width: 44,
    height: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  input: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  loadingText: {
    fontSize: 13,
  },
  nbScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  nbChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 180,
  },
  nbChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: {
    backgroundColor: '#1890ff',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
