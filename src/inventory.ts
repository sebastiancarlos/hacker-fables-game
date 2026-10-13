/**
 * Inventory: pickup, equip, scripts, and menu selection.
 *
 * Every function mutates S only. Turn passing and the pager are direct
 * calls; closing the menu restores whichever mode it was opened from and
 * the renderer repaints it.
 */
import {
  groupScripts,
  isWeapon,
  itemDetails,
  itemPickup,
  scriptTargets,
  type ScriptItem,
  type WeaponItem,
} from "./items.ts";
import { ABOUT_LINES, MSG, NOTE, UI } from "./content.ts";
import type { Enemy } from "./world.ts";
import type { Vec } from "./geometry.ts";
import {
  MAX_HP,
  closeModal,
  currentMenu,
  openModal,
  type GameState,
  type MenuRow,
  type MenuStage,
} from "./game-state.ts";
import { itemAt, enemyAt } from "./queries.ts";
import { killEnemy } from "./progress.ts";
import { wrapText } from "./text.ts";
import { ENEMY_KINDS, enemyName } from "./enemies.ts";
import { dispatch, type Binding, type KeyCtx } from "./keymap.ts";
import { passTurn } from "./monsters.ts";
import { openPager } from "./pager.ts";
import { note } from "./events.ts";

/** Pick up the item at the player's feet, if any. */
export function pickup(S: GameState): void {
  const g = itemAt(S, S.sim.player.x, S.sim.player.y);
  if (g === undefined) {
    note(S, NOTE.nothingHere);
    return;
  }
  const plan = itemPickup(g.item, S);
  S.sim.level.ground.splice(S.sim.level.ground.indexOf(g), 1);
  if (plan.shells !== undefined) {
    S.sim.shells = plan.shells;
  }
  if (plan.carried) {
    S.sim.inventory.push(g.item);
  }
  note(S, plan.message);
}

/** The weapons in the inventory, in carried order. */
export function carriedWeapons(S: GameState): WeaponItem[] {
  return S.sim.inventory.filter(isWeapon);
}

/** Equip a chosen item. The menu layer closes the menu afterwards. */
export function equipChoice(S: GameState, item: WeaponItem): void {
  if (S.sim.wielded === item) {
    note(S, MSG.alreadyEquipped(item.name));
  } else {
    S.sim.wielded = item;
    note(S, MSG.equipHums(item.name));
  }
}

/** Push a menu modal with its own stage, rows, and cursor. */
function openMenu(S: GameState, stage: MenuStage, rows: MenuRow[]): void {
  openModal(S.ui, { kind: "menu", stage, rows, cursor: 0 });
}

/** Open the equip menu with one hotkey row per carried weapon. */
export function showEquip(S: GameState): void {
  const rows: MenuRow[] = [
    { text: UI.equipTitle, key: null, hi: true },
    { text: "", key: null },
  ];
  carriedWeapons(S).forEach((item, i) => {
    rows.push({
      text: `${String.fromCharCode(97 + i)}) ${item.name}`,
      key: String.fromCharCode(97 + i),
    });
  });
  rows.push({ text: "", key: null }, { text: UI.endRow, key: null });
  openMenu(S, "equip", rows);
}

/** Script menu: pick one carried kind to execute a unit of. */
export function showScripts(S: GameState): void {
  const groups = groupScripts(S.sim.inventory);
  if (groups.length === 0) {
    note(S, NOTE.noScripts);
    return;
  }
  const rows: MenuRow[] = [
    { text: UI.scriptTitle, key: null, hi: true },
    { text: "", key: null },
  ];
  groups.forEach((group, i) => {
    const count = group.items.length > 1 ? ` x${group.items.length}` : "";
    rows.push({
      text: `${String.fromCharCode(97 + i)}) ${group.name}${count}`,
      key: String.fromCharCode(97 + i),
    });
  });
  rows.push({ text: "", key: null }, { text: UI.endRow, key: null });
  openMenu(S, "script", rows);
}

/** Execute a script: one unit spent, the substitution runs, a turn passes. */
export function executeScript(S: GameState, item: ScriptItem): void {
  S.sim.inventory.splice(S.sim.inventory.indexOf(item), 1);
  const effect = item.effect;
  let targets: Enemy[] = [];
  if (effect === "heal") {
    const amount = MAX_HP - S.sim.hp;
    S.sim.hp = MAX_HP;
    if (amount > 0) {
      S.sim.events.push({ type: "heal", amount });
    }
  } else {
    targets = scriptTargets(S.sim.level.enemies, S.sim.visible, effect);
  }
  // The script event names the effect; the kills and any level-up line
  // follow it, and the presenter composes them in order.
  S.sim.events.push({
    type: "script",
    effect,
    kills: targets.length,
  });
  for (const target of targets) {
    killEnemy(S, target);
  }
  passTurn(S);
}

/** Plain full inventory list. */
export function showInventory(S: GameState): void {
  const rows: MenuRow[] = [];
  S.sim.inventory.forEach((item, i) => {
    const letter = String.fromCharCode(97 + i);
    rows.push({
      text: `${letter}) ${item.name}${item === S.sim.wielded ? UI.equippedSuffix : ""}`,
      key: letter,
    });
  });
  if (S.sim.inventory.length === 0) {
    rows.push({ text: UI.emptyRow, key: null });
  }
  rows.push({ text: "", key: null }, { text: UI.endRow, key: null });
  openMenu(S, "list", rows);
}

