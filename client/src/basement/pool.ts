/* PURE engine for the PLAY "8-Ball Pool" minigame — physics + 8-ball rules + a medium AI.
 *
 * Top-down, like a real table. All physics run in a fixed virtual space (PLAY_W×PLAY_H, a 2:1
 * playfield) with no React/DOM, mirroring lib/baseball.ts and lib/crane.ts: `step()` mutates the
 * world in place and is unit-testable; the PoolGame component owns only the rAF loop, pointer input,
 * and drawing.
 *
 * Motion: each ball rolls with exponential friction plus a small constant drag (so a shot dies away at the end
 * instead of creeping for seconds) until it stops. Balls are equal-mass circles
 * that collide elastically (normal-component swap + positional de-overlap, adapted from crane.ts).
 * Six pockets capture any ball whose centre enters their mouth; the four rails reflect otherwise.
 * The whole integration is sub-stepped so a hard break can't tunnel through a ball or a cushion.
 *
 * Spin: `shoot` may be given where the tip struck the cue ball ({x, y} in [-1, 1], y up = top). Top or
 * bottom (follow / draw) acts once, on the cue ball's first contact with a ball: it is pushed on (or pulled back) along
 * the way it was going, by a share of its speed at the moment of impact. Side acts at each cushion the cue ball meets,
 * pushing it along the rail, and halves each time. Both fade as the shot goes on (SPIN_TAU). A world saved before spin
 * existed has none: read `w.spin ?? NO_SPIN`.
 *
 * Rules (casual 8-ball): rack + break, open table until the first legal pot assigns groups, hit your
 * group first, clear your seven then legally pocket the 8 to win. Scratching (cue potted) or hitting
 * the wrong ball first is a foul → opponent gets ball-in-hand. Pocketing the 8 early — or scratching
 * on the 8 — loses. `step()` only moves balls; when everything stops it flips to phase 'resolved' and
 * the caller runs `resolveTurn()`, which applies the rules and hands off (or ends) the turn.
 */

export const PLAY_W = 900
export const PLAY_H = 450

export const BALL_R = 11
/** Corner pockets are a touch tighter than the side pockets (wider mouth on the long rail). */
export const CORNER_POCKET_R = 20
export const SIDE_POCKET_R = 22

/** Head spot (cue) and foot spot (rack apex), on the long axis centre-line. */
export const HEAD_X = PLAY_W * 0.26
export const FOOT_X = PLAY_W * 0.72
export const MID_Y = PLAY_H / 2

/** Shot speed (virtual units/sec) mapped from the 0..1 power the player/AI dials in. */
export const MIN_SHOT_SPEED = 420
export const MAX_SHOT_SPEED = 2350

/** Velocity exponential-decay time constant (s) — rolling friction. Cushion + ball restitution. */
const FRICTION_TAU = 0.95
/** A constant drag (units/s²) on top of it: the slow last creep of a ball is cut short. */
const DECEL = 60
/** Spin: how much follow/draw and side are worth, and how fast they wear off (s). */
const FOLLOW = 0.45
const SIDE = 0.25
const SPIN_TAU = 0.6
export const NO_SPIN = { x: 0, y: 0 }
const CUSHION_RESTITUTION = 0.9
const CUSHION_FRICTION = 0.98
const BALL_RESTITUTION = 0.95
/** Below this speed a ball is treated as stopped. */
const STOP_SPEED = 7
/** Safety: a shot can't simulate longer than this. */
const MAX_SHOT_MS = 12000

/** Prize id for the "Pool Shark" trophy (run the table in a single turn). Persisted in `prizes`. */
export const POOL_TROPHY_ID = 'pool-shark'

export type Group = 'solid' | 'stripe'
export type BallKind = 'cue' | 'solid' | 'eight' | 'stripe'
export type Phase = 'aim' | 'shooting' | 'resolved' | 'gameover'
export type Side = 'user' | 'ai'

export interface Ball {
  /** 0 = cue, 1–7 solids, 8 = eight, 9–15 stripes. */
  num: number
  kind: BallKind
  x: number
  y: number
  vx: number
  vy: number
  potted: boolean
}

export interface Pocket {
  x: number
  y: number
  r: number
  /** Which rails this pocket sits on, so a ball near its mouth skips cushion reflection. */
  onLeft: boolean
  onRight: boolean
  onTop: boolean
  onBottom: boolean
}

