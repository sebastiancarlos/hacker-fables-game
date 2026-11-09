# Hacker Fables

Hacker Fables is a terminal and browser roguelike in which Vim keybindings are the combat system. This glossary fixes the vocabulary of its game world, its simulation, and its records.

## Language

### Lore and Places

**Bell Labs**:
The research complex that contains the Levels of the game, where UNIX first booted.
_Avoid_: Tower, facility

**Second GIL**:
The hyperdimensional force of sheer parallelism that rose beneath Bell Labs after the GIL was removed; the antagonist of the setting. It is defeated in lore when the Boss dies.
_Avoid_: GIL, the lock

**E. Max Vim**:
The protagonist of a Run, a hacker trained in Vim martial arts.
_Avoid_: Max

### World and Depth

**Level**:
One floor of Bell Labs and everything on it: walls, Enemies, Ground Items, stairs, and Explored memory. Player copy also calls a Level a floor.
_Avoid_: Stage, zone, map

**Depth**:
A Level's 1-based position in Bell Labs, from 1 at the Top Level to 15 at the Bottom Level.
_Avoid_: Dlvl, floor number

**Bottom Level**:
The deepest Level, depth 15, where the Boss waits.
_Avoid_: Bottom, final level, endgame

**Top Level**:
Depth 1, the first Level of Bell Labs, where a Run begins and where the Exit Hatch completes a Victory.
_Avoid_: Surface, overworld, outside, ground floor

**Stairs**:
The up and down travel points that connect adjacent Levels.
_Avoid_: Ladder, staircase

**Service Elevator**:
The fixed shaft that travels between the Top Level and the Bottom Level, broken until Gil Gone.
_Avoid_: Elevator, lift

**Exit Hatch**:
The hatch on the Top Level that opens after Gil Gone and completes a Victory.
_Avoid_: Surface hatch, portal

**Visible**:
The cells currently in the Player's field of view.
_Avoid_: Seen, lit

**Explored**:
The cells the Player has ever seen on a Level, kept as memory after they leave view.
_Avoid_: Remembered, discovered, fog of war

**Omniscient**:
The replay-only view that reveals an entire Level regardless of sight.
_Avoid_: Map view, reveal

**Corruption**:
The red tint on a Level's walls, deepening with the number of living Enemies.
_Avoid_: Rot, infestation

**Glitch**:
The flickering ASCII noise on the Bottom Level's walls, drawn only while Enemies remain.
_Avoid_: Flicker, static

**Floor Clear**:
The state of a Level with no living Enemies.
_Avoid_: Clear, cleared

**Ground Item**:
An Item lying on a Level, available to pick up.
_Avoid_: Loot, drop, floor item

**Arena**:
The deterministic single-room Level used by the CLI and browser test hooks.
_Avoid_: Sandbox, test map

### Enemies

**Enemy**:
Any fighting entity on a Level that is not the Player.
_Avoid_: Monster, mob, creature, hostile

**Code-Snake**:
The one-cell Enemy family whose power scales with its Python Version.
_Avoid_: Snake, serpent

**Walrus Operator**:
The two-cell Enemy shaped like `:=`.
_Avoid_: Walrus, operator

**Boss**:
The single Enemy on the Bottom Level whose death triggers Gil Gone and opens the path to Victory. The current Boss is the GIL-less Dev Preview, the Second GIL's avatar.
_Avoid_: Final boss, end boss

**Python Version**:
The release label attached to an Enemy that sets its difficulty, from 2.0 to 3.16.
_Avoid_: Version, level

**Bite**:
The damage an Enemy deals at close range.
_Avoid_: Hit, slam

**Hunt**:
The behavior of an Enemy that can see the Player and paths toward them.
_Avoid_: Chase, pursue

**Wander**:
The behavior of an Enemy that cannot see the Player and moves randomly.
_Avoid_: Roam, idle

**Enemy Turn**:
The phase after a Turn in which every living Enemy acts.
_Avoid_: Monster turn, AI turn

### Player and Progression

**Player**:
The controllable `@` in a Run, the avatar of E. Max Vim.
_Avoid_: Character, hero

**HP**:
The Player's hit points; reaching zero ends the Run as Dead.
_Avoid_: Health, life

**XP**:
Experience points earned from kills, spent toward the next Player Level.
_Avoid_: Experience, points

**Player Level**:
The Player's progression tier, raised by XP.
_Avoid_: Level, rank, character level

**Turn**:
One Player decision that advances the simulation, including the Enemy Turn.
_Avoid_: Tick, step, action

**Dead**:
The Outcome in which HP reaches zero.
_Avoid_: Death, killed, game over

**Gil Gone**:
The state after the Boss dies, in which the Second GIL is defeated in lore and the Service Elevator and Exit Hatch become usable.
_Avoid_: Boss dead, endgame

**Victory**:
The Outcome in which the Player escapes through the Exit Hatch after Gil Gone.
_Avoid_: Win, game clear

**Starting Kit**:
The Player Level, XP, Shells, and Scripts granted when a Run starts deeper than the Top Level.
_Avoid_: Loadout, starting gear

**Inventory**:
The Items a Player carries.
_Avoid_: Bag, pack

