// Click-to-locate: take the god camera to where a news item happened and
// open the inspector on its subject. A guest is followed to where they stand
// now; an object, or a guest who has since left, is looked at where it was.

import type { SimClient } from '../../client/SimClient';
import type { PlayerControls } from '../../input/PlayerControls';
import type { Stage } from '../../render/Stage';
import { AGENT_STRIDE, AgentKind, type Snapshot } from '../../shared/contracts';
import type { SidePanel } from '../SidePanel';
import type { NewsPlace } from './newsQueue';

/** Close enough to read the subject, far enough to see what's around it. */
const LOCATE_DISTANCE = 16;

/** A guest's position in a snapshot, or null when they are no longer on the floor. */
export function guestPosition(
  snap: Snapshot | null,
  agentId: number,
): { x: number; z: number } | null {
  if (!snap) return null;
  const a = snap.agents;
  for (let i = 0; i < snap.agentCount; i++) {
    const o = i * AGENT_STRIDE;
    if (a[o + 7] === agentId && a[o + 4] === AgentKind.Guest) return { x: a[o]!, z: a[o + 1]! };
  }
  return null;
}

export interface LocateDeps {
  sim: SimClient;
  controls: PlayerControls;
  stage: Stage;
  panel: SidePanel;
}

/** Returns false when the camera can't move: the player is seated at a game. */
export function locate(place: NewsPlace, d: LocateDeps): boolean {
  const { director, god } = d.controls;
  if (director.mode === 'seat') return false;
  const live = place.agentId !== undefined ? guestPosition(d.sim.curr, place.agentId) : null;
  const p = live ?? place;
  if (director.mode !== 'god') director.setMode('god');
  god.focusOn(p.x, p.z, LOCATE_DISTANCE);
  if (live) {
    d.panel.inspect({ agentId: place.agentId! });
  } else if (place.objectId) {
    const objectId = place.objectId;
    // Only select what still exists: a sold machine's news still has a place.
    void d.sim
      .command({ type: 'inspect', target: { objectId } })
      .then(() => {
        d.stage.setSelected(objectId);
        d.panel.inspect({ objectId });
      })
      .catch(() => {});
  }
  return true;
}
