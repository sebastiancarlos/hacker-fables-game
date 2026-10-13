/**
 * Index shim: public entry preserved for tests and tooling.
 *
 * The game now lives in cohesive modules (theme, queries, render, vision,
 * progress, monsters, levels, combat, inventory, pager, look, movement, key,
 * terminal, input, modes, replay, game, main). This file only re-exports the
 * headless API plus layout constants so `import { Game } from
 * "../src/index.ts"` keeps working.
 */
/** The game's public headless surface. */
export { Game, type GameDeps } from "./game.ts";
export {
  WIDTH,
  HEIGHT,
  MAP_TOP,
  STATUS_ROW,
  DUNGEON_ROW,
  COMMAND_ROW,
} from "./theme.ts";
