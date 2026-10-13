/**
 * End-screen keys, shared by the bindings and their on-screen prompts.
 *
 * These live outside content: they follow the keymap, so changing a binding
 * here updates its hint at the same time.
 */
export const END_KEYS = {
  replay: "r",
  quit: "q",
} as const;
