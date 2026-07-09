/**
 * ContactPreviewModal — the WhatsApp-style review screen for a shared contact.
 * Every number and email starts checked; unchecking one drops it from the sent
 * metadata. Send is disabled once nothing is left to send.
 *
 * No caption here — WhatsApp has none on this screen either.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { ContactMetadata } from '../services/messaging/messagingService';
import { ff, fs } from '../theme/fonts';

interface ContactPreviewModalProps {
  visible: boolean;
  contact: ContactMetadata;
  onSend: (contact: ContactMetadata) => void;
  onCancel: () => void;
  primaryColor?: string;
}

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Stable key for a row, so selection survives a re-render. */
const phoneKey = (i: number) => `phone:${i}`;
const emailKey = (i: number) => `email:${i}`;

export const ContactPreviewModal: React.FC<ContactPreviewModalProps> = ({
  visible,
  contact,
  onSend,
  onCancel,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();

  const allKeys = useMemo(() => {
    const keys = (contact.phone_numbers ?? []).map((_, i) => phoneKey(i));
    (contact.emails ?? []).forEach((_, i) => keys.push(emailKey(i)));
    return keys;
  }, [contact]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys));
  // onSend's caller unmounts this modal on a later render, so state updates
  // too slowly to block a same-tick double-tap. A ref blocks it in the same tick.
  const sendingRef = useRef(false);

  // Reopening with a different contact must not inherit the old selection.
  useEffect(() => {
    if (visible) {
      setSelected(new Set(allKeys));
      sendingRef.current = false;
    }
  }, [visible, allKeys]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canSend = selected.size > 0;

  const handleSend = () => {
    if (!canSend) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    const phone_numbers = (contact.phone_numbers ?? []).filter((_, i) => selected.has(phoneKey(i)));
    const emails = (contact.emails ?? []).filter((_, i) => selected.has(emailKey(i)));
    onSend({
      display_name: contact.display_name,
      phone_numbers,
      ...(emails.length ? { emails } : {}),
    });
  };

  const Row = ({
    label,
    value,
    checked,
    onPress,
  }: {
    label: string;
    value: string;
    checked: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.checkbox, checked && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
        {checked && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: primaryColor }]}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onCancel} hitSlop={10}>
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.title}>Send contact</Text>
          <TouchableOpacity
            style={[
              styles.sendPill,
              { backgroundColor: canSend ? primaryColor : '#3A3A3A' },
            ]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>Send</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={28} color="#FFFFFF" />
            </View>
            <Text numberOfLines={1} style={styles.name}>
              {contact.display_name}
            </Text>
          </View>

          {(contact.phone_numbers ?? []).map((p, i) => (
            <Row
              key={phoneKey(i)}
              label={p.label ? p.label : 'Phone'}
              value={p.number}
              checked={selected.has(phoneKey(i))}
              onPress={() => toggle(phoneKey(i))}
            />
          ))}

          {(contact.emails ?? []).map((e, i) => (
            <Row
              key={emailKey(i)}
              label={e.label ? e.label : 'Email'}
              value={e.email}
              checked={selected.has(emailKey(i))}
              onPress={() => toggle(emailKey(i))}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '600'),
    fontSize: fs(17),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  sendPill: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(15),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  sendTextDisabled: { color: 'rgba(255,255,255,0.4)' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontSize: fs(19),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontFamily: ff('Inter', '500'),
    fontSize: fs(13),
    includeFontPadding: false,
  },
  rowValue: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(17),
    color: '#FFFFFF',
    marginTop: 2,
    includeFontPadding: false,
  },
});
