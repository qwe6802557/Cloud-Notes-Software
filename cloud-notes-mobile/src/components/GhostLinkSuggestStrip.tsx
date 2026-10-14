import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getNoteDictionary } from '../api/notesApi';

interface GhostLinkSuggestStripProps {
  visible: boolean;
  onClose: () => void;
  content: string;
  currentNoteId?: string;
  currentNoteTitle?: string;
  onConvertWord: (word: string) => void;
  onConvertAll: (words: string[]) => void;
}

interface DictItem {
  _id: string;
  title: string;
  notebookName?: string;
}

// 提取文档中受 Markdown 语法保护的区间
const getProtectedRanges = (text: string) => {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!text) return ranges;

  const patterns = [
    /```[\s\S]*?```/g,               // 多行代码块
    /`[^`\n]+`/g,                     // 行内代码
    /\[\[[^\]\r\n]+\]\]/g,            // 已存在的双链
    /!?\[[^\]\r\n]*\]\([^)\r\n]*\)/g,    // Markdown 链接与图片
    /<[^>\r\n]+>/g,                   // HTML 标签
  ];

  patterns.forEach(regex => {
    let match;
    while ((match = regex.exec(text)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  });

  return ranges;
};

// 检测指定区间是否与受保护区间重叠
const isRangeProtected = (start: number, end: number, protectedRanges: Array<{ start: number; end: number }>) => {
  return protectedRanges.some(r => Math.max(start, r.start) < Math.min(end, r.end));
};

export default function GhostLinkSuggestStrip({
  visible,
  onClose,
  content,
  currentNoteId,
  currentNoteTitle,
  onConvertWord,
  onConvertAll,
}: GhostLinkSuggestStripProps) {
  const [dictionary, setDictionary] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  // 获取词典
  useEffect(() => {
    let isMounted = true;
    const fetchDict = async () => {
      try {
        setLoading(true);
        const res = await getNoteDictionary();
        if (isMounted && res?.data?.dictionary) {
          setDictionary(res.data.dictionary);
        }
      } catch {
        // 静默降级
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (visible && dictionary.length === 0) {
      fetchDict();
    }

    return () => {
      isMounted = false;
    };
  }, [visible, dictionary.length]);

  // 扫描命中词汇
  const matchedWords = useMemo(() => {
    if (!visible || !content || dictionary.length === 0) return [];

    const protectedRanges = getProtectedRanges(content);
    const wordsFound: string[] = [];
    const normalizedCurrentTitle = (currentNoteTitle || '').trim().toLowerCase();

    // 优先匹配长词
    const sortedDict = [...dictionary]
      .filter(item => {
        const t = (item.title || '').trim();
        return t.length >= 2 && (!currentNoteId || item._id !== currentNoteId) && t.toLowerCase() !== normalizedCurrentTitle;
      })
      .sort((a, b) => b.title.length - a.title.length);

    sortedDict.forEach(item => {
      const term = item.title.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      let match;

      while ((match = regex.exec(content)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (!isRangeProtected(start, end, protectedRanges)) {
          if (!wordsFound.includes(term)) {
            wordsFound.push(term);
          }
          break; // 只要命中一次即纳入推荐
        }
      }
    });

    return wordsFound;
  }, [visible, content, dictionary, currentNoteId, currentNoteTitle]);

  useEffect(() => {
    if (visible) {
      setHasScanned(true);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={13} color="#7c3aed" style={{ marginRight: 4 }} />
        <Text style={styles.headerTitle}>概念感知</Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={14} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={styles.loadingText}>正在比对知识库已有笔记词条...</Text>
        </View>
      ) : matchedWords.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>当前正文中暂无命中未织入的词条</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollList}
        >
          {matchedWords.length > 1 && (
            <TouchableOpacity
              style={styles.convertAllBtn}
              onPress={() => onConvertAll(matchedWords)}
              activeOpacity={0.7}
            >
              <Ionicons name="flash" size={12} color="#ffffff" style={{ marginRight: 3 }} />
              <Text style={styles.convertAllText}>全转双链 ({matchedWords.length})</Text>
            </TouchableOpacity>
          )}

          {matchedWords.map(word => (
            <TouchableOpacity
              key={word}
              style={styles.wordPill}
              onPress={() => onConvertWord(word)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={12} color="#7c3aed" style={{ marginRight: 2 }} />
              <Text style={styles.wordText}>{word}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#faf5ff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e9d5ff',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c3aed',
    flex: 1,
  },
  closeBtn: {
    padding: 2,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    color: '#7c3aed',
  },
  emptyBox: {
    paddingVertical: 4,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  scrollList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  convertAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  convertAllText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  wordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  wordText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6d28d9',
  },
});
