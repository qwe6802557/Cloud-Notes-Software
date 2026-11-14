import { Alert, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as notesApi from '../api/notesApi';
import * as cryptoVault from './cryptoVault';
import { mobileSyncManager } from './storage/mobileSyncManager';
import { deleteNoteCache } from './storage/mobileNotesDB';
import { markNotesDataDirty } from './notebookNavigationHelper';
import {
  ActionSheetItem,
  confirmAction,
} from '../components/ActionContextSheet';

export function showNotice(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.alert(`${title}: ${message}`);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * 复制笔记 Wiki 双链语法 [[标题]]
 */
export async function copyNoteWikiLink(title?: string): Promise<void> {
  const cleanTitle = (title || '无标题笔记').trim() || '无标题笔记';
  await Clipboard.setStringAsync(`[[${cleanTitle}]]`);
  showNotice('已复制', `已复制双链 [[${cleanTitle}]]`);
}

/**
 * 切换笔记或文件夹私密加密保护状态（加解密均需解锁安全箱口令）
 */
export async function toggleItemEncryption(
  item: any,
  callbacks: {
    onRequireVaultUnlock: () => void;
    onSuccess: () => void;
  }
): Promise<void> {
  const isEncrypted = Boolean(item.isEncrypted);
  const nextStatus = !isEncrypted;
  const noteId = item._id || item.id;
  const isFolder = item.type === 'folder';

  if ((nextStatus || !isFolder) && !cryptoVault.hasSessionKey()) {
    callbacks.onRequireVaultUnlock();
    return;
  }

  try {
    if (isFolder) {
      const res = await notesApi.updateNote(noteId, { isEncrypted: nextStatus });
      if (res.code === 200) {
        markNotesDataDirty();
        showNotice('提示', nextStatus ? '文件夹已设为私密' : '文件夹已解除私密');
        callbacks.onSuccess();
      } else {
        throw new Error(res.message);
      }
      return;
    }

    const detailRes = await notesApi.getNoteDetail(noteId);
    const pin = cryptoVault.getSessionKey()!;

    if (nextStatus) {
      const rawContent = detailRes?.data?.content || item.content || '';
      const salt = cryptoVault.getSessionSalt() || '00'.repeat(16);
      const encryptedData = await cryptoVault.encryptNote(rawContent, pin, salt);
      const res = await notesApi.updateNote(noteId, {
        isEncrypted: true,
        encryptedData,
        content: '',
      });
      if (res.code === 200) {
        markNotesDataDirty();
        showNotice('提示', '笔记已加密设为私密');
        callbacks.onSuccess();
      } else {
        throw new Error(res.message);
      }
    } else {
      let plainContent = detailRes?.data?.content || '';
      if (detailRes?.data?.encryptedData) {
        plainContent = await cryptoVault.decryptNote(detailRes.data.encryptedData, pin);
      }
      const res = await notesApi.updateNote(noteId, {
        isEncrypted: false,
        encryptedData: null,
        content: plainContent,
      });
      if (res.code === 200) {
        markNotesDataDirty();
        showNotice('提示', '笔记已解除私密保护');
        callbacks.onSuccess();
      } else {
        throw new Error(res.message);
      }
    }
  } catch (err: any) {
    showNotice('操作失败', err?.message || '网络异常');
  }
}

/**
 * 构建笔记 / 文件夹长按上下文动作清单（对齐 PC 端 P5 右键菜单能力）
 */
export function buildNoteFolderActionItems(
  item: any,
  handlers: {
    onToggleStar: (target: any) => void;
    onCopyWikiLink: (target: any) => void;
    onNewNoteInFolder: (folder: any) => void;
    onNewSubfolder: (folder: any) => void;
    onRename: (target: any) => void;
    onMove: (target: any) => void;
    onToggleEncryption: (target: any) => void;
    onDelete: (target: any) => void;
  }
): ActionSheetItem[] {
  const isFolder = item?.type === 'folder';
  const labelTitle = item?.title || (isFolder ? '未命名文件夹' : '无标题笔记');

  const topItems: ActionSheetItem[] = isFolder
    ? [
        {
          key: 'new-note',
          label: '在此新建笔记',
          icon: 'document-text-outline',
          onPress: () => handlers.onNewNoteInFolder(item),
        },
        {
          key: 'new-subfolder',
          label: '新建子文件夹',
          icon: 'folder-outline',
          onPress: () => handlers.onNewSubfolder(item),
        },
      ]
    : [
        {
          key: 'star',
          label: item?.isStarred ? '取消收藏' : '收藏笔记',
          icon: item?.isStarred ? 'star' : 'star-outline',
          color: item?.isStarred ? '#eab308' : undefined,
          onPress: () => handlers.onToggleStar(item),
        },
        {
          key: 'wikilink',
          label: '复制双链 [[...]]',
          icon: 'link-outline',
          onPress: () => handlers.onCopyWikiLink(item),
        },
      ];

  return [
    ...topItems,
    {
      key: 'rename',
      label: '重命名',
      icon: 'create-outline',
      onPress: () => handlers.onRename(item),
    },
    {
      key: 'move',
      label: '移动到...',
      icon: 'folder-open-outline',
      onPress: () => handlers.onMove(item),
    },
    {
      key: 'encrypt',
      label: item?.isEncrypted ? '解除私密保护' : '设为私密保护',
      icon: item?.isEncrypted ? 'lock-open-outline' : 'lock-closed-outline',
      onPress: () => handlers.onToggleEncryption(item),
    },
    {
      key: 'delete',
      label: isFolder ? '删除文件夹' : '删除笔记',
      icon: 'trash-outline',
      danger: true,
      dividerBefore: true,
      onPress: () => {
        confirmAction(
          '确认删除',
          `确定要删除“${labelTitle}”吗？`,
          () => handlers.onDelete(item)
        );
      },
    },
  ];
}

/**
 * 执行删除并在断网时降级为离线删除队列
 */
export async function deleteNoteOrFolder(item: any, onDone: () => void): Promise<void> {
  const noteId = item._id || item.id;
  if (!noteId) return;

  try {
    if (String(noteId).startsWith('local_')) {
      await mobileSyncManager.queueOfflineAction(noteId, 'delete');
      await deleteNoteCache(noteId);
      markNotesDataDirty();
      onDone();
      return;
    }

    await notesApi.deleteNote(noteId);
    await deleteNoteCache(noteId);
    markNotesDataDirty();
    onDone();
  } catch (err: any) {
    if (!err?.status) {
      await mobileSyncManager.queueOfflineAction(noteId, 'delete');
      await deleteNoteCache(noteId);
      markNotesDataDirty();
      showNotice('已加入离线队列', '当前离线，删除操作将在联网后自动同步');
      onDone();
      return;
    }
    showNotice('删除失败', err?.message || '网络异常');
  }
}
