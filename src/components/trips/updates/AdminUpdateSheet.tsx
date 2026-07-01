// AdminUpdateSheet — host-only bottom sheet to post or edit a trip update.
// Pixel-matches the Figma sheets (add 12933:37758 / edit 13179:6550): white
// sheet + 80x4 grabber, a megaphone-iconed title with a hairline divider, a
// "Description" label + live X/500 counter, a 150-tall pencil-iconed body field,
// and a dark #212121 CTA. Add mode → "Update" + a "Maybe later" dismiss; edit
// mode → "Save" and a trash button in the title (delete).

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import { AnnouncementIcon } from '../AdminUpdateUI';
import { TripIcon } from '../tripIcons';

// Description-field pencil — exact "Edit Icon" glyph from Figma node 13169:13689
// (a filled outline pencil, distinct from the stroked edit-02). Render with fill.
const UpdatePencilIcon: React.FC<{ size?: number; color?: string }> = ({ size = 24, color = '#7B7B7B' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M11.5312 18.5199L11.2583 17.8213L11.5312 18.5199ZM7.47478 19.2988L7.09978 19.9483L7.09978 19.9483L7.47478 19.2988ZM6.12116 15.3964L5.37971 15.5093L6.12116 15.3964ZM6.61146 12.7941L7.26098 13.1691L6.61146 12.7941ZM6.02731 14.0314L5.29028 13.8925H5.29028L6.02731 14.0314ZM13.5397 16.7941L14.1892 17.1691L13.5397 16.7941ZM12.7602 17.9186L13.249 18.4875H13.249L12.7602 17.9186ZM10.4099 6.21503L9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L16.6886 9.84003L12.8901 16.4191L13.5397 16.7941L14.1892 17.1691L17.9876 10.59L17.3381 10.215ZM6.61146 12.7941L7.26098 13.1691L11.0594 6.59003L10.4099 6.21503L9.76038 5.84003L5.96194 12.4191L6.61146 12.7941ZM11.5312 18.5199L11.2583 17.8213C10.1618 18.2497 9.41502 18.5394 8.83854 18.6741C8.28167 18.8042 8.02898 18.7527 7.84978 18.6493L7.47478 19.2988L7.09978 19.9483C7.75305 20.3255 8.45392 20.3044 9.17981 20.1348C9.88609 19.9698 10.7513 19.6298 11.8041 19.2184L11.5312 18.5199ZM6.12116 15.3964L5.37971 15.5093C5.5499 16.6267 5.68805 17.546 5.89829 18.2402C6.11436 18.9536 6.44651 19.5712 7.09978 19.9483L7.47478 19.2988L7.84978 18.6493C7.67059 18.5458 7.49965 18.3527 7.33389 17.8054C7.16229 17.2388 7.03986 16.4472 6.86261 15.2835L6.12116 15.3964ZM6.61146 12.7941L5.96194 12.4191C5.64012 12.9765 5.38246 13.4033 5.29028 13.8925L6.02731 14.0314L6.76434 14.1702C6.7983 13.99 6.88802 13.8151 7.26098 13.1691L6.61146 12.7941ZM6.12116 15.3964L6.86261 15.2835C6.7503 14.546 6.73039 14.3505 6.76434 14.1702L6.02731 14.0314L5.29028 13.8925C5.1981 14.3817 5.2828 14.873 5.37971 15.5093L6.12116 15.3964ZM13.5397 16.7941L12.8901 16.4191C12.5172 17.0651 12.4105 17.2303 12.2715 17.3498L12.7602 17.9186L13.249 18.4875C13.6266 18.1631 13.8674 17.7265 14.1892 17.1691L13.5397 16.7941ZM11.5312 18.5199L11.8041 19.2184C12.4036 18.9842 12.8714 18.8119 13.249 18.4875L12.7602 17.9186L12.2715 17.3498C12.1324 17.4693 11.953 17.5498 11.2583 17.8213L11.5312 18.5199ZM15.874 4.75093L15.499 5.40045C16.3339 5.88245 16.8939 6.20761 17.2797 6.50537C17.6483 6.78983 17.7658 6.98144 17.8135 7.15945L18.5379 6.96534L19.2623 6.77123C19.0956 6.14904 18.6976 5.70485 18.1961 5.31785C17.7119 4.94416 17.0471 4.56221 16.249 4.10141L15.874 4.75093ZM17.3381 10.215L17.9876 10.59C18.4484 9.79189 18.8331 9.12875 19.0657 8.56299C19.3065 7.97711 19.4291 7.39341 19.2623 6.77123L18.5379 6.96534L17.8135 7.15945C17.8612 7.33747 17.8553 7.56212 17.6783 7.99278C17.493 8.44357 17.1706 9.00517 16.6886 9.84003L17.3381 10.215ZM15.874 4.75093L16.249 4.10141C15.4509 3.6406 14.7877 3.2559 14.222 3.02337C13.6361 2.78257 13.0524 2.65997 12.4302 2.82668L12.6243 3.55113L12.8184 4.27557C12.9964 4.22787 13.2211 4.23376 13.6518 4.41076C14.1025 4.59604 14.6641 4.91844 15.499 5.40045L15.874 4.75093ZM10.4099 6.21503L11.0594 6.59003C11.5414 5.75517 11.8666 5.19516 12.1643 4.80931C12.4488 4.4407 12.6404 4.32327 12.8184 4.27557L12.6243 3.55113L12.4302 2.82668C11.808 2.99339 11.3638 3.39142 10.9768 3.89291C10.6031 4.37716 10.2212 5.04189 9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L17.7131 9.56551L10.7849 5.56551L10.4099 6.21503L10.0349 6.86455L16.9631 10.8645L17.3381 10.215Z"
      fill={color}
    />
  </Svg>
);

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  initialTitle?: string;
  initialBody?: string;
  saving?: boolean;
  onSubmit: (title: string, body: string) => void | Promise<void>;
  /** Edit mode only — host deletes the update (parent owns the confirm). */
  onDelete?: () => void;
}