/** What happened on the shot just resolved — drives the HUD, ticket payout, and turn hand-off. */
export interface ShotOutcome {
  shooter: Side
  /** Object balls (excludes cue + 8) the shooter legally pocketed this shot. */
  pottedOwn: number
  /** All object-ball numbers pocketed this shot (for the log/animation). */
  potted: number[]
  scratch: boolean
  foul: boolean
  keptTurn: boolean
  /** A short human-readable line for the on-table message. */
  event: string
}

export interface PoolWorld {
  balls: Ball[]
  phase: Phase
  turn: Side
  /** Solids/stripes not yet decided. */
  open: boolean
  /** The user's assigned group once the table is closed (AI gets the other). */
  userGroup: Group | null
  /** True when the current shooter may place the cue anywhere (after a foul / on the break-in). */
  ballInHand: boolean
  /** True only for the very first shot of the match (pocketing the 8 on it is harmless). */
  isBreak: boolean
  /** How many distinct turns the USER has taken (kept for stats; not the trophy signal). */
  userTurns: number
  /** How many of the opponent's own balls the AI has legally sunk — the Pool Shark trophy is earned
   *  by winning while this is still under 3. */
  aiBallsSunk: number
  /** null until the match ends. */
  result: { winner: Side; reason: string } | null
  message: string
  /** Set by resolveTurn each time a shot is adjudicated (read by the activity for tickets). */
  lastShot: ShotOutcome | null
  /** Per-shot tracking, reset in `shoot`. */
  shot: {
    firstHit: number | null
    potted: number[]
    scratch: boolean
    cushionAfterContact: boolean
  }
  shotMs: number
  /** Where the tip struck the cue ball on the shot under way (absent on worlds saved before spin). */
  spin?: { x: number; y: number }
}

export function kindOf(num: number): BallKind {
  if (num === 0) return 'cue'
  if (num === 8) return 'eight'
  return num < 8 ? 'solid' : 'stripe'
}

export const other = (s: Side): Side => (s === 'user' ? 'ai' : 'user')
const otherGroup = (g: Group): Group => (g === 'solid' ? 'stripe' : 'solid')

/** The group the given side is shooting (null while the table is open). */
export function groupOf(w: PoolWorld, side: Side): Group | null {
  if (w.userGroup == null) return null
  return side === 'user' ? w.userGroup : otherGroup(w.userGroup)
}

/** Object balls of a group still on the table. */
function remainingOfGroup(w: PoolWorld, g: Group): number {
  return w.balls.filter((b) => !b.potted && kindOf(b.num) === g).length
}

/** True once the side has cleared its seven and is now shooting at the 8. */
export function isOnEight(w: PoolWorld, side: Side): boolean {
  const g = groupOf(w, side)
  return g != null && remainingOfGroup(w, g) === 0
}

/** Standard 8-ball colours (solids full, stripes a band of the same hue on white). */
export const BALL_COLORS: Record<number, string> = {
  1: '#f4c20d',
  2: '#1f57c3',
  3: '#d31f2b',
  4: '#6a2c8f',
  5: '#e2711d',
  6: '#1c7d45',
  7: '#8c2c2c',
  8: '#151515',
  9: '#f4c20d',
  10: '#1f57c3',
  11: '#d31f2b',
  12: '#6a2c8f',
  13: '#e2711d',
  14: '#1c7d45',
  15: '#8c2c2c',
}

export function pockets(): Pocket[] {
  const c = CORNER_POCKET_R
  const s = SIDE_POCKET_R
  return [
    { x: 0, y: 0, r: c, onLeft: true, onRight: false, onTop: true, onBottom: false },
    { x: PLAY_W, y: 0, r: c, onLeft: false, onRight: true, onTop: true, onBottom: false },
    { x: 0, y: PLAY_H, r: c, onLeft: true, onRight: false, onTop: false, onBottom: true },
    { x: PLAY_W, y: PLAY_H, r: c, onLeft: false, onRight: true, onTop: false, onBottom: true },
    { x: PLAY_W / 2, y: 0, r: s, onLeft: false, onRight: false, onTop: true, onBottom: false },
    { x: PLAY_W / 2, y: PLAY_H, r: s, onLeft: false, onRight: false, onTop: false, onBottom: true },
  ]
}

const POCKETS = pockets()

/** A legal rack: 8-ball in the centre, the two back corners from different groups. */
const RACK_ROWS: number[][] = [[1], [9, 2], [10, 8, 3], [11, 4, 12, 5], [6, 13, 7, 14, 15]]

