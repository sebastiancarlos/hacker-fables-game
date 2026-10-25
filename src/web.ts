/**
 * Web entry point: xterm.js front end for the browser.
 *
 * The game core is unchanged; this module only wires xterm.js, browser
 * storage, and the web terminal adapter together.
 */
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { Recording } from "./recording.ts";

declare global {
  interface Window {
    hackerFables: {
      getScreenText: () => string;
    };
  }
}
import { AnsiScreen } from "./screen.ts";
import { Game } from "./game.ts";
import { decodeInput } from "./terminal-input.ts";
import { SCREEN_ROWS, WIDTH } from "./theme.ts";
import {
  appendScore,
  createWebTerminal,
  readRecording,
  readScores,
  recordingEntries,
  resolveReplay,
  saveRecording,
} from "./platform-web.ts";

/** Query parameters accepted by the web build. */
const params = new URLSearchParams(window.location.search);
const arena = params.get("arena") === "1" || params.get("arena") === "true";
const seedParam = params.get("seed");
const seed = seedParam === null ? undefined : Number(seedParam);
const levelParam = params.get("level");
const startDepth = levelParam === null ? undefined : Number(levelParam);
const replayTarget = params.get("replay") ?? undefined;
const showTitle = params.get("title") !== "false";

/** Terminal container. */
const container = document.getElementById("terminal");
if (container === null) {
  throw new Error("missing #terminal element");
}

/** xterm.js terminal, fixed to the game's 80x25 grid. */
const term = new Terminal({
  cols: WIDTH,
  rows: SCREEN_ROWS,
  scrollback: 0,
  cursorBlink: true,
  fontFamily: "monospace",
  fontSize: 16,
  lineHeight: 1,
});
term.open(container);

/** Put keyboard focus on xterm so the first keypress reaches the game. */
function focusTerminal(): void {
  term.focus();
}

focusTerminal();
requestAnimationFrame(focusTerminal);

/** Size the 80x25 grid's font to fill available viewport space. */
function fitTerminal(): void {
  const element = container as HTMLElement;
  let low = 8;
  let high = 96;
  let best = term.options.fontSize ?? 16;

  for (let i = 0; i < 14; i += 1) {
    const size = Math.floor((low + high) / 2);
    term.options.fontSize = size;
    term.refresh(0, term.rows - 1);

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (
      width > 0 &&
      height > 0 &&
      width <= window.innerWidth * 0.96 &&
      height <= window.innerHeight * 0.96
    ) {
      best = size;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  term.options.fontSize = best;
  term.refresh(0, term.rows - 1);
}

fitTerminal();
window.addEventListener("resize", fitTerminal);
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => {
    webglAddon.dispose();
  });
  term.loadAddon(webglAddon);
} catch {
  // Fall back to xterm's built-in canvas renderer.
}

/** Screen and platform adapter. */
const screen = new AnsiScreen(
  (s: string) => {
    term.write(s);
  },
  WIDTH,
  SCREEN_ROWS,
);
const quitRef = { current: () => window.location.reload() };
const webTerminal = createWebTerminal(term, () => quitRef.current());

/** Active game instance. */
let game: Game | null = null;

/** Replace the active game, closing the old one first. */
function replace(next: Game): void {
  game?.close();
  game = next;
  next.boot();
}

/** Replay a recording in a fresh, unscored game. */
function replay(rec: Recording): void {
  replace(
    new Game({
      screen,
      sleep: webTerminal.sleep,
      quit: webTerminal.quit,
      arena: rec.arena,
      showQuit: false,
      seed: rec.seed,
      startDepth: rec.depth,
      title: false,
      replay: rec.keys,
      onReplay: replay,
      onQuitToTitle: () => {
        start(true);
      },
      saveScore: (line) => {
        appendScore(line);
      },
      readScores: () => readScores(),
      saveRecording: (name, text) => {
        saveRecording(name, text);
      },
      recordings: recordingEntries(),
      onReplayPath: (path) => {
        const rec2 = readRecording(path);
        if (rec2 !== null) {
          replay(rec2);
        }
      },
    }),
  );
}

/** Start a fresh run. */
function start(title: boolean): void {
  replace(
    new Game({
      screen,
      sleep: webTerminal.sleep,
      quit: webTerminal.quit,
      arena,
      showQuit: false,
      seed,
      startDepth,
      title,
      saveScore: (line) => {
        appendScore(line);
      },
      readScores: () => readScores(),
      saveRecording: (name, text) => {
        saveRecording(name, text);
      },
      recordings: recordingEntries(),
      onReplay: replay,
      onReplayPath: (path) => {
        const rec = readRecording(path);
        if (rec !== null) {
          replay(rec);
        }
      },
      onQuitToTitle: () => {
        start(true);
      },
    }),
  );
}

quitRef.current = () => {
  start(true);
};

/** Boot. */
const requested = resolveReplay(replayTarget);
if (requested !== null) {
  replay(requested);
} else {
  start(showTitle);
}

/** Test hook for browser end-to-end tests. */
window.hackerFables = {
  getScreenText: (): string => {
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < term.rows; y += 1) {
      const line = buffer.getLine(y);
      lines.push(line === undefined ? "" : line.translateToString(true));
    }
    return lines.join("\\n");
  },
};

/** Input. */
term.onData((chunk) => {
  game?.onKey(decodeInput(chunk));
});