export const AdminUpdateSheet: React.FC<Props> = ({
  visible,
  onClose,
  mode,
  initialTitle,
  initialBody,
  saving,
  onSubmit,
  onDelete,
}) => {
  const [updateTitle, setUpdateTitle] = useState(initialTitle ?? '');
  const [body, setBody] = useState(initialBody ?? '');

  // Reset the draft from the initial values each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setUpdateTitle(initialTitle ?? '');
      setBody(initialBody ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const isEdit = mode === 'edit';
  // Figma copy (nodes 12933:37758 add / 13179:6550 edit).
  const title = isEdit ? 'Edit update' : 'Add an update';
  const cta = isEdit ? 'Save' : 'Update';
  const TITLE_MAX = 21;
  const MAX = 500;
  // Title is required; the description is optional (Figma 12933-37482).
  const disabled = updateTitle.trim().length === 0 || !!saving;

  const handleSubmit = () => {
    if (disabled) return;
    onSubmit(updateTitle.trim(), body.trim());
  };

  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } = useSheetTransition(visible, onClose);
  // Android: pad past the system nav/gesture bar so the CTA + "Maybe later" clear
  // it. iOS keeps the static 24 (no change). See styles.sheet.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavRoot}
      >
        <Pressable style={styles.container} onPress={onClose}>
          <Animated.View
            pointerEvents="none"
            style={[styles.backdrop, { opacity: backdropOpacity }]}
          />
          <Animated.View
            style={{ transform: [{ translateY }] }}
            onLayout={onSheetLayout}
          >
            <Pressable
              style={[styles.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}
              onPress={e => e.stopPropagation()}
            >
            {/* Grabber */}
            <View style={styles.grabberRow} {...panHandlers}>
              <View style={styles.grabber} />
            </View>

            <View style={styles.body}>
              {/* Megaphone + title, with a trash button (edit only). */}
              <View style={styles.titleRow}>
                <View style={styles.titleLeft}>
                  <View style={styles.megaBox}>
                    <AnnouncementIcon size={18} color="#333333" />
                  </View>
                  <Text style={styles.title}>{title}</Text>
                </View>
                {isEdit && onDelete ? (
                  <TouchableOpacity
                    style={styles.trashBtn}
                    onPress={onDelete}
                    disabled={!!saving}
                    activeOpacity={0.7}
                    accessibilityLabel="Delete update"
                  >
                    <TripIcon name="trash-01" size={22} color="#FF5367" strokeWidth={1} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* "Update Title" label + live counter, then a single-line field.
                  Required — drives the CTA (Figma 12933-37482). */}
              <View style={styles.descBlock}>
                <View style={styles.labelRow}>
                  <Text style={styles.fieldLabel}>Update Title</Text>
                  <Text style={styles.counter}>
                    {updateTitle.length} /{TITLE_MAX}
                  </Text>
                </View>
                <View style={styles.titleField}>
                  <UpdatePencilIcon size={24} color="#7B7B7B" />
                  <TextInput
                    style={styles.titleInput}
                    value={updateTitle}
                    onChangeText={setUpdateTitle}
                    maxLength={TITLE_MAX}
                    editable={!saving}
                    autoFocus
                    returnKeyType="next"
                    placeholder="e.g. Portable speaker, Beach towels…"
                    placeholderTextColor="#7B7B7B"
                  />
                </View>
              </View>

              {/* "Description" label + live char counter, then the pencil field. */}
              <View style={styles.descBlock}>
                <View style={styles.labelRow}>
                  <Text style={styles.fieldLabel}>Description</Text>
                  <Text style={styles.counter}>
                    {body.length} /{MAX}
                  </Text>
                </View>
                <View style={styles.field}>
                  <UpdatePencilIcon size={24} color="#7B7B7B" />
                  <TextInput
                    style={styles.input}
                    value={body}
                    onChangeText={setBody}
                    multiline
                    maxLength={MAX}
                    textAlignVertical="top"
                    editable={!saving}
                    placeholder="Bali and Barrels"
                    placeholderTextColor="#7B7B7B"
                  />
                </View>
              </View>

              {/* Dark CTA — "Update" / "Save". Add mode also shows "Maybe later". */}
              <View style={styles.buttons}>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
                    onPress={handleSubmit}
                    disabled={disabled}
                    activeOpacity={0.85}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryBtnText}>{cta}</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {!isEdit ? (
                  <TouchableOpacity onPress={onClose} disabled={!!saving} activeOpacity={0.7}>
                    <Text style={styles.maybeLater}>Maybe later</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default AdminUpdateSheet;

const styles = StyleSheet.create({
  kavRoot: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(33,33,33,0.7)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 2,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  grabberRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  // "Bottom gear" — title / field / buttons stacked with a 24 gap (Figma).
  body: { gap: 24 },

  // Title row — megaphone + title on the left, hairline underneath, trash right.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  megaBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Title — Inter Bold 20 / 24 (#333), node 12933:37764 / 13179:6559.
  title: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, color: '#333333' },
  trashBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 8,
  },

  // Label row — "Description" (Inter Bold 20/24) + right-aligned counter
  // (Inter Regular 12/18 #7B7B7B), node 13169:13682 / 13179:6563.
  descBlock: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', height: 24, paddingRight: 4 },
  fieldLabel: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, color: '#333333' },
  counter: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#7B7B7B' },
  // Title field — single line, pencil centered with the text (Figma 12933-37482).
  titleField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  // Field — fixed 150 tall, pencil top-aligned, padding 16/8/16 (Figma 13169:13688).
  field: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    height: 150,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    padding: 0,
    textAlignVertical: 'top',
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
  },
  // Single-line title input — vertically centered in its row.
  titleInput: {
    flex: 1,
    padding: 0,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
  },

  // Buttons — dark CTA, plus "Maybe later" (add mode), node 13166:9509.
  buttons: { alignItems: 'center', gap: 16, paddingTop: 8, paddingHorizontal: 16 },
  buttonRow: { flexDirection: 'row', width: '100%' },
  primaryBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212121',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  // Montserrat SemiBold 16 / 24 (white), node I12933:37756;9644:20653.
  primaryBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, lineHeight: 24, color: '#FFFFFF' },
  // "Maybe later" — Inter Bold 18 / 22 (#333), node 13166:9513.
  maybeLater: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    textAlign: 'center',
  },
});