/** Apply a letter hotkey inside the current inventory menu. */
function selectKey(
  S: GameState,
  chunk: string,
  commands: readonly string[],
): void {
  const menu = currentMenu(S.ui);
  if (menu === null) {
    return;
  }
  // Only a single letter chooses or cancels; arrows and escape sequences
  // leave the menu open (the arrow is never a vim motion here).
  if (chunk.length !== 1 || chunk < "a" || chunk > "z") {
    return;
  }
  const i = chunk.charCodeAt(0) - 97;
  if (menu.stage === "script") {
    const groups = groupScripts(S.sim.inventory);
    if (i >= 0 && i < groups.length) {
      executeScript(S, groups[i]!.items[0]!);
      closeInventory(S);
    } else {
      closeInventory(S);
    }
    return;
  }
  if (menu.stage === "equip") {
    const weapons = carriedWeapons(S);
    if (i >= 0 && i < weapons.length) {
      equipChoice(S, weapons[i]!);
      closeInventory(S);
    } else {
      closeInventory(S);
    }
    return;
  }
  if (menu.stage === "help") {
    if (chunk === "a") {
      openPager(S, UI.commandsTitle, [...commands]);
    } else if (chunk === "b") {
      openPager(S, UI.aboutTitle, ABOUT_LINES);
    } else {
      closeInventory(S);
    }
    return;
  }
  closeInventory(S);
}

/** The rows a cursor can land on: those carrying a hotkey. */
function selectableRows(S: GameState): MenuRow[] {
  return (currentMenu(S.ui)?.rows ?? []).filter((row) => row.key !== null);
}

/**
 * Inventory keys: j/k move the selection and Enter picks it; every other
 * key is a letter hotkey, handled by the caller when no binding matches.
 * The command reference is threaded through so the help stage can open it.
 */
function inventoryBindings(commands: readonly string[]): Binding<KeyCtx>[] {
  return [
    {
      keys: ["j", "J"],
      run: (c) => {
        const menu = currentMenu(c.S.ui);
        if (menu !== null) {
          menu.cursor = Math.min(
            menu.cursor + 1,
            selectableRows(c.S).length - 1,
          );
        }
      },
    },
    {
      keys: ["k", "K"],
      run: (c) => {
        const menu = currentMenu(c.S.ui);
        if (menu !== null) {
          menu.cursor = Math.max(menu.cursor - 1, 0);
        }
      },
    },
    {
      keys: ["<CR>"],
      run: (c) => {
        const cur = selectableRows(c.S)[currentMenu(c.S.ui)?.cursor ?? 0];
        if (cur === undefined) {
          closeInventory(c.S);
        } else {
          selectKey(c.S, cur.key as string, commands);
        }
      },
    },
  ];
}

/** Menu keys: move the cursor, pick a row, or handle a hotkey. */
export function inventoryKey(
  S: GameState,
  chunk: string,
  commands: readonly string[],
): void {
  // A letter hotkey is the catch-all: only j/k/Enter are bound.
  if (!dispatch(inventoryBindings(commands), { S }, chunk)) {
    selectKey(S, chunk, commands);
  }
}

/** Close the top inventory menu. */
export function closeInventory(S: GameState): void {
  closeModal(S.ui);
}

/** Width for descriptive rows in the details panel. */
const DETAIL_TEXT_W = 50;

/** Wrap details rows to a readable width, keeping highlights on first lines. */
function wrapDetails(rows: MenuRow[]): MenuRow[] {
  return rows.flatMap((row) =>
    wrapText(row.text, DETAIL_TEXT_W).map((text, i) => ({
      text,
      key: i === 0 ? row.key : null,
      hi: i === 0 ? row.hi : undefined,
    })),
  );
}

/** Details menu for the look cursor. Returns to look afterwards. */
export function showDetailsFor(S: GameState, c: Vec): void {
  const rows: MenuRow[] = [];
  const enemy = enemyAt(S, c.x, c.y);
  if (enemy !== undefined) {
    const name = enemyName(enemy.kind, enemy.version);
    rows.push(
      { text: MSG.enemyHeader(name), key: null, hi: true },
      { text: "", key: null },
    );
    rows.push(
      { text: MSG.enemyHp(enemy.hp), key: null },
      { text: MSG.enemyBite(enemy.bite), key: null },
      { text: "", key: null },
      ...ENEMY_KINDS[enemy.kind].flavor.map((text) => ({ text, key: null })),
    );
  } else {
    const g = itemAt(S, c.x, c.y);
    if (g !== undefined) {
      rows.push(
        { text: MSG.itemHeader(g.item.name), key: null, hi: true },
        { text: "", key: null },
        ...itemDetails(g.item, S.sim.wielded === g.item).map((text) => ({
          text,
          key: null,
        })),
      );
    } else if (c.x === S.sim.player.x && c.y === S.sim.player.y) {
      rows.push(
        { text: MSG.yourself(S.sim.hp, MAX_HP), key: null, hi: true },
        { text: "", key: null },
        { text: MSG.playerHp(S.sim.hp, MAX_HP), key: null },
        {
          text:
            S.sim.wielded !== null
              ? MSG.wielding(S.sim.wielded.name)
              : MSG.emptyHanded,
          key: null,
        },
      );
    }
  }
  if (rows.length === 0) {
    note(S, NOTE.noDetails);
    return;
  }
  rows.push({ text: "", key: null }, { text: UI.endRow, key: null });
  openMenu(S, "details", wrapDetails(rows));
}