/** Build the opening table. `userBreaks` decides who shoots first (a coin-flip in the activity). */
export function initWorld(userBreaks: boolean): PoolWorld {
  const balls: Ball[] = [
    { num: 0, kind: 'cue', x: HEAD_X, y: MID_Y, vx: 0, vy: 0, potted: false },
  ]
  // Rack the triangle at the foot spot, apex pointing back toward the cue (rows grow to the right).
  const gap = BALL_R * 2 + 0.5
  const rowDX = gap * Math.cos(Math.PI / 6)
  for (let row = 0; row < RACK_ROWS.length; row++) {
    const nums = RACK_ROWS[row]
    const x = FOOT_X + row * rowDX
    const top = MID_Y - ((nums.length - 1) * gap) / 2
    for (let i = 0; i < nums.length; i++) {
      const num = nums[i]
      balls.push({ num, kind: kindOf(num), x, y: top + i * gap, vx: 0, vy: 0, potted: false })
    }
  }

  return {
    balls,
    phase: 'aim',
    turn: userBreaks ? 'user' : 'ai',
    open: true,
    userGroup: null,
    ballInHand: false,
    isBreak: true,
    userTurns: userBreaks ? 1 : 0,
    aiBallsSunk: 0,
    result: null,
    message: userBreaks ? 'Your break' : 'Opponent breaks',
    lastShot: null,
    shot: { firstHit: null, potted: [], scratch: false, cushionAfterContact: false },
    shotMs: 0,
  }
}

export const cueBall = (w: PoolWorld): Ball => w.balls[0]

/** Place the cue ball (ball-in-hand). Clamped inside the rails; the caller checks legality of spot. */
export function placeCue(w: PoolWorld, x: number, y: number): void {
  const cue = cueBall(w)
  cue.x = Math.max(BALL_R, Math.min(PLAY_W - BALL_R, x))
  cue.y = Math.max(BALL_R, Math.min(PLAY_H - BALL_R, y))
  cue.vx = 0
  cue.vy = 0
}

/** True if the cue ball at (x,y) overlaps any object ball (used to validate a ball-in-hand drop). */
export function cueOverlaps(w: PoolWorld, x: number, y: number): boolean {
  for (const b of w.balls) {
    if (b.num === 0 || b.potted) continue
    if (Math.hypot(b.x - x, b.y - y) < BALL_R * 2) return true
  }
  return false
}

/** Optional impact-sound sink — PoolGame wires the site SFX in; the default no-op keeps the
 *  physics pure for tests. `intensity` is 0–1, scaled from impact speed. */
export type PoolSound = 'ball' | 'rail' | 'pocket'
let soundSink: ((kind: PoolSound, intensity: number) => void) | null = null
export function setPoolSoundSink(cb: ((kind: PoolSound, intensity: number) => void) | null): void {
  soundSink = cb
}

/** The launch speed for a power in [0, 1]. */
export const speedOf = (power: number) => MIN_SHOT_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SHOT_SPEED - MIN_SHOT_SPEED)

/** Fire the cue ball at `angle` (radians) with `power` in [0,1], struck at `spin` (see the top). No-op unless aiming. */
export function shoot(w: PoolWorld, angle: number, power: number, spin: { x: number; y: number } = NO_SPIN): void {
  if (w.phase !== 'aim') return
  const speed = speedOf(power)
  const cue = cueBall(w)
  cue.vx = Math.cos(angle) * speed
  cue.vy = Math.sin(angle) * speed
  w.ballInHand = false
  w.phase = 'shooting'
  w.shotMs = 0
  w.shot = { firstHit: null, potted: [], scratch: false, cushionAfterContact: false }
  w.spin = { x: Math.max(-1, Math.min(1, spin.x || 0)), y: Math.max(-1, Math.min(1, spin.y || 0)) }
}

/** What is left of the spin just now, this far into the shot. */
const spinLeft = (w: PoolWorld) => Math.exp(-w.shotMs / 1000 / SPIN_TAU)

/** Side spin at a cushion: the cue ball is pushed along the rail, to its right for right-hand side (as it was going),
 *  by a share of its speed. `tx, ty` is the rail's direction. */
function sideAtRail(b: Ball, w: PoolWorld, vx: number, vy: number, tx: number, ty: number): void {
  const sp = w.spin
  if (b.num !== 0 || !sp || !sp.x) return
  const speed = Math.hypot(vx, vy)
  if (!speed) return
  const rx = -vy / speed, ry = vx / speed                 // its right, as it came in (y is down the screen)
  const along = (rx * tx + ry * ty) * SIDE * sp.x * spinLeft(w) * speed
  b.vx += tx * along
  b.vy += ty * along
  sp.x *= 0.5
}

