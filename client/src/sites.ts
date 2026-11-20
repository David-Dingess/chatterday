// Where a Player item plays from: YouTube, whose ids are 11 characters.

/** A still of it. */
export function thumbOf(videoId: string): string | null {
  return /^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
}
