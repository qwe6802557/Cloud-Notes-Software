import React, { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { QuickMemoItem, resolveQuickMemoUrl } from '../api/quickNotesApi';
import { useTheme } from '../hooks/use-theme';
import { useColorScheme } from '../hooks/use-color-scheme';
import {
  computeRemainingSeconds,
  extractSafeLinks,
  formatBytes,
  formatCountdown,
} from '../utils/quickNoteHelper';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * 独立倒计时徽标：仅在页面聚焦且 App 处于前台时每 1 秒计算剩余时间
 */
export function CountdownBadge({
  expireAt,
  fallbackSeconds,
  serverOffsetMs = 0,
  isTimerActive,
}: {
  expireAt: string | null;
  fallbackSeconds?: number | null;
  serverOffsetMs?: number;
  isTimerActive: boolean;
}) {
  const isDark = useColorScheme() === 'dark';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isTimerActive || !expireAt) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isTimerActive, expireAt]);

  const remaining = expireAt
    ? computeRemainingSeconds(expireAt, serverOffsetMs, nowMs)
    : (fallbackSeconds ?? null);

  const isUrgent = remaining !== null && remaining <= 60;
  const bgColor = isUrgent
    ? isDark
      ? 'rgba(239, 68, 68, 0.2)'
      : '#fee2e2'
    : isDark
    ? 'rgba(217, 119, 6, 0.2)'
    : '#fef3c7';
  const fgColor = isUrgent ? (isDark ? '#f87171' : '#dc2626') : '#d97706';

  return (
    <View style={[styles.statusBadge, { backgroundColor: bgColor }]}>
      <View style={[styles.statusDot, { backgroundColor: fgColor }]} />
      <Text style={[styles.statusBadgeText, { color: fgColor }]}>
        {remaining !== null ? formatCountdown(remaining) : '临时'}
      </Text>
    </View>
  );
}

function getFileIconSpec(filename = '', mimetype = '') {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimetype.startsWith('image/')) {
    return { name: 'image-outline' as const, color: '#1890ff' };
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md'].includes(ext) || mimetype.includes('pdf')) {
    return { name: 'document-text-outline' as const, color: '#d97706' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { name: 'archive-outline' as const, color: '#059669' };
  }
  if (['mp4', 'mov', 'avi', 'mp3', 'wav'].includes(ext) || mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
    return { name: 'film-outline' as const, color: '#ef4444' };
  }
  if (['js', 'ts', 'tsx', 'py', 'json', 'html', 'css'].includes(ext)) {
    return { name: 'code-slash-outline' as const, color: '#059669' };
  }
  return { name: 'document-outline' as const, color: '#64748b' };
}

function formatMemoTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export interface QuickMemoCardProps {
  item: QuickMemoItem;
  serverOffsetMs: number;
  isTimerActive: boolean;
  onPressItem: (item: QuickMemoItem) => void;
  onLongPressItem: (item: QuickMemoItem) => void;
  onCopyQuick: (item: QuickMemoItem) => void;
  onOpenConvertedNote: (noteId: string) => void;
}

