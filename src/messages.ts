/**
 * Messages: the presenter turns this key's events into the one styled line.
 *
 * The simulation appends typed events and holds no styled display text. This
 * module owns the wording, the emphasis, and the width trim that drops the
 * oldest sentences first. A `clear` event starts a new line, so an auto-run
 * that took several turns yields several lines the presenter can replay.
 */
import { ENEMY_KINDS, enemyName, healthLabel, woundWord } from "./enemies.ts";
import { scriptMessage, shotMessage } from "./items.ts";
import {
  DEATH_LINE,
  ELEVATOR_LINE,
  FLOOR_CLEAR_LINE,
  MSG,
  WIN_LINE,
} from "./content.ts";
import { type RichText, plain, sliceSpans, spans, textWidth } from "./style.ts";
import { STYLE_BLUE, STYLE_REVERSE, STYLE_YELLOW, WIDTH } from "./theme.ts";
import type { SimEvent } from "./game-state.ts";

/** One event's contribution to the line, or null when it only records a fact. */
function render(event: SimEvent): RichText | null {
  switch (event.type) {
    case "kill":
    case "heal":
    case "clear":
      return null;
    case "bite":
      return event.fatal
        ? DEATH_LINE
        : MSG.bite(enemyName(event.kind, event.version), event.kind);
    case "level-up":
      return spans({ text: MSG.levelUp(event.level), ...STYLE_REVERSE });
    case "unlock":
      return MSG.unlock;
    case "slain":
      return ENEMY_KINDS[event.kind].killMsg(
        enemyName(event.kind, event.version),
      );
    case "meleeHit":
      return spans(
        MSG.meleeHitLead,
        healthLabel(
          enemyName(event.kind, event.version),
          event.hp,
          event.maxHp,
        ),
        ".",
      );
    case "shot":
      return shotMessage(event.killed, event.wounded, event.shortfall);
    case "script":
      return scriptMessage(event.effect, event.kills);
    case "look-enemy": {
      const name = enemyName(event.kind, event.version);
      const wound = woundWord(event.hp, event.maxHp);
      const sight = event.sees ? MSG.lookSees : MSG.lookUnseen;
      return spans(
        `${MSG.lookLead}${wound}`,
        healthLabel(name, event.hp, event.maxHp),
        sight,
      );
    }
    case "insert": {
      const bullet = { text: MSG.insertBullet, ...STYLE_BLUE };
      switch (event.state) {
        case "already":
          return spans(MSG.insertAlreadyLead, bullet, MSG.insertModeSuffix);
        case "stance":
          return spans(bullet, MSG.insertModeSuffix);
        case "chambered":
          return event.gun === undefined
            ? spans(bullet, MSG.insertChamberedSuffix)
            : spans(
                MSG.equipLead(event.gun),
                bullet,
                MSG.insertChamberedSuffix,
              );
      }
    }
    case "visual-block":
      return spans(
        { text: MSG.visualBlockLabel, ...STYLE_YELLOW },
        MSG.visualBlockHelp,
      );
    case "elevator-on":
      return ELEVATOR_LINE;
    case "floor-clear":
      return FLOOR_CLEAR_LINE;
    case "win":
      return WIN_LINE;
    case "note":
      return event.text;
  }
}

/** Join one run of rendered pieces with single spaces. */
function weave(pieces: readonly RichText[]): RichText {
  let text: RichText = "";
  for (const piece of pieces) {
    text = plain(text) === "" ? piece : spans(text, " ", piece);
  }
  return text;
}

/** Join rendered pieces, then drop leading sentences until the line fits. */
function join(events: readonly SimEvent[]): RichText {
  const pieces: RichText[] = [];
  for (const event of events) {
    const piece = render(event);
    if (piece !== null && plain(piece) !== "") {
      pieces.push(piece);
    }
  }
  let text = weave(pieces);
  while (textWidth(text) > WIDTH) {
    const whole = plain(text);
    const edge = /[.!?] /.exec(whole);
    if (edge === null) {
      break;
    }
    text = sliceSpans(text, edge.index + 2, whole.length);
  }
  return text;
}

/**
 * One history entry per rendered event, before the line trim. The log keeps
 * the facts the one-line message may drop.
 */
export function formatLog(events: readonly SimEvent[]): RichText[] {
  const entries: RichText[] = [];
  for (const event of events) {
    const text = render(event);
    if (text !== null && plain(text) !== "") {
      entries.push(text);
    }
  }
  return entries;
}

/** The events of one turn as a single line, oldest sentences trimmed first. */
export function formatMessage(events: readonly SimEvent[]): RichText {
  return join(events);
}

/**
 * The last non-empty turn's line, which is the message the frame keeps.
 * A key that ran several turns starts a new line on every `clear`; earlier
 * lines stay in the log, while only the final one remains on screen.
 */
export function formatLastMessage(events: readonly SimEvent[]): RichText {
  let last: RichText = "";
  let turn: SimEvent[] = [];
  const flush = (): void => {
    if (turn.length === 0) {
      return;
    }
    const line = join(turn);
    if (plain(line) !== "") {
      last = line;
    }
    turn = [];
  };
  for (const event of events) {
    if (event.type === "clear") {
      flush();
    } else {
      turn.push(event);
    }
  }
  flush();
  return last;
}
