// -----------------------------------------------------------------------------
// Trip vocabulary — the single source of truth for how the three trip flows are
// named to users: Crew · Captain · Operator (together · led · business).
//
// The flows stay keyed internally as HostingStyle 'A' | 'B' | 'C' (a stable DB
// column). Everything users READ comes from here, so the three flows have one
// consistent identity across the Create chooser, Explore, and the Overview.
//
// See docs/trip-vocabulary-spec.md for the full voice.
// -----------------------------------------------------------------------------
import type { HostingStyle } from './groupTripsService';

/** A=Crew, B=Captain, C=Operator. The bare word. */
export const TRIP_TYPE_WORD: Record<HostingStyle, string> = {
  A: 'Crew',
  B: 'Captain',
  C: 'Operator',
};

/** Compact tag for Explore cards. Viewer-facing ("how this trip is run"). */
export const TRIP_TYPE_PILL: Record<HostingStyle, string> = {
  A: 'Crew',
  B: 'Captained',
  C: 'Operator',
};

/** Accent colour for the trip-type tag (Crew=brand blue, Captain=purple, Operator=gold). */
export const TRIP_TYPE_COLOR: Record<HostingStyle, string> = {
  A: '#05BCD3',
  B: '#B72DF2',
  C: '#E0A800',
};

/**
 * Diagonal gradient per trip type so the tag reads as a glossy chip. Operator
 * is a metallic gold (bright highlight → deep gold) so it looks shiny, not flat.
 */
export const TRIP_TYPE_GRADIENT: Record<HostingStyle, readonly [string, string, string]> = {
  A: ['#45DDEC', '#05BCD3', '#0399AB'],
  B: ['#CB63F5', '#B72DF2', '#9A14D6'],
  C: ['#FCE489', '#E8B11C', '#B8860B'],
};

/** "How it's run" byline for the Overview "Trip type" chip. */
export const TRIP_TYPE_BYLINE: Record<HostingStyle, string> = {
  A: 'By the crew',
  B: 'Captained',
  C: 'By an operator',
};

/** The creator's role, lowercase, for inline copy ("As the Captain, …"). */
export const TRIP_ROLE_NOUN: Record<HostingStyle, string> = {
  A: 'the crew',
  B: 'the Captain',
  C: 'the operator',
};

/** Create-tab chooser cards — creator-facing ("how do you want to run it?"). */
export const TRIP_CHOOSER: Record<HostingStyle, { title: string; desc: string }> = {
  A: {
    title: 'Crew',
    desc: 'Planned together.\nThe crew votes on key calls — you approve what moves forward.',
  },
  B: {
    title: 'Captain',
    desc: 'You lead the way.\nYou set the plan, surfers join and support it.',
  },
  C: {
    title: 'Operator',
    desc: 'Run like a business.\nEverything’s set — surfers join knowing exactly what to expect.',
  },
};
