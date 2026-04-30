// Stable per-user color for the sender-name label in group chats.
// Hashes the user id to a small palette tuned to read on both bubble fills.

const PALETTE = [
  '#E6705F', // warm coral
  '#F2C75C', // mustard
  '#7AC7A4', // mint
  '#5FB3E6', // sky
  '#9D7AE6', // lavender
  '#E67AB5', // pink
  '#5FE6C7', // teal
  '#E6A85F', // amber
];

export function getSenderColor(senderId: string): string {
  if (!senderId) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = (hash * 31 + senderId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}
