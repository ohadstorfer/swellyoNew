---
name: implement-design
description: Implement a Figma design as React Native code. Use when the user shares a Figma URL and wants it built, or says "implement this design", "build this screen", "code this from Figma", or pastes a figma.com/design/ link. Fetches design context + screenshot via MCP and converts to project-matching React Native components using the existing theme, tokens, and component library.
---

## Purpose

Convert a Figma design into production React Native (Expo) code that matches this project's existing conventions exactly. The output should look like it was written by the same developer who built the rest of the codebase.

## Input

The user provides a Figma URL (with or without `www.`):
`https://[www.]figma.com/design/:fileKey/:fileName?node-id=:nodeId`

If args are provided, treat the first argument as the Figma URL.
If the URL has no `node-id`, ask the user to select a specific frame in Figma and copy its link — whole-file URLs don't target a specific design.

## Steps

### 1. Parse the URL and fetch design context

Extract `fileKey` and `nodeId` from the URL:
- Strip `www.` if present
- `fileKey` = the path segment after `/design/`
- `nodeId` = the `node-id` query param, converting `-` to `:` (e.g., `3021-6700` → `3021:6700`)
- If URL has `/branch/:branchKey/`, use `branchKey` as `fileKey`

Call `mcp__figma__get_design_context` with:
- `fileKey` and `nodeId` extracted above
- `clientFrameworks`: `react,react-native,expo`
- `clientLanguages`: `typescript`

This returns React+Tailwind reference code, a screenshot, and metadata. **The code is a REFERENCE, not final code.**

### 2. Analyze the design

From the returned code and screenshot, identify:
- Layout structure (flex direction, alignment, spacing)
- Typography styles used (map to `src/theme/typography.ts` tokens)
- Colors used (map to `src/theme/colors.ts` tokens)
- Components that already exist in `src/components/`
- Images/assets that need to be handled
- Interactive elements (buttons, inputs, sliders, etc.)

### 3. Map Figma tokens to project tokens

**Typography mapping** (Figma → Project):
| Figma CSS Variable | Project Token |
|---|---|
| `family/headings, Montserrat:Bold` | `typography.fontFamilies.headings` (`Montserrat_700Bold`) |
| `family/body, Inter:Regular` | `typography.fontFamilies.body` (`Inter_400Regular`) |
| `size/lg` (18px) | `typography.fontSizes.lg` |
| `size/md` (16px) | `typography.fontSizes.md` |
| `size/s` (14px) | `typography.fontSizes.s` |
| `size/2-xl` (24px) | `typography.fontSizes['2xl']` |
| `size/3-xl` (32px) | `typography.fontSizes['3xl']` |

**Color mapping** (Figma → Project):
| Figma CSS Variable | Project Token |
|---|---|
| `text/primary, #333` | `colors.text.primary` |
| `text/secondary, #7b7b7b` | `colors.text.secondary` |
| `text/brand, #0788b0` | `colors.fill.primary` or `colors.primarySolid[300]` |
| `surface/black, #212121` | `colors.surface.black` |
| `colors/neutral/white, white` | `colors.neutral.white` |
| `colors/neutral/700, #bdbdbd` | `colors.neutral[700]` |
| `colors/neutral/1000, #333` | `colors.neutral[1000]` |
| `bg/secondary, #fafafa` | `colors.background.default` (close match) |
| `colors/signature-gradient-start` | `colors.signatureGradientStart.gStart2` |
| `#e1e1e1` (Grey3) | `colors.neutral[400]` (close match) |

**Border radius mapping** (from `src/theme/borderRadius.ts`):
| Figma Token | Project Token | Value |
|---|---|---|
| `radius/full` | `borderRadius.full` | `999` |
| `radius/6` | `borderRadius[6]` | `24` |

