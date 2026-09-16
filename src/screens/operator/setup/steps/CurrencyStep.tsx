/**
 * Step 2 — the currency new trips are priced in (Figma 15234-21385).
 *
 * The list is `OPERATOR_CURRENCIES`, the currencies the trip wizard can take a
 * price in, not the Figma's four. Offering a default the price field then
 * refuses would leave the operator with a setting that does nothing.
 *
 * Continue always confirms, changed or not: the step asks that they LOOKED.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { saveOperatorSettings } from '../../../../services/trips/operatorSettingsService';
import { showErrorAlert } from '../../../../utils/friendlyError';
import {
  CURRENCY_NAMES,
  OPERATOR_CURRENCIES,
  currencyForCountry,
  type CurrencyCode,
} from '../../../../utils/currency';
import { textStyle, textStyles } from '../../../../theme/typography';
import { TripIcon, type TripIconName } from '../../../../components/trips/tripIcons';
import { useWizard } from '../OperatorSetupWizard';
import {
  C,
  CheckBadge,
  FOOTER_SPACE,
  IconTile,
  SelectCard,
  StepHeading,
  useWizardFooter,
} from '../setupUi';

/** Figma's currency icons. The icon set has no shekel, so ILS shows the sign
 *  as text in the same tile. */
const CURRENCY_ICON: Partial<Record<CurrencyCode, TripIconName>> = {
  USD: 'currency-dollar',
  EUR: 'currency-euro',
  GBP: 'currency-pound',
};

function initialCurrency(stored: string | null, country: string | null | undefined): CurrencyCode {
  const pool = OPERATOR_CURRENCIES as string[];
  if (stored && pool.includes(stored)) return stored as CurrencyCode;
  const fromCountry = currencyForCountry(country);
  return pool.includes(fromCountry) ? fromCountry : 'USD';
}

export const CurrencyStep: React.FC = () => {
  const { settings, reload, next, country } = useWizard();
  const [picked, setPicked] = useState<CurrencyCode>(() =>
    initialCurrency(settings.defaultCurrency, country),
  );
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await saveOperatorSettings({ defaultCurrency: picked, confirmCurrency: true });
      await reload();
      return true;
    } catch (e) {
      showErrorAlert('Could not save', e, 'That did not save. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  useWizardFooter({
    label: 'Continue',
    busy,
    onPress: async () => {
      if (await save()) next();
    },
    onSaveExit: save,
  });

  return (
    <ScrollView
      contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}
      showsVerticalScrollIndicator={false}
    >
      <StepHeading
        title="Choose your currency"
        sub="This will be the default currency for new trips. You can change it for a specific trip."
      />
      <View style={s.list} accessibilityRole="radiogroup">
        {OPERATOR_CURRENCIES.map(code => {
          const on = picked === code;
          return (
            <SelectCard
              key={code}
              selected={on}
              onPress={() => setPicked(code)}
              style={s.row}
              accessibilityLabel={`${code}, ${CURRENCY_NAMES[code]}`}
            >
              <IconTile>
                {CURRENCY_ICON[code] ? (
                  <TripIcon name={CURRENCY_ICON[code]!} size={18} color={C.icon} strokeWidth={1.33} />
                ) : (
                  <Text style={s.symbol}>{code === 'ILS' ? '₪' : code[0]}</Text>
                )}
              </IconTile>
              <View style={s.text}>
                <Text style={s.code}>{code}</Text>
                <Text style={s.name}>{CURRENCY_NAMES[code]}</Text>
              </View>
              {on ? <CheckBadge /> : null}
            </SelectCard>
          );
        })}
      </View>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 24 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  symbol: { ...textStyles.MB1, color: C.ink },
  text: { flex: 1 },
  code: { ...textStyle('MB1', '700'), color: C.ink },
  name: { ...textStyles.B3, color: C.ink },
});
