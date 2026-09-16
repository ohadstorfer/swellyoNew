/**
 * Step 6 — read and sign the operator agreement (Figma 15286-77769 locked,
 * 15522-19229 unlocked).
 *
 * Locked until the operator reads the agreement to its end in the sheet. Then
 * a typed full name and a consent box sign it. Saved: the accepted VERSION,
 * the time, and the name (`terms_signed_name`). A stale version is an
 * unfinished step, so publishing new terms reopens this for everyone.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { saveOperatorSettings } from '../../../../services/trips/operatorSettingsService';
import { OPERATOR_TERMS_VERSION } from '../../../../services/trips/operatorSetup';
import { IS_DRAFT, LAST_REVIEWED } from '../../../../services/terms/operatorAgreement';
import { OperatorTermsSheet } from '../../../../components/settings/OperatorTermsSheet';
import { TripIcon } from '../../../../components/trips/tripIcons';
import { showErrorAlert } from '../../../../utils/friendlyError';
import { textStyle, textStyles } from '../../../../theme/typography';
import { useWizard } from '../OperatorSetupWizard';
import {
  C,
  CheckBadge,
  FOOTER_SPACE,
  IconTile,
  SelectCard,
  StatusNote,
  StepHeading,
  useWizardFooter,
} from '../setupUi';

export const AgreementStep: React.FC = () => {
  const { settings, reload, next } = useWizard();
  const signed = settings.termsAcceptedAt != null && settings.termsVersion === OPERATOR_TERMS_VERSION;

  const [reading, setReading] = useState(false);
  const [read, setRead] = useState(signed);
  const [name, setName] = useState(signed ? settings.termsSignedName ?? '' : '');
  const [agreed, setAgreed] = useState(signed);
  const [busy, setBusy] = useState(false);

  const ready = read && agreed && name.trim().length >= 2;

  useWizardFooter({
    label: signed ? 'Continue' : 'Sign Agreement',
    busy,
    disabled: !signed && !ready,
    onPress: async () => {
      if (signed) return next();
      setBusy(true);
      try {
        await saveOperatorSettings({
          acceptTermsVersion: OPERATOR_TERMS_VERSION,
          termsSignedName: name.trim(),
        });
        await reload();
        next();
      } catch (e) {
        showErrorAlert('Could not sign', e, 'That did not save. Please try again.');
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <>
      <KeyboardAwareScrollView
        contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={FOOTER_SPACE}
        showsVerticalScrollIndicator={false}
      >
        <StepHeading
          title="Review the Operator Agreement"
          sub="Read and sign the agreement for running paid trips on Swellyo."
        />

        <View style={s.column}>
          <SelectCard
            selected={read}
            onPress={() => setReading(true)}
            accessibilityRole="button"
            accessibilityLabel="Open the Swellyo Operator Agreement"
            style={s.doc}
          >
            <IconTile>
              <TripIcon name="file-06" size={18} color={C.icon} strokeWidth={1.33} />
            </IconTile>
            <View style={s.docText}>
              <Text style={s.docTitle}>Swellyo Operator Agreement</Text>
              <Text style={s.docSub}>Last updated {LAST_REVIEWED}</Text>
            </View>
            {read ? <CheckBadge /> : <TripIcon name="chevron-right" size={18} color={C.icon} />}
          </SelectCard>

          {signed ? (
            <StatusNote
              tone="ok"
              title="Signed"
              body={settings.termsSignedName ? `Signed by ${settings.termsSignedName}.` : null}
            />
          ) : !read ? (
            <Text style={s.hint}>
              Open and read the agreement to unlock the signature fields below.
            </Text>
          ) : (
            <View style={s.sign}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={C.muted}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                maxLength={120}
                style={s.input}
                accessibilityLabel="Full name"
              />
              <Pressable
                onPress={() => setAgreed(v => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                style={s.consent}
              >
                <View style={[s.box, agreed && s.boxOn]}>
                  {agreed ? <TripIcon name="check" size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
                <Text style={s.consentText}>
                  {IS_DRAFT
                    ? 'I confirm that I have read and agree to the Swellyo Operator Agreement as summarised, and will review the full agreement when it is published.'
                    : 'I confirm that I have read and agree to the Swellyo Operator Agreement.'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>

      <OperatorTermsSheet
        visible={reading}
        onClose={() => setReading(false)}
        onRead={() => setRead(true)}
      />
    </>
  );
};

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 35 },
  column: { gap: 24 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  docText: { flex: 1, marginRight: 8 },
  docTitle: { ...textStyle('MB1', '700'), color: C.ink },
  docSub: { ...textStyles.B3, color: C.ink },
  hint: { ...textStyles.B3, color: C.muted, paddingHorizontal: 8 },
  sign: { gap: 24 },
  input: {
    height: 56,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    ...textStyles.MB2,
    color: C.ink,
  },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 2 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.divider,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: C.accent, borderColor: C.accent },
  consentText: { flex: 1, ...textStyles.MB2, color: C.ink },
});