**Shadow mapping** (from `src/theme/shadows.ts`):
| Figma Shadow | Project Token |
|---|---|
| `DROP_SHADOW, #596E7C26, offset(0,2), radius 16` | `shadows.boxShadow01` |
- Spread `shadows.boxShadow01` directly onto a View's style

**Gradient handling**:
- Figma gradients → use `expo-linear-gradient` (`LinearGradient` component)
- Import: `import { LinearGradient } from 'expo-linear-gradient'`
- Map gradient stops to `colors.signatureGradientStart.gStart2` and `colors.primarySolid[300]` where applicable
- Do NOT use CSS `background: linear-gradient(...)` — this is React Native

### 4. Check for reusable components

Before building new components, **scan `src/components/` dynamically** by reading the directory. Key components likely to match Figma designs:
- `ButtonL` — large CTA buttons (solid, line, glass styles)
- `ProgressBar` — animated progress bars
- `FlipCard` — card flip animations

**Always prefer reusing an existing component** over creating a new one. Read the component file to check its props before deciding. If a Figma element closely matches an existing component, use it with appropriate props.

### 5. Convert to React Native code

Transform the Figma reference code following these rules:

**Structure:**
- Use `View`, `Text`, `TouchableOpacity`, `Image`, `ScrollView` from `react-native`
- Use `StyleSheet.create()` for styles (NOT inline objects, NOT Tailwind)
- Use `scale()`, `verticalScale()`, `moderateScale()` from `../utils/responsive` for responsive sizing
- Import theme tokens:
  ```typescript
  import { colors } from '../theme/colors';
  import { typography } from '../theme/typography';
  import { borderRadius } from '../theme/borderRadius';
  import { shadows } from '../theme/shadows';
  import { scale, verticalScale } from '../utils/responsive';
  ```

**Naming:**
- Component files: PascalCase (e.g., `TravelExperienceStep.tsx`)
- Style objects: camelCase descriptive names
- Props interfaces: `ComponentNameProps`

**Patterns to follow:**
- Functional components with `export default function`
- TypeScript interfaces for all props
- `accessibilityLabel` and `accessibilityRole` on interactive elements
- `testID` prop on key elements

**Do NOT:**
- Use Tailwind classes
- Use CSS-in-JS libraries (styled-components, etc.)
- Use `div`, `span`, `a`, `p`, or any HTML elements
- Use `className`
- Import from `react-native-web` directly
- Add CSS variables — use theme tokens directly
- Use `fontWeight` when a font family already includes the weight (e.g., `Montserrat_700Bold` already implies bold)

### 6. Handle images and assets

- Figma MCP returns temporary asset URLs (expire in 7 days)
- For illustrations/icons: note that they need to be downloaded and saved to `assets/`
- For placeholder/demo images: use the temp URLs initially, flag them for the user to replace
- Prefer SVG-based icons built with `View` + borders (like the existing `ChevronLeftIcon` in `ButtonL.tsx`) over image assets when feasible

### 7. Handle i18n

If the screen contains user-facing text:
- Use `useTranslation()` from `react-i18next`
- Add keys to both `src/locales/en.json` and `src/locales/es.json`
- Use the appropriate namespace (common, login, signup, welcome, home, chat, onboarding, success, provider)
- For Spanish translations, translate the English text (don't leave English as placeholder)

### 8. Output

Present the implementation to the user with:
1. The new/modified file(s) with complete code
2. A brief note on which existing components were reused
3. Any assets that need to be downloaded/replaced
4. Any i18n keys that were added

## Important notes

- Mobile-first: always design for phone viewports (393px width / iPhone 14 Pro)
- The screenshot from Figma is the source of truth for visual appearance — match it precisely
- If the design shows a screen that already exists (e.g., onboarding), update the existing screen file rather than creating a new one
- If the Figma design uses components not yet in the codebase, create them in `src/components/`
- Follow the CLAUDE.md hard rules (sync server/netlify, never expose secrets, update both locales, don't touch auth listener or SSE logic without asking)