function maxSpeed(w: PoolWorld): number {
  let m = 0
  for (const b of w.balls) {
    if (b.potted) continue
    const s = Math.hypot(b.vx, b.vy)
    if (s > m) m = s
  }
  return m
}

/** Distance from (x,y) to the nearest pocket centre. */
function nearestPocketDist(x: number, y: number): number {
  let m = Infinity
  for (const p of POCKETS) {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d < m) m = d
  }
  return m
}

/** Reflect a moving ball off the four rails, unless it's in a pocket's mouth (then let it drop). */
function cushions(b: Ball, w: PoolWorld): void {
  // Near a pocket mouth the rail is cut away — skip reflection so the ball can be captured.
  if (nearestPocketDist(b.x, b.y) < SIDE_POCKET_R * 1.6) return
  const vx0 = b.vx, vy0 = b.vy
  if (b.x < BALL_R && b.vx < 0) {
    sideAtRail(b, w, vx0, vy0, 0, 1)
    b.x = BALL_R
    b.vx = -b.vx * CUSHION_RESTITUTION
    b.vy *= CUSHION_FRICTION
    railContact(w)
    soundSink?.('rail', Math.min(1, Math.abs(b.vx) / MAX_SHOT_SPEED))
  } else if (b.x > PLAY_W - BALL_R && b.vx > 0) {
    sideAtRail(b, w, vx0, vy0, 0, 1)
    b.x = PLAY_W - BALL_R
    b.vx = -b.vx * CUSHION_RESTITUTION
    b.vy *= CUSHION_FRICTION
    railContact(w)
    soundSink?.('rail', Math.min(1, Math.abs(b.vx) / MAX_SHOT_SPEED))
  }
  if (b.y < BALL_R && b.vy < 0) {
    sideAtRail(b, w, vx0, vy0, 1, 0)
    b.y = BALL_R
    b.vy = -b.vy * CUSHION_RESTITUTION
    b.vx *= CUSHION_FRICTION
    railContact(w)
    soundSink?.('rail', Math.min(1, Math.abs(b.vy) / MAX_SHOT_SPEED))
  } else if (b.y > PLAY_H - BALL_R && b.vy > 0) {
    sideAtRail(b, w, vx0, vy0, 1, 0)
    b.y = PLAY_H - BALL_R
    b.vy = -b.vy * CUSHION_RESTITUTION
    b.vx *= CUSHION_FRICTION
    railContact(w)
    soundSink?.('rail', Math.min(1, Math.abs(b.vy) / MAX_SHOT_SPEED))
  }
}

function railContact(w: PoolWorld): void {
  if (w.shot.firstHit != null) w.shot.cushionAfterContact = true
}

/** Capture a ball whose centre entered a pocket mouth. Returns true if it was pocketed this call. */
function tryPocket(b: Ball, w: PoolWorld): boolean {
  for (const p of POCKETS) {
    if (Math.hypot(p.x - b.x, p.y - b.y) < p.r) {
      b.potted = true
      soundSink?.('pocket', Math.min(1, Math.hypot(b.vx, b.vy) / 900))
      b.vx = 0
      b.vy = 0
      if (b.num === 0) w.shot.scratch = true
      else w.shot.potted.push(b.num)
      return true
    }
  }
  return false
}

/** Elastic equal-mass response for two overlapping balls, with positional de-overlap. */
function collide(a: Ball, b: Ball, w: PoolWorld): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  const min = BALL_R * 2
  if (dist === 0 || dist >= min) return
  const nx = dx / dist
  const ny = dy / dist
  // De-overlap: push each ball out by half the penetration.
  const overlap = min - dist
  a.x -= nx * overlap * 0.5
  a.y -= ny * overlap * 0.5
  b.x += nx * overlap * 0.5
  b.y += ny * overlap * 0.5
  // Exchange the velocity component along the contact normal (equal masses).
  const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (rvn >= 0) return // separating already
  // The cue ball's first contact this shot: as it came in (for follow / draw, below).
  const first = w.shot.firstHit == null && (a.num === 0 || b.num === 0)
  const cueB = a.num === 0 ? a : b
  const inX = cueB.vx, inY = cueB.vy
  const imp = -(1 + BALL_RESTITUTION) * rvn * 0.5
  a.vx -= imp * nx
  a.vy -= imp * ny
  b.vx += imp * nx
  b.vy += imp * ny
  // Audible clack only for real impacts — grazing/settling contacts stay quiet.
  if (-rvn > STOP_SPEED * 6) soundSink?.('ball', Math.min(1, -rvn / MAX_SHOT_SPEED))
  // Record the cue's first contact this shot (for foul adjudication), and play its follow or draw.
  if (first) {
    w.shot.firstHit = a.num === 0 ? b.num : a.num
    const sp = w.spin, speed = Math.hypot(inX, inY)
    if (sp && sp.y && speed > 0) {
      const push = FOLLOW * sp.y * spinLeft(w) * speed
      cueB.vx += (inX / speed) * push
      cueB.vy += (inY / speed) * push
      sp.y = 0
    }
  }
}

