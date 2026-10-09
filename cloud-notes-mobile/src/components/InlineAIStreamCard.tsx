import React, { useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';

export interface InlineAIStreamCardProps {
  visible: boolean;
  actionTitle: string;
  isStreaming: boolean;
  streamingText: string;
  errorMessage?: string;
  hasSelection: boolean;
  onStop: () => void;
  onApplyReplace: (text: string) => void;
  onApplyInsert: (text: string) => void;
  onClose: () => void;
  onRetry?: () => void;
}

export default function InlineAIStreamCard({
  visible,
  actionTitle,
  isStreaming,
  streamingText,
  errorMessage,
  hasSelection,
  onStop,
  onApplyReplace,
  onApplyInsert,
  onClose,
  onRetry,
}: InlineAIStreamCardProps) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // 每次流式内容更新时自动滚到底部跟随打字机
  useEffect(() => {
    if (isStreaming && streamingText) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [streamingText, isStreaming]);

  if (!visible) return null;

  const handleCopy = async () => {
    if (!streamingText) return;
    await Clipboard.setStringAsync(streamingText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasOutput = Boolean(streamingText && streamingText.trim().length > 0);

  return (
    <View style={styles.cardContainer}>
      {/* 顶部状态与控制栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={16} color="#7c3aed" />
          <Text style={styles.headerTitle}>{actionTitle}</Text>
          {isStreaming ? (
            <Text style={styles.headerBadgeGenerating}>生成中...</Text>
          ) : hasOutput ? (
            <Text style={styles.headerBadgeDone}>已生成 {streamingText.length} 字</Text>
          ) : null}
        </View>

        <View style={styles.headerRight}>
          {isStreaming ? (
            <TouchableOpacity style={styles.stopBtn} onPress={onStop} activeOpacity={0.7}>
              <Ionicons name="stop-circle-outline" size={16} color="#ef4444" />
              <Text style={styles.stopBtnText}>停止</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.closeIconBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 中间内容输出区 */}
      <View style={styles.body}>
        {errorMessage ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={20} color="#ef4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
            {onRetry && (
              <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
                <Text style={styles.retryBtnText}>重试</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : !hasOutput && isStreaming ? (
          // 初始连通居中单 Loading 动画（对齐规范）
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#7c3aed" />
            <Text style={styles.loadingText}>AI 正在实时思考生成中...</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            {/* 流式进行中优先纯文本极速渲染防抖动，输出稳定时展示 Markdown */}
            {isStreaming ? (
              <Text style={styles.streamingPlainText}>
                {streamingText}
                <Text style={styles.cursorCursor}> ▍</Text>
              </Text>
            ) : (
              <Markdown style={markdownStyles}>{streamingText}</Markdown>
            )}
          </ScrollView>
        )}
      </View>

      {/* 底部决策与操作区 */}
      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={handleCopy}
            disabled={!hasOutput}
            activeOpacity={0.7}
          >
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={15}
              color={copied ? '#10b981' : '#64748b'}
            />
            <Text style={[styles.ghostBtnText, copied && { color: '#10b981' }]}>
              {copied ? '已复制' : '复制'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>放弃</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerRight}>
          {hasSelection ? (
            <>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => onApplyInsert(streamingText)}
                disabled={!hasOutput}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryBtnText}>追加到后</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, !hasOutput && styles.primaryBtnDisabled]}
                onPress={() => onApplyReplace(streamingText)}
                disabled={!hasOutput}
                activeOpacity={0.7}
              >
                <Ionicons name="checkmark" size={15} color="#ffffff" />
                <Text style={styles.primaryBtnText}>替换选区</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, !hasOutput && styles.primaryBtnDisabled]}
              onPress={() => onApplyInsert(streamingText)}
              disabled={!hasOutput}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-down-circle-outline" size={15} color="#ffffff" />
              <Text style={styles.primaryBtnText}>插入正文</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderBottomWidth: 0,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: '0 -4px 16px rgba(124, 58, 237, 0.08)',
      } as any,
    }),
  },
  header: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#faf5ff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3e8ff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b21a8',
  },
  headerBadgeGenerating: {
    fontSize: 11,
    color: '#a855f7',
    fontWeight: '500',
    backgroundColor: '#f3e8ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  headerBadgeDone: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '500',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stopBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  closeIconBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  body: {
    maxHeight: 220,
    minHeight: 80,
    backgroundColor: '#ffffff',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  streamingPlainText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#1e293b',
  },
  cursorCursor: {
    color: '#7c3aed',
    fontWeight: 'bold',
  },
  loadingContainer: {
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '500',
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  ghostBtnText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  secondaryBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
});

const markdownStyles = {
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: '#1e293b',
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#0f172a',
    marginTop: 8,
    marginBottom: 6,
  },
  heading2: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#0f172a',
    marginTop: 6,
    marginBottom: 4,
  },
  bullet_list: {
    marginBottom: 6,
  },
  code_inline: {
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 13,
  },
  fence: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginVertical: 4,
  },
};
