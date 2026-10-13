import type { RichText } from "./style.ts";
/**
 * Content: every player-facing word.
 *
 * Pure data and pure formatters only, so simulation, presentation, and
 * tests can share one source without import cycles.
 */

/** The facility the run descends through; depths read as its sub-levels. */
export const DUNGEON_NAME = "Bell Labs";

/** What the game says when a bite finally ends the run. */
export const DEATH_LINE = "Your terminal closed permanently. SIGKILL.";

/** What the game says when the GIL-less dev preview finally falls. */
export const WIN_LINE = "The Second GIL finished with exit code 1.";

/** The bottom's service elevator comes online when the boss falls. */
export const ELEVATOR_LINE = "The service elevator shudders to life.";

/** The service elevator before the GIL-less dev preview is destroyed. */
export const ELEVATOR_BROKEN = "The service elevator is out of service.";

/** The all-clear when a floor's last hostile falls and its tint lifts. */
export const FLOOR_CLEAR_LINE = "The floor returns to its Bell Labs blue.";

/** Level 1's surface hatch before the GIL-less dev preview is destroyed. */
export const EXIT_SEALED =
  "Escaping is not part of the hacker ethos, except sandbox breaking.";

/**
 * The boot splash banner: a figlet-style "HACKER FABLES" whose upper
 * strokes curl into flames. Rows are right-trimmed.
 */
export const TITLE_ART: string[] = [
  "    )                     )       (      (                   (          (",
  " ( /(   (        (     ( /(       )\\ )   )\\ )    (       (   )\\ )       )\\ )",
  " )\\())  )\\       )\\    )\\()) (   (()/(  (()/(    )\\    ( )\\ (()/(  (   (()/(",
  "((_)\\((((_)(   (((_) |((_)\\  )\\   /(_))  /(_))((((_)(  )((_) /(_)) )\\   /(_))",
  " _((_))\\ _ )\\  )\\___ |_ ((_)((_) (_))   (_))_| )\\ _ )\\((_)_ (_))  ((_) (_))",
  "| || |(_)_\\(_)((/ __|| |/ / | __|| _ \\  | |_   (_)_\\(_)| _ )| |   | __|/ __|",
  "| __ | / _ \\   | (__   ' <  | _| |   /  | __|   / _ \\  | _ \\| |__ | _| \\__ \\",
  "|_||_|/_/ \\_\\   \\___| _|\\_\\ |___||_|_\\  |_|    /_/ \\_\\ |___/|____||___||___/",
];

/**
 * Per-cell color for TITLE_ART: `R` red, `Y` yellow, a space leaves the
 * glyph in the terminal's standard color. The upper licks burn red into
 * yellow toward the letter bodies. Same row count as TITLE_ART.
 */
export const TITLE_ART_MASK: string[] = [
  "    R                     R       R      R                   R          R",
  " R RR   R        R     R RR       RR R   RR R    R       R   RR R       RR R",
  " RRYYR  RR       RR    RRYYR R   RYYRR  RYYRR    RR    R RR RYYRR  R   RYYRR",
  "RYYYRRRYYYYR   RRYYY RYYYYR  RR   RYYYR  RYYYRRRYYYYR  RRYYY RYYYR RR   RYYYR",
  " YYYYYYY Y YY  YYYYY YY YYYYYYYY YYYY   YYYY   YY   YYYY Y  Y YY  YY Y Y YY",
  "      Y Y  YYYYY                               YYY  YYY",
  "",
  "",
];

/** Plain-text title, set under the banner so the name still reads at a glance. */
export const TITLE_TEXT = "HACKER FABLES";

/** One-line tagline under the banner. */
export const TITLE_TAGLINE = "a vim roguelike";

/**
 * Command help: the static sections around the generated key rows. The
 * key rows themselves come from the play bindings in input.ts.
 */
