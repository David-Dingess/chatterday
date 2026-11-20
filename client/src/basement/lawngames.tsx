// The backyard's lawn games, for the yard's page (backyard.tsx) to place in one go: beer pong on the patio, horseshoes
// and bocce on the lawn (pong.tsx, shoes.tsx, bocce.tsx). None of them looks at the grass.
import { BocceRoom, pose as boccePose } from './bocce.tsx';
import { PongRoom, pose as pongPose } from './pong.tsx';
import { ShoesRoom, pose as shoesPose } from './shoes.tsx';
import type { FitPose } from './index';

export function LawnGames({ mini, light }: { mini: boolean; light: number }) {
  return (
    <>
      <PongRoom mini={mini} light={light} />
      <ShoesRoom mini={mini} light={light} />
      <BocceRoom mini={mini} light={light} />
    </>
  );
}
/** How somebody playing one of them is drawn just now (stood at their place, facing the play, throwing), or null. */
export const lawnPose = (uid: string): FitPose | null => pongPose(uid) ?? shoesPose(uid) ?? boccePose(uid);
