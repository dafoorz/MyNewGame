// Per-device keybind customization (browser localStorage). Bindings are stored
// as KeyboardEvent.code values (e.g. 'KeyW', 'Digit1', 'Space') so they survive
// rebinding to any physical key. Browser-only — never imported by the server.

const KEY = 'mng_keybinds_v1';

export const DEFAULT_BINDS = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  attack: 'Space',
  skill1: 'Digit1', skill2: 'Digit2', skill3: 'Digit3', skill4: 'Digit4', skill5: 'KeyE',
  aim: 'KeyQ', char: 'KeyC', inv: 'KeyI', tree: 'KeyK',
  block: 'KeyR', map: 'KeyM', shop: 'KeyB',
};

// Display order + labels for the settings panel.
export const BIND_ROWS = [
  ['up', 'Move Up'], ['down', 'Move Down'], ['left', 'Move Left'], ['right', 'Move Right'],
  ['attack', 'Basic Attack'],
  ['skill1', 'Skill 1'], ['skill2', 'Skill 2'], ['skill3', 'Skill 3'], ['skill4', 'Skill 4'], ['skill5', 'Dodge'],
  ['aim', 'Toggle Aim'], ['char', 'Character Panel'], ['inv', 'Inventory'], ['tree', 'Skill Tree'],
  ['block', 'Block / Parry'], ['map', 'World Map'], ['shop', 'Town Shop'],
];

export function loadKeybinds() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; }
  return { ...DEFAULT_BINDS, ...saved };
}

export function saveKeybinds(binds) {
  try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch { /* private mode / quota */ }
}

export function resetKeybinds() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return { ...DEFAULT_BINDS };
}

// Human-readable label for a KeyboardEvent.code.
export function codeLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (code in arrows) return arrows[code];
  const named = { Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backquote: '`', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL' };
  return named[code] || code;
}
