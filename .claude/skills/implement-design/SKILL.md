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

### 1b. Name the text STYLE of every text node, then use `src/theme/typography.ts` (mandatory)

Never take a font size or line height from the design-context code — not the `var(--size/…, Npx)` fallbacks, and **not bare `text-[Npx]` values either**. The Figma Typography collection's default mode is `Desktop - 1440`, so the export prints desktop sizes. When a text layer overrides the weight (bold) it also drops the variable and prints the inflated number as if it were a literal: bold `20px` is really `Size/lg 16`, `18px` is `Size/md 14`, bold `16px` is `Size/s 12`, `12px/14` is `Size/xxs 9`. Tell-tale: a `text-[0px]` wrapper around a bold `<p>`.

The question to answer per text node is **"which style is this?"**, not "what number is this?".

1. `mcp__figma__get_metadata` on the node → list the text node ids.
2. `mcp__figma__get_variable_defs` on each text node. For an instance child (`I123:45;67:89`, which the tool rejects), query the parent instance and match each text by its line height / box height. The result names the style (e.g. `Body/M B-1`) and the resolved mobile `Size/*`.
3. Map the style with `figmaTextStyle` in `src/theme/typography.ts` (`Body/M B-1` → `MB1`) and write `...textStyles.MB1`. If the node is bold but the style is a Regular Body style, that is a weight override: write `...textStyle('MB1', '700')` — size and line height stay the style's own.
4. No style, only a `Size/*` variable → `fontSize: fs(fontSize.lg)` + `ff()`. No size variable at all → it is a true literal; type it and add a comment saying so.
5. Cross-check: the size in `get_variable_defs` must equal the size of the style you picked. If not, you picked the wrong style.

### 2. Analyze the design

From the returned code and screenshot, identify:
- Layout structure (flex direction, alignment, spacing)
- Typography styles used (map to `textStyles` in `src/theme/typography.ts`, per step 1b)
- Colors used (map to `src/theme/colors.ts` tokens)
- Components that already exist in `src/components/`
- Images/assets that need to be handled
- Interactive elements (buttons, inputs, sliders, etc.)

### 3. Map Figma tokens to project tokens

**Typography mapping** (Figma → Project):

⚠️ The px in `var(--size/…, Npx)` fallbacks are the DESKTOP mode. The mobile values live in `src/theme/typography.ts` (`fontSize`, `textStyles`) — never type a Figma size by hand.

| Figma | Project |
|---|---|
| text style (`Body/M B-1`, `Headings/H-6`, …) | `...textStyles.MB1`, `...textStyles.H6` (lookup: `figmaTextStyle`) |
| text style + bold override | `...textStyle('MB1', '700')` |
| bare `Size/*` variable | `fontSize: fs(fontSize.lg)` + `fontFamily: ff(...)` |
| `Family/Headings` / `Family/Body` | `ff('Montserrat', w)` / `ff('Inter', w)` from `src/theme/fonts.ts` |

Don't use the old `typography` export in `src/styles/theme.ts` — it predates the Figma file and its sizes don't match.

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
  import { textStyles, textStyle, fontSize } from '../theme/typography';
  import { ff, fs } from '../theme/fonts';
  import { colors, borderRadius, shadows } from '../styles/theme';
  import { scale, verticalScale } from '../utils/responsive';
  ```
  (There is no `src/theme/colors.ts`, `borderRadius.ts` or `shadows.ts`. The color / radius / shadow tables below name keys that don't exist in `src/styles/theme.ts` either — check the file before using one.)

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
- Type a raw `fontSize: <number>` for Figma text — use `textStyles` / `fontSize` from `src/theme/typography.ts`
- Set `fontWeight` on native for weight ≥ 500 (Android adds synthetic bold on top of `Inter-Bold`); `textStyles` already handles this

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