export default function QuickMemoCard({
  item,
  serverOffsetMs,
  isTimerActive,
  onPressItem,
  onLongPressItem,
  onCopyQuick,
  onOpenConvertedNote,
}: QuickMemoCardProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const accentColor = isDark ? '#38bdf8' : '#1890ff';
  const accentSoftBg = isDark ? 'rgba(56, 189, 248, 0.14)' : '#eff6ff';

  const isTemp = item.storageType === 'temp';
  const att = item.attachment;
  const resolvedAttachmentUrl = att ? resolveQuickMemoUrl(att.url) : '';
  const links = item.links?.length ? item.links : extractSafeLinks(item.content);
  const primaryLink = links[0] || null;
  const fileIcon = att ? getFileIconSpec(att.originalName, att.mimetype) : null;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
          shadowColor: isDark ? 'transparent' : '#0f172a',
        },
      ]}
      onPress={() => onPressItem(item)}
      onLongPress={() => onLongPressItem(item)}
      delayLongPress={400}
      activeOpacity={0.72}
    >
      {/* 1. 纯文本随手记 */}
      {item.kind === 'text' && (
        <View style={styles.textBlock}>
          <Text style={[styles.bodyText, { color: theme.text }]} numberOfLines={6} selectable>
            {item.content}
          </Text>
          {links.length > 0 && (
            <View style={[styles.inlineLinkPill, { backgroundColor: accentSoftBg }]}>
              <Ionicons name="link-outline" size={13} color={accentColor} />
              <Text style={[styles.inlineLinkText, { color: accentColor }]} numberOfLines={1}>
                {links[0].host || links[0].url}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 2. 安全外链卡片 */}
      {item.kind === 'link' && (
        <View style={styles.rowLayout}>
          <View style={[styles.iconSlot, { backgroundColor: accentSoftBg }]}>
            <Ionicons name="link-outline" size={21} color={accentColor} />
          </View>
          <View style={styles.metaCol}>
            <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={2}>
              {primaryLink?.host || '网页链接'}
            </Text>
            <Text style={[styles.linkUrl, { color: accentColor }]} numberOfLines={2}>
              {primaryLink?.url || item.content}
            </Text>
            {Boolean(item.content && primaryLink && item.content.trim() !== primaryLink.url) && (
              <Text style={[styles.captionText, { color: theme.textSecondary }]} numberOfLines={2}>
                {item.content}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.quickIconBtn, { backgroundColor: theme.backgroundElement }]}
            onPress={() => onCopyQuick(item)}
            hitSlop={6}
            activeOpacity={0.7}
          >
            <Ionicons name="copy-outline" size={17} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* 3. 图片卡片 */}
      {item.kind === 'image' && att && (
        <View style={styles.imageBlock}>
          <Image
            source={{ uri: resolvedAttachmentUrl }}
            style={[styles.imageThumb, { backgroundColor: theme.backgroundElement }]}
            contentFit="cover"
            transition={150}
          />
          <View style={styles.imageMetaRow}>
            <Text style={[styles.imageName, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
              {att.originalName}
            </Text>
            <Text style={[styles.monoSize, { color: theme.textSecondary }]}>
              {formatBytes(att.size)}
            </Text>
          </View>
        </View>
      )}

      {/* 4. 文件卡片 */}
      {item.kind === 'file' && att && fileIcon && (
        <View style={styles.rowLayout}>
          <View style={[styles.iconSlot, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name={fileIcon.name} size={22} color={fileIcon.color} />
          </View>
          <View style={styles.metaCol}>
            <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
              {att.originalName}
            </Text>
            <View style={styles.fileSubRow}>
              <Text style={[styles.monoSize, { color: theme.textSecondary }]}>
                {formatBytes(att.size)}
              </Text>
              {Boolean(att.folderName) && (
                <Text style={[styles.folderTag, { color: theme.textSecondary }]} numberOfLines={1}>
                  {att.folderName}
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={[styles.quickIconBtn, { backgroundColor: theme.backgroundElement }]}
            onPress={() => onCopyQuick(item)}
            hitSlop={6}
            activeOpacity={0.7}
          >
            <Ionicons name="copy-outline" size={17} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* 底部精简元数据条 */}
      <View style={[styles.footerRow, { borderTopColor: theme.border }]}>
        <Text style={[styles.timeText, { color: theme.textSecondary }]}>
          {formatMemoTime(item.createdAt)}
        </Text>

        <View style={styles.footerBadges}>
          {Boolean(item.convertedNoteId) && (
            <TouchableOpacity
              style={[
                styles.convertedBadge,
                { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.2)' : '#ecfdf5' },
              ]}
              onPress={() => onOpenConvertedNote(item.convertedNoteId!)}
              hitSlop={8}
              activeOpacity={0.75}
            >
              <Ionicons name="checkmark-circle-outline" size={12} color="#059669" />
              <Text style={styles.convertedText}>已转存</Text>
            </TouchableOpacity>
          )}

          {isTemp ? (
            <CountdownBadge
              expireAt={item.expireAt}
              fallbackSeconds={item.remainingSeconds}
              serverOffsetMs={serverOffsetMs}
              isTimerActive={isTimerActive}
            />
          ) : (
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.2)' : '#ecfdf5' },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: '#059669' }]}>永久</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  textBlock: {
    gap: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  inlineLinkPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: '100%',
  },
  inlineLinkText: {
    fontSize: 12,
    fontWeight: '500',
  },
  rowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconSlot: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkUrl: {
    fontSize: 13,
    lineHeight: 18,
  },
  captionText: {
    fontSize: 12,
    lineHeight: 17,
  },
  quickIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBlock: {
    gap: 8,
  },
  imageThumb: {
    width: '100%',
    height: 180,
    borderRadius: 10,
  },
  imageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  imageName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  fileSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monoSize: {
    fontSize: 12,
    fontFamily: MONO_FONT,
  },
  folderTag: {
    fontSize: 11,
    flexShrink: 1,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  timeText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
  },
  footerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  convertedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  convertedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: MONO_FONT,
  },
});