export const COMMANDS_HELP = {
  title: "Hacker Fables commands",
  pagerIntro: ["Keys for a Pager (like this one):"],
  movementIntro: ["Movement is 4-directional."],
  countMoves: {
    keys: "5j, 12l",
    help: "run up to that many steps",
  },
  combat: [
    "Combat: Step into an enemy to do some Vim",
    "Jiu-jitsu upon it. Code-snakes are manifestations",
    "of the Second GIL; their power is proportional to",
    "the Python version they run. Deeper in, rarer",
    "entities from the Python bestiary will face you.",
  ],
  bottom: [
    "Sub-level 30 is the bottom of Bell Labs, the",
    "ritualistic place where UNIX first booted. The",
    "Second GIL manifests itself there, in the shape of",
    "the strongest metaphysical entity this puny world",
    "has ever seen: a Python snake without a GIL. Kill",
    "it and take the service elevator (=) back to the",
    "surface.",
  ],
  shotgun: [
    "The Modal Shotgun: Once you find one, grab it with",
    "^, chamber shells with i (which changes into Vim's",
    "INSERT BULLET mode), and aim with f. The cursor",
    "starts on the nearest enemy, but you can move to",
    "other targets with your movement keys (or enter",
    '"free aim" mode by pressing o). Press . (Vim\'s',
    'repeat command) to repeat a "chamber, aim and',
    'fire" action. Every shotgun carries 20 shells.',
    "Press ^ on additional shotguns to grab its shells.",
    "Your total shells are displayed on the status bar",
    'under "Ammo".',
  ],
  visual: [
    "VISUAL BLOCK mode: You unlock this at level 2.",
    "Press ^V (Ctrl-V) to enter VISUAL BLOCK mode on",
    "your Modal Shotgun. Move your cursor to expand or",
    "contract the selection. When you're ready, press",
    "Enter to fire a shot for every single enemy within",
    "the selection. Esc lowers the gun. Advanced",
    "selection features: ^, $, gg, and G stretch the",
    "selection to the left, right, top, or bottom edge",
    "respectively. Press o to swap corners diagonally,",
    "and O to swap corners perpendicularly. gv repeats",
    "the last selection you made. Press . (Vim's repeat",
    'command) to repeat a "chamber, reselect the last',
    'visual block, and fire" action.',
  ],
} as const;

/** Help pager: the game's about text. */
export const ABOUT_LINES: string[] = [
  "A coffeebreak roguelike by Sebastian Carlos, set",
  'in the world of the novel "Hacker Fables", where',
  "Vim keybindings are martial arts, among other",
  "shenanigans.",
  "",
  "Hacker Fables will always be fully free and FOSS.",
  "If you like the game and want to support it, you",
  "can buy me a coffee at:",
  "",
  "https://ko-fi.com/sebastiancarlos",
  "",
  "You can also check the free novel which inspired",
  'this game, "Hacker',
  'Fables":',
  "",
  "https://sebastiancarlos.github.io/hacker-fables",
  "",
  "I aim to expand the game into an ambitious,",
  "multi-paradigm adaptation of the source material.",
];

/**
 * Narration and UI copy: every player-facing sentence lives here, so a
 * rule, its test, and the log all share one source. Templates are
 * functions; fixed lines are constants. Simulation code names a meaning,
 * never a phrase.
 */
export const NOTE = {
  restored: "You feel restored. Like a freshly sourced ~/.bashrc.",
  noShells: "No shells left to chamber via INSERT BULLET mode.",
  nothingToEquip: "You have nothing to equip.",
  visualLocked: "You haven't learned VISUAL BLOCK mode yet.",
  nothingToRepeat: "Nothing to repeat.",
  nothingInRange: "No targets in range to repeat the shot.",
  lowerShotgun: "You lower the shotgun.",
  nothingHere: "There is nothing here to pick up.",
  noScripts: "You carry no scripts.",
  noElevator: "There is no service elevator here.",
  noElevatorFound: "You haven't found the service elevator yet.",
  noDetails: "No details available. Please open a Pull Request.",
  needGun: "You need to equip the Modal Shotgun first.",
  needLoaded: "The Modal Shotgun is not loaded. INSERT BULLET with i.",
  chooseTarget: "Choose a target (Enter to fire, ^V to select, Esc to cancel).",
  noPreviousVisual: "No previous visual selection to repeat.",
} as const;

/** Wall descriptions by corruption tier, 0 clean through 7 full red. */
const WALL_PHRASES: readonly string[] = [
  "a wall in traditional Bell Labs blue",
  "a wall with hints of corruption",
  "a wall with hints of corruption",
  "a wall tinted red",
  "a wall tinted red",
  "a red-hot wall",
  "a red-hot wall",
  "a wall of blinding red light",
];

/** The bottom's glitch wins over the wall's corruption tint. */
const WALL_GLITCH_PHRASE = "a wall flickering in and out of physical reality";

/** A wall phrase for one corruption tier and glitch state. */
function wallPhrase(tier: number, glitching: boolean): string {
  return glitching ? WALL_GLITCH_PHRASE : WALL_PHRASES[tier]!;
}

/** Uppercase the first character of a phrase. */
function capitalize(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
}