**Wielded**:
The Weapon currently equipped by the Player.
_Avoid_: Active weapon, held weapon

**Shells**:
The reserve ammunition for the Modal Shotgun.
_Avoid_: Ammo, bullets, rounds

**Loaded**:
The state of holding one Shell in the Modal Shotgun, which fires before any reserve Shells are spent.
_Avoid_: Chambered, ready

### Items and Combat

**Item**:
Anything the Player can pick up: a Weapon or a Script.
_Avoid_: Object, pickup

**Weapon**:
A pickable Item that fires Shells; currently only the Modal Shotgun.
_Avoid_: Gun, firearm

**Modal Shotgun**:
The game's only Weapon, a shotgun whose shells are aimed and fired through Vim Modes.
_Avoid_: Gun, generic shotgun

**Script**:
A consumable Item that executes a regex-style substitution, deleting Enemies or restoring HP. Player copy may call it a regex script.
_Avoid_: Scroll, magic scroll

**Melee**:
The Player's bare-handed attack, triggered by moving into an adjacent Enemy.
_Avoid_: Bump, punch, unarmed

**Shot**:
A single fired shell aimed at one cell.
_Avoid_: Fire, blast

**Volley**:
One Shot per cell in a Visual Block, with each Enemy hit at most once.
_Avoid_: Burst, spread, barrage

**Chamber**:
The action of putting one Shell into the Modal Shotgun and entering INSERT BULLET.
_Avoid_: Load, reload

**Target Mode**:
The UI Mode for aiming a Shot, entered with `f`.
_Avoid_: Fire mode, aim mode, free aim

**Visual Block**:
The set of cells marked out in VISUAL BLOCK, used to aim a Volley.
_Avoid_: Rectangle, box, selection

**Aim Cursor**:
The movable cell marker shared by Target Mode, VISUAL BLOCK, and Look Mode.
_Avoid_: Cursor, target

### Vim Modes and UI

**UI Mode**:
The active interaction context that decides which keys the Player's input reaches and what the display paints, such as title, lore, scores, play, target, visual, look, or over.
_Avoid_: Screen, state, game mode

**Vim Mode**:
A sub-state of the current UI Mode, reported by the Status Pill. The Vim Modes are NORMAL, INSERT BULLET, and VISUAL BLOCK.
_Avoid_: Editor mode, input mode

**NORMAL**:
The default Vim Mode, shown in play, Target Mode, and Look Mode when no Shell is chambered and no Visual Block is active.
_Avoid_: Command mode, default mode

**INSERT BULLET**:
The Vim Mode shown in play while one Shell is chambered and ready to fire.
_Avoid_: Insert mode, loaded mode

**VISUAL BLOCK**:
The Vim Mode shown in the visual UI Mode while the Player selects a Visual Block for a Volley.
_Avoid_: Visual mode, block mode

**Status Pill**:
The status-line label that names the current Vim Mode.
_Avoid_: Mode indicator, badge

**Look Mode**:
The UI Mode for inspecting a cell, an Enemy, or an Item with the Aim Cursor.
_Avoid_: Examine mode, inspect mode

**Modal**:
A transient layer above a UI Mode: a menu, pager, or confirm prompt.
_Avoid_: Popup, dialog, overlay

**Pager**:
A scrollable text Modal used for help, messages, and details.
_Avoid_: Viewer, reader

**Message Line**:
The single-row message that describes the latest Turn.
_Avoid_: Status message, log line

**Message Log**:
The scrollable history of past Message Lines.
_Avoid_: Chat, console

**Command**:
One action the Player issues during play, counted by the Command Tally and penalized in the Score.
_Avoid_: Key, press, input

**Command Tally**:
The bottom-row count and recent history of Commands.
_Avoid_: Tally, command line

**Title Screen**:
The boot screen offering New Game, View Recording, High Scores, and Quit.
_Avoid_: Splash, main menu

**End Screen**:
The summary shown after a Run ends, with its Outcome, stats, Score, and replay controls.
_Avoid_: Game over screen, death screen

### Runs and Records

**Run**:
One complete attempt, from a Seed and input stream to an Outcome.
_Avoid_: Game, session, playthrough

**Seed**:
The value that, together with the Player's input, determines every random choice in a Run.
_Avoid_: Random seed, base seed

**Recording**:
The saved Seed, setup flags, and normalized keys needed to reproduce a Run.
_Avoid_: Replay file, demo

**Replay**:
The act of feeding a Recording back through the engine to watch a Run again.
_Avoid_: Playback, rerun

**Morgue Dump**:
The Markdown report written at the end of a Run, summarizing its Outcome, stats, and Inventory.
_Avoid_: Dump, log, obituary

**Score**:
The numeric result of a Run, derived from Depth, Player Level, XP, Commands, and Victory.
_Avoid_: Points, total

**Standing**:
A Run's Score and its position in the High Score Table, or its unscored status.
_Avoid_: Rank, placement

**High Score Table**:
The ranked list of saved Scores.
_Avoid_: Leaderboard, scores list

**Outcome**:
The final state of a Run: Dead, Quit, or Victory.
_Avoid_: Result, ending

**Quit**:
The Outcome in which the Player ends a Run voluntarily; a confirmed quit is not scored or recorded.
_Avoid_: Exit, abandon
