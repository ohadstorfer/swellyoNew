/**
 * Tiny module-level bus for the in-app banner overlay. Zero React, zero
 * subscriptions — any module calls showInAppBanner(); the single mounted
 * InAppBannerHost is the subscriber. Last-write-wins (replace policy),
 * consecutive same-id calls are deduped.
 */
export type InAppBannerPayload = {
  /** Dedupe key: notification id or message id. */
  id: string;
  avatarUrl?: string;
  title: string;
  body: string;
  onPress?: () => void;
};

let listener: ((p: InAppBannerPayload) => void) | null = null;
let lastShownId: string | null = null;

export function showInAppBanner(p: InAppBannerPayload): void {
  if (p.id === lastShownId) return;
  lastShownId = p.id;
  listener?.(p);
}

/** Single host: a new subscriber replaces the previous one. */
export function subscribeInAppBanner(l: (p: InAppBannerPayload) => void): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}

export function __resetInAppBannerBusForTests(): void {
  listener = null;
  lastShownId = null;
}
