// PolyZone: Tactics — game rules shared by the server and the client
// All numbers are starting values to be tuned through playtesting.

export const GAME_TITLE = 'PolyZone: Tactics';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 2; // 30Hz / 2 = 15Hz snapshot
export const INPUT_SEND_RATE = 30;
export const INPUT_HEARTBEAT_MS = 150;
export const INTERP_DELAY_MS = 100;

export const WORLD_HALF = 300; // playable range -300 to 300
export const MAP_SEED = 20261023;

export const PLAYER_RADIUS = 0.55;
export const HIT_RADIUS = 0.72;
export const MAX_HP = 100;
export const MOVE_SPEED = 7;
export const ADS_SPEED_MULT = 1;
export const ADS_SPREAD_MULT = 0;
export const MUZZLE_OFFSET = 0.95;
export const PICKUP_RANGE = 2.4;

// Movement: sprint, crouch, slide, jump, vault over low cover
export const MOVEMENT = {
  sprintMult: 1.45,
  crouchMult: 0.55,
  airControl: 0.9,
  jumpSpeed: 5.4,
  gravity: 16,
  slideTime: 0.75,
  slideStartSpeed: 13,
  slideEndSpeed: 5,
  vaultReach: 1.0,       // within this distance of cover, jump becomes a vault
  vaultMaxHeight: 1.75,  // only cover this low or lower can be vaulted (low walls, crates, rocks, cars)
  vaultMaxDepth: 2.6,    // only cover this thin or thinner can be vaulted
  vaultTime: 0.45,
  crouchSpreadMult: 0.75,
  airSpreadMult: 1.8,
};

export const INPUT_TIMEOUT_MS = 300;
export const MAX_INPUT_QUEUE = 20;
export const MAX_HUMANS = 4;
export const MATCH_SIZE = 12;
export const COUNTDOWN_SEC = 4;

export const WEAPON_SLOTS = 2;
export const START_WEAPON = 'kestrel';

