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
 * Solid fill + on-fill colour for the Explore card trip-type tag
 * (Figma 14348:28785 · 28794 · 28790). Flat colour, no gradient: Crew is plain
 * white with dark text, Captain and Operator are saturated with white text.
 */
export const TRIP_TYPE_TAG: Record<HostingStyle, { bg: string; fg: string }> = {
  A: { bg: '#FFFFFF', fg: '#333333' },
  B: { bg: '#05BCD3', fg: '#FFFFFF' },
  C: { bg: '#B72DF2', fg: '#FFFFFF' },
};

/**
 * Diagonal gradient per trip type so the tag reads as a glossy chip. Operator
 * is a metallic gold (bright highlight → deep gold) so it looks shiny, not flat.
 * Still used by the trip Overview tag; Explore uses TRIP_TYPE_TAG.
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
    desc: 'A trip with friends.\nIt’s the crew’s trip - you plan it together and vote on the key calls.',
  },
  B: {
    title: 'Captain',
    desc: 'You lead the way.\nYou’ve got a plan in mind - surfers hop on, join the ride, and help bring it to life.',
  },
  C: {
    title: 'Operator',
    desc: 'For surf trip operating businesses.\nEverything’s set - surfers join knowing exactly what to expect.',
  },
};
