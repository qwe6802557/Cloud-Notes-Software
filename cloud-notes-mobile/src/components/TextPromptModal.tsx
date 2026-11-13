import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useTheme } from '../hooks/use-theme';

export interface TextPromptModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

function PromptDialogBody({
  title,
  subtitle,
  placeholder,
  defaultValue,
  confirmLabel,
  onClose,
  onConfirm,
}: Omit<TextPromptModalProps, 'visible'>) {
  const theme = useTheme();
  const [value, setValue] = useState(defaultValue || '');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      onClose();
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

      <View
        style={[
          styles.dialog,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {Boolean(subtitle) && (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {subtitle}
          </Text>
        )}

        <TextInput
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          autoFocus
          selectTextOnFocus
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={() => void handleConfirm()}
        />

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.backgroundElement }]}
            onPress={onClose}
            disabled={submitting}
            activeOpacity={0.75}
          >
            <Text style={[styles.cancelText, { color: theme.textSecondary }]}>
              取消
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: theme.primary },
              (!value.trim() || submitting) && styles.disabledBtn,
            ]}
            onPress={() => void handleConfirm()}
            disabled={!value.trim() || submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * 跨平台通用文本输入弹窗（替代 iOS 专属 Alert.prompt，统一 Android / iOS / Web 体验）
 */
export default function TextPromptModal({
  visible,
  title,
  subtitle,
  placeholder = '请输入内容',
  defaultValue = '',
  confirmLabel = '确定',
  onClose,
  onConfirm,
}: TextPromptModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {visible ? (
        <PromptDialogBody
          key={`${title}_${defaultValue}`}
          title={title}
          subtitle={subtitle}
          placeholder={placeholder}
          defaultValue={defaultValue}
          confirmLabel={confirmLabel}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: -4,
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
    opacity: 0.5,
  },
});