// Three original weapons. Names and looks are specific to this project.
export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel Rifle', short: 'KST', kind: 'rifle',
    damage: 19, pellets: 1, range: 48,
    magSize: 24, reserveStart: 96, reserveMax: 192,
    fireInterval: 0.12, reloadTime: 1.6,
    spread: 0.025, spreadMove: 0.03, bloomPerShot: 0.01, bloomMax: 0.06, bloomRecover: 0.15,
    falloffStart: 0.6, falloffMin: 0.7, moveSpeedMult: 1.0,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', short: 'HRN', kind: 'smg',
    damage: 12, pellets: 1, range: 28,
    magSize: 36, reserveStart: 108, reserveMax: 216,
    fireInterval: 0.07, reloadTime: 1.4,
    spread: 0.055, spreadMove: 0.02, bloomPerShot: 0.008, bloomMax: 0.07, bloomRecover: 0.2,
    falloffStart: 0.5, falloffMin: 0.6, moveSpeedMult: 1.06,
  },
  breaker: {
    id: 'breaker', name: 'Breaker Shotgun', short: 'BRK', kind: 'shotgun',
    damage: 10, pellets: 8, range: 13,
    magSize: 6, reserveStart: 18, reserveMax: 36,
    fireInterval: 0.8, reloadTime: 2.2,
    spread: 0.15, spreadMove: 0.03, bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    falloffStart: 0.4, falloffMin: 0.35, moveSpeedMult: 0.96,
  },
};
WEAPONS.sentinel = {
  id: 'sentinel', name: 'Sentinel Sniper', short: 'SNT', kind: 'sniper',
  damage: 85, pellets: 1, range: 170, magSize: 5, reserveStart: 20, reserveMax: 50,
  fireInterval: 1.3, reloadTime: 2.8, spread: 0.008, spreadMove: 0.015,
  bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
  falloffStart: 0.85, falloffMin: 0.9, moveSpeedMult: 0.9, adsFov: 18,
};
WEAPONS.ranger = {
  ...WEAPONS.kestrel, id: 'ranger', name: 'Ranger DMR', short: 'DMR', kind: 'dmr',
  damage: 42, range: 110, magSize: 12, reserveStart: 48, reserveMax: 96,
  fireInterval: 0.36, reloadTime: 2, spread: 0.012, bloomPerShot: 0, bloomMax: 0, adsFov: 30,
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const ITEMS = {
  medkit: { label: 'Medkit', heal: 45, count: 48 },
  ammo: { label: 'Ammo box', count: 70 },
  crate: { label: 'Weapon crate', count: 55 },
};

// Zone: initial radius 135, first 30s wait, 5 phases (20s wait + 25s shrink), final radius 12.
// If the match is still going after phase 5, sudden death shrinks it to 0 (prevents endless standoffs).
export const ZONE = {
  initialRadius: 420,
  firstWait: 30,
  initialDps: 1,
  phases: [
    { wait: 20, shrink: 25, radius: 280, dps: 2 },
    { wait: 20, shrink: 25, radius: 185, dps: 4 },
    { wait: 20, shrink: 25, radius: 110, dps: 6 },
    { wait: 20, shrink: 25, radius: 50, dps: 9 },
    { wait: 20, shrink: 25, radius: 12, dps: 13 },
  ],
  suddenDeath: { wait: 20, shrink: 40, radius: 0, dps: 20 },
};

export const BOT = {
  names: ['Talon', 'Mako', 'Onyx', 'Brick', 'Jinx', 'Rook', 'Sable', 'Flint', 'Nova', 'Dune', 'Kite', 'Ember', 'Quill', 'Basalt'],
  sightRange: 28,
  closeAwareness: 5,
  hearingRange: 30,
  fov: Math.PI * 0.9,
  perceptionInterval: 0.2,
  reactionMin: 0.55,
  reactionMax: 1.0,
  aimErrorStart: 0.32,
  aimErrorMin: 0.07,
  aimErrorDecay: 0.45,
  burstOn: 0.55,
  burstOff: 0.45,
  repathInterval: 1.1,
};

export const RATE_LIMIT = {
  inputPerSec: 45, inputBurst: 15,
  eventPerSec: 6, eventBurst: 12,
  joinPerMin: 20, pairPerMin: 10,
  maxViolations: 60,
};

export const RECONNECT_GRACE_MS = 60000;
export const LOBBY_GRACE_MS = 30000;
export const PAIR_CODE_TTL_MS = 5 * 60000;
export const PAIR_CODE_LENGTH = 8;
export const ROOM_CODE_LENGTH = 5;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes look-alike characters (I, O, 0, 1)

// Optional extension: GATT settings for a BLE peripheral controller (untested on hardware)
export const BLUETOOTH = {
  serviceUuid: '7a2f0001-5b1c-4d6e-9a2b-3c4d5e6f7a80',
  inputCharacteristicUuid: '7a2f0002-5b1c-4d6e-9a2b-3c4d5e6f7a80',
  // packet (7 bytes, little endian):
  // [0] uint8 seq, [1] int8 moveX(-127~127), [2] int8 moveZ, [3..4] uint16 aim(0~65535 → 0~2π),
  // [5] uint8 buttons (bit0 fire, bit1 ads, bit2 reload, bit3 interact, bit4 swap), [6] uint8 reserved
  packetLength: 7,
};

export const QUALITY_PRESETS = {
  // post: post-processing (bloom, grading, MSAA), ao: GTAO ambient occlusion, grass: grass density ratio
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 0, post: false, ao: false, msaa: 0, grass: 0.25 },
  medium: { pixelRatio: 1.0, shadows: true, shadowMapSize: 2048, post: false, ao: false, msaa: 0, grass: 0.6 },
  high: { pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, post: true, ao: false, msaa: 2, grass: 1 },
};
