// The picture the room shows for a game somebody is sharing. While they share their screen with a game in front, the
// projector and the TVs over the bar downstairs show a screen for that kind of game in place of the still of their
// screen. The screens are drawn by scripts/make-game-screens.py (a genre each, in the room's dots: no real game's art)
// into /clubhouse/games/: <kind>.png for the projector and <kind>-<w>x<h>.png for each TV. The kind is guessed from
// what the desktop app calls the game (its product name, window title or program name) by plain genre words; anything
// else gets the arcade screen. To add a kind: draw it in the script, then add a line here.
import type { Presence } from './types';

/** Words in a game's name, and the kind of screen they mean. The first that matches wins. */
const KINDS: [RegExp, string][] = [
  [/shoot|sniper|gun|strike|warfare|battle ?royale|\bfps\b|commando|tactical|squad|deathmatch/i, 'shooter'],
  [/kart|rac(e|er|ing)|rally|drift|speed|motor|driv(e|er|ing)|grand prix|\bcar(s)?\b/i, 'racing'],
  [/card|deck|poker|solitaire|blackjack|hearts|spades|rummy|chess|checkers|mahjong|board|tactics|strategy|tabletop/i, 'cards'],
  [/rpg|quest|dungeon|dragon|legend|fantasy|sword|knight|exile|realm|kingdom|souls|hero|mmo|online|craft\b/i, 'rpg'],
  [/soccer|football|futbol|basketball|hockey|golf|tennis|baseball|sports?|league|\bball\b|match|goal|bowling/i, 'sports'],
  [/block|cube|voxel|build|mine|sandbox|survival|farm|island|colony|world/i, 'blocks'],
];

/** The kind of screen for a game by that name: one of KINDS, or the arcade screen. */
export const gameOf = (label: string | undefined): string | null => {
  const name = (label ?? '').trim();
  if (!name) return null;
  return KINDS.find(([re]) => re.test(name))?.[1] ?? 'arcade';
};

/** The picture's address: the projector's, or the small one for a screen w by h dots. */
export const gameShot = (game: string, w?: number, h?: number) => `/clubhouse/games/${game}${w && h ? `-${w}x${h}` : ''}.png`;

/** The screen for the game somebody sharing their screen is in: what goes up for their share. */
export const sharedGame = (p: Presence | undefined): string | null => (p?.voice?.sharing && p.state === 'gaming' ? gameOf(p.label) : null);
