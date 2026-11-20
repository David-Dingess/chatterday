// Where are you? The places somebody can say they are, with their icon and their words (the desktop's button uses
// these), two to a row as the list shows them. Picking the one you are at again takes
// it back: then nothing is chosen, and the button says AT_COMPUTER.
import type { IconName } from './components/ui';
import type { Place } from './types';

export const AT_COMPUTER: [Place, IconName, string] = ['', 'here', 'At Computer'];
export const PLACES: [Place, IconName, string][] = [
  ['imhere', 'here', "I'm here"], ['chillin', 'smile', 'Chillin'],            // (the same thing: off the desk, on a bean bag or in the living room)
  ['working', 'work', 'Working'], ['bathroom', 'drop', 'Bathroom'],
  ['vcall', 'video', 'Video Call'], ['calling', 'call', 'On the Phone'],
  ['gaming', 'gamepad', 'Gaming'], ['watching', 'eye', 'Watching'],
  ['prompting', 'prompt', 'Prompting'], ['doomscrolling', 'doom', 'Doomscrolling'],
  ['cleaning', 'broom', 'Cleaning'], ['kitchen', 'pan', 'Making Food'],
  ['exercising', 'dumbbell', 'Exercising'], ['showering', 'shower', 'Showering'],
  ['sleeping', 'sleep', 'Sleeping'], ['away', 'clock', 'Away'],
];