export function step(w: PoolWorld, dt: number): PoolWorld {
  if (w.phase !== 'shooting') return w
  w.shotMs += dt
  const dtSec = dt / 1000
  const spd = maxSpeed(w)
  if (spd < STOP_SPEED) {
    for (const b of w.balls) {
      b.vx = 0
      b.vy = 0
    }
    w.phase = 'resolved'
    return w
  }

  const sub = Math.max(1, Math.min(16, Math.ceil((spd * dtSec) / (BALL_R * 0.5))))
  const sdt = dtSec / sub
  const damp = Math.exp(-sdt / FRICTION_TAU)

  for (let s = 0; s < sub; s++) {
    for (const b of w.balls) {
      if (b.potted) continue
      b.vx *= damp
      b.vy *= damp
      const v = Math.hypot(b.vx, b.vy)
      if (v > 0) {
        const k = Math.max(0, v - DECEL * sdt) / v
        b.vx *= k
        b.vy *= k
      }
      b.x += b.vx * sdt
      b.y += b.vy * sdt
      if (tryPocket(b, w)) continue
      cushions(b, w)
    }
    // Pairwise collisions (a couple of relaxation passes for stable multi-ball contacts).
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < w.balls.length; i++) {
        const a = w.balls[i]
        if (a.potted) continue
        for (let j = i + 1; j < w.balls.length; j++) {
          const b = w.balls[j]
          if (b.potted) continue
          collide(a, b, w)
        }
      }
    }
  }

  if (w.shotMs > MAX_SHOT_MS) {
    for (const b of w.balls) {
      b.vx = 0
      b.vy = 0
    }
    w.phase = 'resolved'
  }
  return w
}

/** Respot the cue on the head spot after a scratch (nudged if the spot is occupied). */
function respotCue(w: PoolWorld): void {
  const cue = cueBall(w)
  cue.potted = false
  cue.vx = 0
  cue.vy = 0
  let x = HEAD_X
  const y = MID_Y
  while (cueOverlaps(w, x, y) && x > BALL_R * 2) x -= BALL_R
  cue.x = x
  cue.y = y
}

/**
 * Adjudicate the shot that just stopped (phase must be 'resolved'). Applies group assignment, fouls,
 * win/lose, and hands the turn off. Mutates + returns the world; sets `w.lastShot` for the caller.
 */
