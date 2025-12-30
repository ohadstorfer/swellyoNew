// Base file for TypeScript - Metro will use .native.tsx or .web.tsx at runtime
// Metro automatically resolves platform-specific extensions (.native.tsx, .web.tsx)
// This base file is only used if platform-specific files don't exist

export type Country = {
  cca2: string;
  name: string | { common: string };
};
export type CountryCode = string;

export const CountryPicker: React.ComponentType<any> | null = null;

