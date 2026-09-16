/**
 * Step 4 — the default waiver PDF (Figma 15258-74979, uploaded: 15258-75210).
 *
 * Uploads on pick, like before: the file is the whole step, so there is no
 * draft to hold. It is a TEMPLATE copied onto each trip at publish, so
 * replacing or removing it never changes a trip already published.
 *
 * The 10 MB limit is real: `uploadDefaultWaiver` checks before uploading, and
 * the database refuses a bigger file (20260915000100_waiver_pdf_10mb_limit.sql).
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { saveOperatorSettings } from '../../../../services/trips/operatorSettingsService';
import {
  MAX_WAIVER_BYTES,
  WAIVER_TOO_BIG_MESSAGE,
  uploadDefaultWaiver,
} from '../../../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../../../utils/friendlyError';
import { TripIcon } from '../../../../components/trips/tripIcons';
import { DocumentViewer } from '../../../../components/trips/DocumentViewer';
import { textStyle, textStyles } from '../../../../theme/typography';
import { useWizard } from '../OperatorSetupWizard';
import { C, DashedUpload, FOOTER_SPACE, StepHeading, useWizardFooter } from '../setupUi';

export const WaiverStep: React.FC = () => {
  const { settings, reload, next } = useWizard();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const waiver = settings.defaultWaiver;

  useWizardFooter({ label: 'Continue', disabled: !waiver, busy, onPress: next });

  const pick = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = !res.canceled ? res.assets?.[0] : null;
      if (!asset?.uri) return;
      // The picker usually knows the size; say no before any upload starts.
      if (typeof asset.size === 'number' && asset.size > MAX_WAIVER_BYTES) {
        showErrorAlert('File too large', null, WAIVER_TOO_BIG_MESSAGE);
        return;
      }

      setBusy(true);
      const stored = await uploadDefaultWaiver(asset.uri, waiver?.path ?? null);
      await saveOperatorSettings({
        defaultWaiver: {
          path: stored.path,
          name: asset.name ?? 'waiver.pdf',
          hash: stored.hash,
          sizeBytes: stored.sizeBytes,
          uploadedAt: new Date().toISOString(),
        },
      });
      await reload();
    } catch (e) {
      showErrorAlert('Could not upload', e, 'That file did not upload. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await saveOperatorSettings({ defaultWaiver: null });
      await reload();
    } catch (e) {
      showErrorAlert('Could not remove', e, 'That did not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}>
      <StepHeading
        title="Add your default waiver"
        sub="Travelers will sign this waiver digitally during their trip onboarding. You can replace it for a specific trip before travelers join."
      />

      {waiver ? (
        <View style={s.file}>
          <Pressable
            onPress={() => setViewing(true)}
            style={s.fileMain}
            accessibilityRole="button"
            accessibilityLabel={`View ${waiver.name}`}
          >
            <TripIcon name="check-circle-broken" size={18} color={C.ok} strokeWidth={1.33} />
            <View style={s.fileText}>
              <Text style={s.fileName} numberOfLines={1}>
                {waiver.name}
              </Text>
              <Text style={s.fileOk}>Uploaded successfully</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={remove}
            disabled={busy}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Remove waiver"
            style={({ pressed }) => [s.trash, pressed && s.pressed]}
          >
            <TripIcon name="trash-03" size={22} color={C.danger} strokeWidth={1.09} />
          </Pressable>
        </View>
      ) : (
        <View style={s.outer}>
          <DashedUpload
            icon={<TripIcon name="shield-01" size={24} color={C.icon} strokeWidth={0.75} />}
            title="Upload waiver PDF"
            sub="Tap to select a file"
            onPress={pick}
            busy={busy}
            style={s.dashed}
          />
          <View style={s.info}>
            <View style={s.infoIcon}>
              <TripIcon name="annotation-info" size={18} color={C.icon} strokeWidth={1.33} />
            </View>
            <Text style={s.infoText}>Swellyo supports PDF waivers up to 10 MB.</Text>
          </View>
        </View>
      )}

      <DocumentViewer
        visible={viewing}
        storagePath={waiver?.path ?? null}
        title="Your waiver"
        onClose={() => setViewing(false)}
      />
    </ScrollView>
  );
};

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 35 },
  outer: { padding: 10, gap: 12, borderRadius: 32, backgroundColor: C.card },
  dashed: { minHeight: 198, borderRadius: 24 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 32,
    backgroundColor: C.iconBg,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, ...textStyles.B4, color: '#4A5565' },

  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: C.card,
  },
  fileMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileText: { flex: 1 },
  fileName: { ...textStyle('MB1', '700'), color: C.ink },
  fileOk: { ...textStyles.B3, color: C.okText },
  trash: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.97 }] },
});