export function resolveTurn(w: PoolWorld): PoolWorld {
  if (w.phase !== 'resolved') return w
  const shooter = w.turn
  const wasBreak = w.isBreak
  w.isBreak = false

  const shot = w.shot
  const pottedObjects = shot.potted.filter((n) => n !== 8)
  const potted8 = shot.potted.includes(8)
  const remBefore = (() => {
    // Group remaining BEFORE this shot's pots were applied (balls are already flagged potted, so add
    // back this shot's own-group pots). Only meaningful once the table is closed.
    const g = groupOf(w, shooter)
    if (g == null) return null
    const onTable = remainingOfGroup(w, g)
    const pottedThisShot = pottedObjects.filter((n) => kindOf(n) === g).length
    return onTable + pottedThisShot
  })()

  // --- Foul detection ---
  let foul = false
  let event = ''
  if (shot.firstHit == null) {
    foul = true
    event = 'Foul — no ball hit'
  } else if (!w.open && groupOf(w, shooter) != null) {
    const g = groupOf(w, shooter)!
    const onEight = remBefore === 0
    const hitKind = kindOf(shot.firstHit)
    if (onEight && shot.firstHit !== 8) {
      foul = true
      event = 'Foul — hit the wrong ball'
    } else if (!onEight && shot.firstHit === 8) {
      foul = true
      event = 'Foul — hit the 8 early'
    } else if (!onEight && hitKind !== g) {
      foul = true
      event = 'Foul — hit the wrong group'
    }
  }
  // Rail-or-pot: after contact, something must be pocketed or reach a rail.
  if (!foul && pottedObjects.length === 0 && !potted8 && !shot.cushionAfterContact) {
    foul = true
    event = 'Foul — no rail after contact'
  }
  if (shot.scratch) {
    foul = true
    event = 'Scratch'
  }

  // --- The 8 ball ends the match one way or the other (except on the break, where it's respotted). ---
  if (potted8) {
    if (wasBreak) {
      const eight = w.balls.find((b) => b.num === 8)!
      eight.potted = false
      eight.x = FOOT_X + 2 * (BALL_R * 2.5)
      eight.y = MID_Y
      eight.vx = 0
      eight.vy = 0
      event = '8 on the break — respotted'
    } else {
      const legalWin = remBefore === 0 && !shot.scratch && !foul && shot.firstHit === 8
      if (legalWin) {
        w.result = { winner: shooter, reason: 'Sank the 8-ball' }
      } else {
        const reason = shot.scratch
          ? 'Scratched on the 8'
          : remBefore !== 0
            ? 'Pocketed the 8 too early'
            : 'Illegal shot on the 8'
        w.result = { winner: other(shooter), reason }
      }
      finalizeMessage(w)
      w.phase = 'gameover'
      w.lastShot = {
        shooter,
        pottedOwn: 0,
        potted: shot.potted,
        scratch: shot.scratch,
        foul,
        keptTurn: false,
        event: w.result.reason,
      }
      return w
    }
  }

  // --- Group assignment on the first legal pot of an open table (never on the break). ---
  let assignedThisShot = false
  if (w.open && !wasBreak && !foul && pottedObjects.length > 0) {
    const kinds = new Set(pottedObjects.map((n) => kindOf(n)))
    if (kinds.size === 1) {
      const k = [...kinds][0] as Group
      w.userGroup = shooter === 'user' ? k : otherGroup(k)
      w.open = false
      assignedThisShot = true
    }
  }

  // --- Own balls potted this shot (for tickets + continuation). ---
  const shooterGroup = groupOf(w, shooter)
  const pottedOwn = w.open
    ? pottedObjects.length
    : pottedObjects.filter((n) => kindOf(n) === shooterGroup).length
  // Track the opponent's tally — the Pool Shark trophy needs a win before the AI sinks 3 of theirs.
  if (shooter === 'ai' && !foul) w.aiBallsSunk += pottedOwn

  // --- Continuation: keep shooting on a clean pot of your own; otherwise hand off. ---
  let keptTurn = false
  if (!foul) {
    if (assignedThisShot) keptTurn = true
    else if (w.open) keptTurn = pottedObjects.length > 0
    else keptTurn = pottedOwn > 0
  }

  if (!event) {
    if (pottedOwn > 0) event = `Potted ${pottedOwn} ball${pottedOwn > 1 ? 's' : ''}`
    else event = 'No pot'
  }

  if (shot.scratch) respotCue(w)

  if (!keptTurn) {
    w.turn = other(shooter)
    w.ballInHand = foul // opponent gets ball-in-hand after any foul
    if (w.turn === 'user') w.userTurns += 1
  } else {
    w.ballInHand = false
  }

  w.phase = 'aim'
  w.lastShot = { shooter, pottedOwn, potted: shot.potted, scratch: shot.scratch, foul, keptTurn, event }
  finalizeMessage(w)
  return w
}

function finalizeMessage(w: PoolWorld): void {
  if (w.result) {
    w.message = w.result.winner === 'user' ? 'You win!' : 'Opponent wins'
    return
  }
  const groupWord = w.userGroup ? (w.userGroup === 'solid' ? 'solids' : 'stripes') : null
  const you = groupWord ? `you're ${groupWord}` : 'table open'
  if (w.turn === 'user') {
    w.message = w.ballInHand ? `Ball in hand — ${you}` : `Your shot, ${you}`
  } else {
    w.message = `Opponent's shot — ${you}`
  }
}

