// Native-only wrapper for react-native-country-picker-modal
// This file is automatically ignored by Metro on web due to .native.tsx extension

import CountryPickerModule, { Country, CountryCode } from 'react-native-country-picker-modal';

export const CountryPicker = CountryPickerModule.default || CountryPickerModule;
export { Country, CountryCode };

