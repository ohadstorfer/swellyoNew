---
name: Chat Bubble Inline Timestamp Layout
description: The "float-right inside block" technique used by Telegram Web A for WhatsApp-style inline timestamps, and its React Native adaptation
type: reference
---

## The Canonical Web Technique — "Float-Right Inside Block"

Source: Telegram Web A (_message-content.scss) — https://github.com/Ajaxy/telegram-tt

The MessageMeta (timestamp + read ticks) element is placed as a **direct child of the same block-level container** as `.text-content` (the message text div). It uses:

```css
.MessageMeta {
  position: relative;
  top: 0.375rem;       /* vertical alignment fudge to sit on text baseline */
  float: right;
  height: calc(var(--message-meta-height, 1rem));
  margin-right: -0.375rem;
  margin-left: 0.4375rem;   /* gap between text and timestamp */
  line-height: 1.35;
}
```

The `.text-content` container has:
```css
display: block;
overflow-wrap: anywhere;
white-space: pre-wrap;
```

**The trick**: `float: right` is placed BEFORE the text content in DOM order (or equivalently the float is inside the same block). CSS float mechanics cause text to wrap around the floated element — crucially, only on the lines where the float is present (the last line(s)), NOT on lines above it. Lines above use the full block width because the float has already "moved past" them. This is standard CSS float-in-block behavior, not a hack.

**Why lines above use full width**: A floated element participates in line formatting only from its vertical position downward. Text above the float position uses the full content width. Text at and below the float's vertical extent wraps around it.

**DOM order in telegram-tt**: The `.MessageMeta` span is rendered as a sibling AFTER `.text-content` but inside the same parent block — the CSS float pulls it to the right and text in the block wraps around it.

**Timestamp width calibration**: Telegram renders the timestamp as a fixed-content span (formatted time string + icon glyphs). No JS measurement needed — the float width is inherent to the rendered content.

## React Native Adaptation

RN has no `float` property. The equivalent technique uses nested `<Text>` inside `<Text>` — in RN, everything inside a `<Text>` uses inline/text layout, not Yoga flexbox.

**The RN equivalent of float-right-in-block:**

```jsx
<Text style={styles.messageText}>
  {messageText}
  {/* Invisible spacer — same width as timestamp — appended at end of text flow */}
  <Text style={styles.timestampSpacer}>{' ' + timestampString + ticksPlaceholder}</Text>
</Text>

{/* Actual timestamp, absolutely positioned bottom-right */}
<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <Text style={styles.timestampReal}>{timestampString} {ticks}</Text>
</View>
```

**Why the spacer works**: In RN `<Text>`, a nested `<Text>` at the END of the text content flows inline. It pushes the line it lands on to wrap (because the visible spacer + timestamp width occupies space), reserving room. The actual timestamp is absolutely overlaid on top. Lines above are not affected because the spacer only pushes the LAST line.

**Spacer content**: Either a transparent/invisible `<Text>` with the same string as the timestamp (opacity:0 or color:transparent), or just a fixed-width whitespace string. The invisible spacer must have the same font size and content as the real timestamp so the reserved width matches.

## Known Limitations

- **RTL**: Telegram inverts the float direction (`float: left` for RTL content). In RN the spacer approach also requires RTL handling — spacer must go at the FRONT of text for RTL messages.
- **Font size changes**: If font size changes after first render, the spacer width may not match. Use the same fontSize on both spacer and real timestamp.
- **Edited badge / ticks changing width**: If ticks/edited badge can appear/disappear, the spacer content must account for the max possible width to avoid re-layout jitter.
- **Very short messages (single emoji / 1–2 chars)**: The bubble may be narrower than the timestamp. Need a `minWidth` on the bubble equal to timestamp width + padding.
- **Long unbreakable words**: `overflow-wrap: anywhere` (web) / no RN equivalent — RN breaks on spaces by default; long URLs may overflow.
- **Web (RN Web)**: On RN Web the nested Text float-spacer trick still works because RN Web also uses inline text layout for nested Text elements.

## Sources

- Telegram Web A source: https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/message/_message-content.scss
- MessageMeta component: https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/message/MessageMeta.tsx