/* --------------------------------------------------------------------------------------------------
 * The house. Enumerates (own ball × pocket) shots, scores them by cut angle + distance and rejects
 * blocked paths. The power is worked out from how far the cue ball and the object ball must travel
 * (with the real friction and drag). The best three are then played out on a copy of the table with
 * `step()`, and one that pots and leaves another shot is preferred. It is played with a little
 * aim/power noise so it misses sometimes. It breaks properly (hard, at the head ball); when the group
 * is cleared it shoots the 8; on ball-in-hand it first parks the cue for a cleaner angle.
 * ------------------------------------------------------------------------------------------------ */

interface Candidate {
  angle: number
  power: number
  score: number
  from: { x: number; y: number }
  target: number
}

/** The speed a ball rolling at `v0` still has after `d` units (0 if it stops first). Same friction as `step`. */
function speedAfter(v0: number, d: number): number {
  let v = v0
  for (let x = 0; x < d && v > STOP_SPEED; x += 2) v -= 2 * (1 / FRICTION_TAU + DECEL / v)
  return Math.max(0, v)
}
/** The launch speed that still has `vEnd` left after `d` units. */
function speedFor(d: number, vEnd: number): number {
  let lo = vEnd, hi = MAX_SHOT_SPEED * 1.5
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (speedAfter(mid, d) < vEnd) lo = mid
    else hi = mid
  }
  return hi
}
/** The power to send the cue `cueTravel` to the contact and the object ball `objTravel` on, at a cut of `cut`. */
function powerFor(cueTravel: number, objTravel: number, cut: number): number {
  const vObj = speedFor(objTravel * 1.1 + 40, 60)                // reaching the pocket with a little to spare
  const vCue = vObj / (Math.max(0.2, cut) * (1 + BALL_RESTITUTION) * 0.5)
  const v0 = speedFor(cueTravel, vCue)
  return Math.max(0.25, Math.min(1, (v0 - MIN_SHOT_SPEED) / (MAX_SHOT_SPEED - MIN_SHOT_SPEED)))
}

function segmentBlocked(
  w: PoolWorld,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ignore: number[],
): boolean {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len === 0) return false
  const ux = dx / len
  const uy = dy / len
  for (const b of w.balls) {
    if (b.potted || b.num === 0 || ignore.includes(b.num)) continue
    const t = (b.x - x0) * ux + (b.y - y0) * uy
    if (t <= 0 || t >= len) continue
    const px = x0 + ux * t
    const py = y0 + uy * t
    if (Math.hypot(b.x - px, b.y - py) < BALL_R * 2.05) return true
  }
  return false
}

/** The balls `side` may legally hit first. */
function legalTargets(w: PoolWorld, side: Side): Ball[] {
  const onEight = isOnEight(w, side)
  const g = groupOf(w, side)
  return w.balls.filter((b) => {
    if (b.potted || b.num === 0) return false
    if (onEight) return b.num === 8
    if (b.num === 8) return false
    if (w.open || g == null) return true
    return kindOf(b.num) === g
  })
}

/** Every makeable shot for `side` from a given cue position, best (lowest score) first. */
function shotsFrom(w: PoolWorld, side: Side, cx: number, cy: number): Candidate[] {
  const list: Candidate[] = []
  for (const obj of legalTargets(w, side)) {
    for (const p of POCKETS) {
      const opx = p.x - obj.x
      const opy = p.y - obj.y
      const opLen = Math.hypot(opx, opy)
      if (opLen === 0) continue
      const odx = opx / opLen
      const ody = opy / opLen
      // Ghost-ball contact point: cue must arrive here to send the object at the pocket.
      const gx = obj.x - odx * BALL_R * 2
      const gy = obj.y - ody * BALL_R * 2
      const cgx = gx - cx
      const cgy = gy - cy
      const cgLen = Math.hypot(cgx, cgy)
      if (cgLen === 0) continue
      const cdx = cgx / cgLen
      const cdy = cgy / cgLen
      // Cut angle: cue's incoming dir vs the object's outgoing dir. Reject thin/backward cuts.
      const cut = cdx * odx + cdy * ody
      if (cut < 0.18) continue
      // Path must be clear from cue→ghost and object→pocket.
      if (segmentBlocked(w, cx, cy, gx, gy, [obj.num])) continue
      if (segmentBlocked(w, obj.x, obj.y, p.x, p.y, [obj.num])) continue
      const angle = Math.atan2(cgy, cgx)
      const power = powerFor(cgLen, opLen, cut)
      // Lower score = better: reward straight shots + short distance.
      const score = (1 - cut) * 2.2 + cgLen / PLAY_W + opLen / PLAY_W
      list.push({ angle, power, score, from: { x: cx, y: cy }, target: obj.num })
    }
  }
  return list.sort((a, b) => a.score - b.score)
}

