import React, { useEffect } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/use-theme';

export type HapticKind = 'light' | 'selection';

/**
 * 动态探测并触发轻量触感反馈（无原生 expo-haptics 依赖时静默降级，不破坏 OTA 兼容）
 */
export function triggerHaptic(kind: HapticKind = 'light'): void {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Haptics = require('expo-haptics');
    if (kind === 'selection' && typeof Haptics?.selectionAsync === 'function') {
      void Haptics.selectionAsync();
    } else if (
      typeof Haptics?.impactAsync === 'function' &&
      Haptics?.ImpactFeedbackStyle?.Light !== undefined
    ) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    // 当前运行时未内置 expo-haptics 原生模块时静默忽略
  }
}

/**
 * 跨平台统一破坏性操作二次确认框
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = '删除'
): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) {
      void onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: '取消', style: 'cancel' },
    {
      text: confirmLabel,
      style: 'destructive',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
}

export interface ActionSheetItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  color?: string;
  onPress: () => void;
}

export interface ActionContextSheetProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  items: ActionSheetItem[];
  onClose: () => void;
}

function ActionSheetRow({
  item,
  onPress,
}: {
  item: ActionSheetItem;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pressScale = useSharedValue(1);

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const tintColor = item.disabled
    ? theme.textSecondary
    : item.danger
    ? theme.danger
    : item.color || theme.text;

  return (
    <>
      {item.dividerBefore && (
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
      )}
      <Animated.View style={rowAnimatedStyle}>
        <Pressable
          style={({ pressed }) => [
            styles.itemRow,
            pressed && !item.disabled && { backgroundColor: theme.backgroundElement },
            item.disabled && styles.itemDisabled,
          ]}
          onPressIn={() => {
            if (!item.disabled) {
              pressScale.set(withTiming(0.98, { duration: 85 }));
            }
          }}
          onPressOut={() => {
            pressScale.set(withSpring(1, { damping: 20, stiffness: 320 }));
          }}
          onPress={() => {
            if (item.disabled) return;
            triggerHaptic('selection');
            onPress();
          }}
          disabled={item.disabled}
        >
          <View style={styles.itemIconWrap}>
            <Ionicons name={item.icon} size={20} color={tintColor} />
          </View>
          <Text
            style={[
              styles.itemLabel,
              { color: tintColor },
              item.danger && styles.dangerLabel,
            ]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
        </Pressable>
      </Animated.View>
    </>
  );
}

/**
 * 统一规范化移动端长按底部动作面板（Reanimated 弹簧入场 + 拖拽下拉关闭 + 主题与安全区适配）
 */
export default function ActionContextSheet({
  visible,
  title,
  subtitle,
  items,
  onClose,
}: ActionContextSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(360);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.set(320);
      backdropOpacity.set(0);
      translateY.set(withSpring(0, { damping: 24, stiffness: 280 }));
      backdropOpacity.set(withTiming(1, { duration: 180 }));
    }
  }, [visible, translateY, backdropOpacity]);

  const dismissAnimated = () => {
    translateY.set(withTiming(380, { duration: 140 }));
    backdropOpacity.set(withTiming(0, { duration: 140 }));
    setTimeout(onClose, 130);
  };

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate(e => {
      if (e.translationY > 0) {
        translateY.set(e.translationY);
      }
    })
    .onEnd(e => {
      if (e.translationY > 85 || e.velocityY > 650) {
        dismissAnimated();
      } else {
        translateY.set(withSpring(0, { damping: 24, stiffness: 280 }));
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <TouchableWithoutFeedback onPress={dismissAnimated}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.card,
              borderTopColor: theme.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            sheetStyle,
          ]}
        >
          {/* 顶部抓手与标题区绑定拖拽下拉关闭手势 */}
          <GestureDetector gesture={panGesture}>
            <View style={[styles.dragHeader, { borderBottomColor: theme.border }]}>
              <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
              {Boolean(title) && (
                <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                  {title}
                </Text>
              )}
              {Boolean(subtitle) && (
                <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          </GestureDetector>

          <ScrollView style={styles.listScroll} bounces={false}>
            {items.map(item => (
              <ActionSheetRow
                key={item.key}
                item={item}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              />
            ))}
          </ScrollView>

          <View style={[styles.cancelWrap, { borderTopColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: theme.backgroundElement }]}
              onPress={dismissAnimated}
              activeOpacity={0.8}
            >
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 16,
  },
  dragHeader: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  listScroll: {
    maxHeight: 410,
  },
  itemRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 14,
  },
  itemDisabled: {
    opacity: 0.5,
  },
  itemIconWrap: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  dangerLabel: {
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
    marginVertical: 4,
  },
  cancelWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