/** The verb each enemy uses when its attack lands. */
const BITE_VERB = {
  snake: "bites",
  walrus: "slams",
  boss: "bites",
} as const;

/** Describe the player's appearance from remaining health. */
function playerAppearance(hp: number, maxHp: number): string {
  const pct = (100 * hp) / maxHp;
  if (pct >= 100) {
    return "healthy";
  }
  if (pct >= 25) {
    return "scraped up";
  }
  return "like the typical output of GNU Autotools";
}

/** Singular and plural nouns for counting targets in a volley. */
export interface CountNoun {
  one: string;
  many: string;
}

/** Count noun for a volley that mixes enemy families. */
export const MIXED_ENEMY_NOUN: CountNoun = {
  one: "enemy",
  many: "enemies",
};

/** A count with the right singular or plural noun. */
function countPhrase(count: number, noun: CountNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/** One line of narration built from the facts of an event. */
export const MSG = {
  // Terrain and travel.
  wall: (tier: number, glitching: boolean): string =>
    `${capitalize(wallPhrase(tier, glitching))}.`,
  seeHere: (name: string): string => `You see here a ${name}.`,
  comesIntoView: (name: string): string => `A ${name} comes into view.`,
  staircase: (dir: "up" | "down", depth: number): string =>
    dir === "up" && depth === 1
      ? "You see the staircase out of Bell Labs."
      : `You see a staircase ${dir}.`,
  blocksWay: (name: string): string => `A ${name} blocks the way.`,
  cannotReach: (label: string): string => `You can't reach ${label}.`,
  descend: (depth: number): string => `You descend to level ${depth}.`,
  elevatorSurface: "The service elevator stops at the surface.",
  elevatorDepth: (depth: number): string =>
    `The service elevator descends to level ${depth}.`,
  ascend: (depth: number): string => `You ascend to level ${depth}.`,
  cantGoDown: "You can't go down here.",
  cantGoUp: "You can't go up here.",
  noDownStairs: "You haven't found the down stairs yet.",
  noUpStairs: "You haven't found the up stairs yet.",

  // Look mode.
  unexplored:
    "Unexplored coordinate at best, ontologically meaningless at worst.",
  yourself: (hp: number, maxHp: number): string =>
    `Yourself, E. Max Vim. You look ${playerAppearance(hp, maxHp)}.`,
  recallItem: (recall: string, name: string): string =>
    `You ${recall} a ${name}.`,
  recallElevator: (recall: string, ready: boolean): string =>
    `You ${recall} a service elevator. ${ready ? "It hums, ready." : "Out of service."}`,
  recallStairs: (recall: string, dir: "up" | "down"): string =>
    `You ${recall} a staircase ${dir}.`,
  seeWall: (tier: number, glitching: boolean): string =>
    `You see ${wallPhrase(tier, glitching)}.`,
  recallWall: "You recall a wall.",
  recallFloor: (recall: string): string => `You ${recall} the floor.`,

  // Combat and gear.
  bite: (name: string, kind: keyof typeof BITE_VERB): string =>
    `The ${name} ${BITE_VERB[kind]} you!`,
  levelUp: (level: number): string => `You advance to level ${level}!`,
  unlock: "You learned VISUAL BLOCK mode (^V)!",
  meleeHitLead: "You hit the ",
  lookLead: "You see a ",
  lookSees: ". It sees you.",
  lookUnseen: ". It hasn't noticed you.",
  alreadyEquipped: (name: string): string =>
    `You already have the ${name} equipped.`,
  equipHums: (name: string): string =>
    `You equip the ${name}. It hums with modal power.`,
  equipNoShells: (name: string): string =>
    `You equip the ${name}. No shells left to chamber.`,
  insertBullet: '"INSERT BULLET"',
  visualBlockLabel: '"VISUAL BLOCK"',
  visualBlockHelp: " mode: move to select, Enter fires all, Esc back.",
  insertAlreadyLead: "Already in ",
  insertModeSuffix: " mode.",
  insertChamberedSuffix: " mode: shell chambered.",
  equipLead: (gun: string): string => `You equip the ${gun}. `,
  shotEcho: "The shot echoes through the floor.",
  shotKill: (name: string): string => `You blast the ${name} into pixels!`,
  shotWound: (name: string): string => `You blast the ${name}. It reels.`,
  shotVolleyKill: (total: number, noun: CountNoun): string =>
    `You blast ${countPhrase(total, noun)} into pixels!`,
  shotVolleyWound: (total: number, noun: CountNoun): string =>
    `You blast ${countPhrase(total, noun)}. They reel.`,
  shotMixed: (killed: number, wounded: number, noun: CountNoun): string =>
    `You blast ${countPhrase(killed, noun)} into pixels! ${countPhrase(wounded, noun)} ${wounded === 1 ? "reels" : "reel"}.`,
  shotShortfall: (shortfall: number): string =>
    ` Out of shells for ${shortfall} more.`,
  scriptHeal: "The script restores your health to full!",
  scriptV2: (kills: number): string =>
    kills === 1
      ? "The script deletes 1 Python 2 snake in view!"
      : kills > 1
        ? `The script deletes ${kills} Python 2 snakes in view!`
        : "The script finds no Python 2 snakes in view.",
  scriptAll: (kills: number): string =>
    kills === 1
      ? "The script deletes 1 snake in view!"
      : kills > 1
        ? `The script deletes ${kills} snakes in view!`
        : "The script finds no snakes in view.",
  pickupScript: (name: string): string => `You pick up the ${name}.`,
  pickupShells: (shells: number): string =>
    `You pick up ${shells} shells for the Modal Shotgun.`,
  pickupGun: (shells: number): string =>
    `You pick up the Modal Shotgun. (${shells} shells.)`,

  // Enemy deaths.
  killEnemy: (name: string): string => `The ${name} dissolves into pixels!`,
  killBoss: (name: string): string =>
    `The ${name} crashes. SIGKILL. The Second GIL is gone!`,

  // Details panels.
  enemyHeader: (name: string): string => `A ${name}.`,
  enemyHp: (hp: number): string => `HP: ${hp}.`,
  enemyBite: (bite: number): string =>
    `Bite: ${bite} damage per turn from any adjacent cell.`,
  itemHeader: (name: string): string => `${name}.`,
  playerHp: (hp: number, max: number): string => `HP: ${hp}(${max}).`,
  wielding: (name: string): string => `Wielding: ${name}.`,
  emptyHanded: "Empty-handed.",
  gunDamage: (damage: number): string => `Damage: ${damage}.`,
  gunFlavor:
    "The Modal Shotgun. The one wielded by Dennis Ritchie himself during The Great MULTICS Siege. Change firing modes with vim keybindings. Standard stuff, really. The rest is on the man page.",
  chamberAim: "Chamber with i, aim with f.",
  equipped: "Equipped.",
  notEquipped: "Not equipped.",
  executeWith: "Execute with s.",
} as const;

/** Canonical display name per script effect, the only place names live. */
export const SCRIPT_NAMES = {
  v2: "script of s/s//g",
  all: "script of s/[sS]//g",
  heal: "script of s/HP:(\\d+)\\((\\d+)\\)/HP:\\2(\\2)/g",
} as const;

/** One-line behavior summary per script effect, for the details panel. */
export const SCRIPT_DETAILS = {
  v2: "Deletes visible Python 2 snakes.",
  all: "Deletes every visible snake.",
  heal: "Restores your health to full.",
} as const;

/** Static flavor rows under the HP/bite lines in the details panel. */
export const ENEMY_FLAVOR = {
  snake: [
    "A manifestation of the Second GIL. A physical entanglement of lines of code, taking the form of a snake.",
  ],
  walrus: [
    "The very entity that defeated our Benevolent Dictator for Life. Back for more, empowered by the Second GIL.",
  ],
  boss: [
    "The avatar the Second GIL chose to represent him in our reality. A formidable Python version, free of the traditional multithreading limitations, and therefore hungry for blood.",
  ],
} as const;

/** Destination labels used in travel refusal lines. */
export const LABEL = {
  elevator: "the service elevator",
  downStairs: "the down stairs",
  upStairs: "the up stairs",
} as const;

/** Angband-style wound prefixes, keyed to remaining health. */
export const WOUND = {
  somewhat: "somewhat wounded ",
  wounded: "wounded ",
  badly: "badly wounded ",
  almostDead: "almost dead ",
} as const;

/** End-screen prose and hints. */
export const END = {
  quitLine: "You ended your run.",
  won: (label: string): string => `You defeated the Second GIL on ${label}.`,
  quitAt: (label: string): string => `You ended your run on ${label}.`,
  slain: (name: string, label: string): string =>
    `Slain by ${name} on ${label}.`,
  stats: (
    depth: number,
    level: number,
    xp: number,
    turns: number,
    seed: number,
  ): string =>
    `Depth ${depth}   Level ${level}   XP ${xp}   Turns ${turns}   Seed ${seed}`,
  score: (score: number): string => `Score ${score}`,
  scoreRank: (score: number, rank: number, total: number): string =>
    `Score ${score}   high score #${rank} of ${total}`,
  commands: (commands: number): string => `Vim Commands (${commands}):`,
  none: "(none)",
  inventory: "Inventory:",
  empty: "(empty)",
  more: (count: number): string => `(and ${count} more)`,
  replayLead: "Press ",
  replayTail: " to replay.",
  quitLead: "Press ",
  quitTail: " to quit.",
  coffeeLead: "If you like the game, you can buy me a coffee:",
  coffeeUrl: "https://ko-fi.com/sebastiancarlos",
} as const;

/** Menus, confirmations, and status copy. */
export const UI = {
  initialMessage: "Press ? for help.",
  playerName: "E. Max Vim the Hacker",
  modeNormal: " NORMAL ",
  modeInsert: " INSERT ",
  modeVisual: " VISUAL ",
  statusRest: (
    hp: number,
    max: number,
    wielded: string | null,
    ammo: number | null,
  ): string =>
    `  HP:${hp}(${max})${wielded !== null ? `  W:${wielded}` : ""}${ammo !== null ? `  Ammo:${ammo}` : ""}`,
  replayControls: "Replay   space: play   l: step   Tab: map   q: quit",
  targetHint: (hp: number, max: number): string =>
    `${hp}(${max}) -- Enter:fire Esc:cancel`,
  lookHelp: "h/j/k/l jump to interest, o free select, r details, q quit",
  pagerTyping: (query: string): string =>
    ` /${query}_ (Enter: find, Esc: cancel)`,
  pagerStatus: (
    title: string,
    top: number,
    bottom: number,
    total: number,
    pct: number,
  ): string => `${title} -- line ${top + 1}-${bottom} of ${total} (${pct}%)`,
  pagerNoMatch: " -- no match",
  pagerQuery: (query: string): string => ` -- /${query} (n: next)`,
  recordingsTitle: "Recordings",
  recordingsEmpty: "(no recordings)",
  recordingsFooter: "j/k: move   Enter: watch   q: back",
  logTitle: "Messages",
  noMessages: "No messages yet.",
  scoresTitle: "High scores",
  scoresFooter: "q: back",
  goodbye: "Hacker Fables is yielding back control of your CPU. Bye!",
  commandsTitle: "Commands",
  aboutTitle: "About",
  equipTitle: "What do you want to equip?",
  scriptTitle: "Which script to execute?",
  helpTitle: "What do you want help with?",
  helpCommands: "a) List of commands",
  helpAbout: "b) About the game",
  endRow: "(end)",
  newGame: "New game",
  viewRecording: "View recording",
  highScores: "High scores",
  quit: "Quit",
  emptyRow: "(empty)",
  equippedSuffix: " (equipped)",
  unlockRows: [
    MSG.unlock,
    "",
    "^V in fire mode selects a rectangle.",
    "Enter fires one round per covered enemy.",
    "gv reselects the last block.",
    "",
    "Continue? (y)",
  ],
  corruptionRows: [
    "The corruption becomes more intense,",
    "and flickering symbols pop in and out of",
    "your vision, like ASCII characters from",
    "another dimension.",
    "",
    "Continue? (y)",
  ],
  quitRows: [
    "Quit this run?",
    "",
    "The run will not be scored or recorded.",
    "",
    "Quit? (y/N)",
  ],
} as const;

/** Lore shown once when a run begins. */

const LORE_TEXT = `Your name is E. Max Vim, hacker extraordinaire, trained in Vim martial arts by
sensei Richard Stallman.

After years of notorious hacks, you took a well-deserved break. But one evening
at 4:20 AM, while working on your dotfiles, you received a distress call from
Bell Labs.

Hours ago, the Python core development team at Bell Labs finally removed the
GIL. However, what lay underneath was beyond anyone's guess: A Second GIL of
herculean strength.

Guido Von Rossum quickly joined a rapid response team into the sub-levels of
Bell Labs. However they found strange manifestations of the Second GIL, now
understood as a hyperdimensional force of sheer parallelism. These hostile
"code snakes" quickly disposed of all the Special DevOps forces.

Your job is to reach sub-level 30, where UNIX first booted on a PDP-11, and
shoot the second GIL until it stops moving.`;

export const LORE_LINES: readonly RichText[] = [
  ...LORE_TEXT.split("\n"),
  "",
  [{ text: "Press any key to begin.", reverse: true }],
];