const copyWorld = (w: PoolWorld): PoolWorld => JSON.parse(JSON.stringify(w)) as PoolWorld

/** Play a candidate out on a copy of the table, without noise: lower is better (a miss or a foul is heavily marked
 *  down; a pot that leaves another shot is marked up). */
function tryOut(w: PoolWorld, side: Side, c: Candidate): number {
  const t = copyWorld(w)
  placeCue(t, c.from.x, c.from.y)
  shoot(t, c.angle, c.power)
  while (t.phase === 'shooting') step(t, 1000 / 120)
  let s = c.score
  const legalFirst = t.shot.firstHit != null && legalTargets(w, side).some((b) => b.num === t.shot.firstHit)
  if (t.shot.scratch || !legalFirst) return s + 10
  if (t.shot.potted.includes(8) && c.target !== 8) return s + 20
  if (!t.shot.potted.includes(c.target)) return s + 4
  const cue = cueBall(t)
  if (c.target !== 8 && !shotsFrom(t, side, cue.x, cue.y).length) s += 1.2      // potted, but nothing to follow it
  return s
}

/** The best of a few candidates, once they have been tried out. */
function pick(w: PoolWorld, side: Side, list: Candidate[]): Candidate | null {
  let best: Candidate | null = null, bestS = Infinity
  for (const c of list.slice(0, 3)) {
    const s = tryOut(w, side, c)
    if (s < bestS) { bestS = s; best = c }
  }
  return best
}

/**
 * Pick and execute the AI's shot. On ball-in-hand it samples a few cue placements and keeps the best
 * angle. Applies medium-strength noise (worse on hard cuts) so the AI is beatable. Falls back to a
 * gentle nudge toward the nearest legal ball if nothing is cleanly makeable.
 */
export function aiShoot(w: PoolWorld, rng: () => number = Math.random): void {
  if (w.phase !== 'aim' || w.turn !== 'ai') return
  const cue = cueBall(w)

  if (w.isBreak) {
    // A proper break: as hard as it goes, square on the head ball, a hair either side.
    const head = w.balls.find((b) => b.num === RACK_ROWS[0][0] && !b.potted)
    const angle = head ? Math.atan2(head.y - cue.y, head.x - cue.x) + (rng() - 0.5) * 0.004 : 0
    shoot(w, angle, 0.97 + rng() * 0.03)
    return
  }

  let choice: Candidate | null = null
  if (w.ballInHand) {
    // Try the current spot plus a spread of placements; take the best makeable shots.
    const spots: Array<{ x: number; y: number }> = [{ x: cue.x, y: cue.y }]
    for (let i = 0; i < 10; i++) {
      spots.push({
        x: BALL_R * 2 + rng() * (PLAY_W - BALL_R * 4),
        y: BALL_R * 2 + rng() * (PLAY_H - BALL_R * 4),
      })
    }
    const all: Candidate[] = []
    for (const s of spots) {
      if (cueOverlaps(w, s.x, s.y)) continue
      all.push(...shotsFrom(w, 'ai', s.x, s.y).slice(0, 2))
    }
    choice = pick(w, 'ai', all.sort((a, b) => a.score - b.score))
    if (choice) placeCue(w, choice.from.x, choice.from.y)
  } else {
    choice = pick(w, 'ai', shotsFrom(w, 'ai', cue.x, cue.y))
  }

  if (!choice) {
    // Nothing makeable — softly nudge the nearest legal ball to avoid a foul.
    let near: Ball | null = null
    let nd = Infinity
    for (const b of legalTargets(w, 'ai')) {
      const d = Math.hypot(b.x - cue.x, b.y - cue.y)
      if (d < nd) {
        nd = d
        near = b
      }
    }
    const angle = near ? Math.atan2(near.y - cue.y, near.x - cue.x) : rng() * Math.PI * 2
    shoot(w, angle, near ? powerFor(nd, 120, 1) : 0.4)
    return
  }

  // Medium noise: a few degrees, larger on thin cuts; small power jitter.
  const hardness = Math.min(1, choice.score / 3)
  const aimSigma = 0.012 + hardness * 0.04
  const angle = choice.angle + (rng() - 0.5) * 2 * aimSigma
  const power = Math.max(0.25, Math.min(1, choice.power * (1 + (rng() - 0.5) * 0.12)))
  shoot(w, angle, power)
}
