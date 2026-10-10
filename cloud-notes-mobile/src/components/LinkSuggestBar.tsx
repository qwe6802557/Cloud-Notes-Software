import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { suggestNoteLinks } from '../api/notesApi';

export interface SuggestionItem {
  _id: string;
  title: string;
  notebookName: string;
  notebookColor: string;
  backlinkCount?: number;
}

interface LinkSuggestBarProps {
  visible: boolean;
  keyword: string;
  onSelectSuggestion: (title: string) => void;
  onClose: () => void;
}

export default function LinkSuggestBar({
  visible,
  keyword,
  onSelectSuggestion,
  onClose,
}: LinkSuggestBarProps) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setSuggestions([]);
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await suggestNoteLinks(keyword);
        const list = res?.data?.suggestions || (res as any)?.suggestions || [];
        setSuggestions(list);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, keyword]);

  if (!visible) return null;

  const trimmedKeyword = keyword.trim();
  const hasExactMatch = suggestions.some(
    s => s.title.toLowerCase() === trimmedKeyword.toLowerCase()
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerIndicator}>
        <Ionicons name="link" size={13} color="#2563eb" />
        <Text style={styles.indicatorText}>双链</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
        >
          {suggestions.map(item => (
            <TouchableOpacity
              key={item._id}
              style={styles.suggestionChip}
              onPress={() => onSelectSuggestion(item.title)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: item.notebookColor || '#3b82f6' },
                ]}
              />
              <Text style={styles.titleText} numberOfLines={1}>
                {item.title}
              </Text>
              {item.notebookName ? (
                <Text style={styles.notebookBadgeText} numberOfLines={1}>
                  · {item.notebookName}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}

          {/* 新建笔记占位卡片 */}
          {trimmedKeyword && !hasExactMatch ? (
            <TouchableOpacity
              style={styles.createChip}
              onPress={() => onSelectSuggestion(trimmedKeyword)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={14} color="#1d4ed8" style={{ marginRight: 3 }} />
              <Text style={styles.createText} numberOfLines={1}>
                新建《{trimmedKeyword}》
              </Text>
            </TouchableOpacity>
          ) : null}

          {suggestions.length === 0 && !trimmedKeyword ? (
            <View style={styles.emptyPrompt}>
              <Text style={styles.emptyText}>输入关键字搜索或新建双链...</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      <TouchableOpacity
        style={styles.closeBtn}
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={16} color="#94a3b8" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 6,
    paddingHorizontal: 10,
    zIndex: 99,
  },
  headerIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  indicatorText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
    marginLeft: 3,
  },
  loadingBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  scrollContent: {
    alignItems: 'center',
    paddingRight: 6,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 8,
    maxWidth: 200,
  },
  colorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  titleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  notebookBadgeText: {
    fontSize: 10,
    color: '#64748b',
    marginLeft: 2,
  },
  createChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 8,
  },
  createText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  emptyPrompt: {
    paddingHorizontal: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  closeBtn: {
    padding: 4,
    marginLeft: 4,
  },
});
