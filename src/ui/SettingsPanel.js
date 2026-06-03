import { CONFIG } from '../config.js';
import { loadKeybinds, saveKeybinds, resetKeybinds, BIND_ROWS, codeLabel } from '../keybinds.js';

// Reusable in-game Settings overlay (used by both solo and online scenes).
// Owns the live keybindings (`binds`), which the host scene reads for movement
// and action dispatch. Mirrors the existing character-panel pattern: a hidden
// Phaser container toggled visible. While a rebind is pending, captureKey()
// consumes the next key press.
//
// opts:
//   onMainMenu()        - leave to the class-select screen
//   onResetProgress()   - optional; wipes this class's save (solo only)

export default class SettingsPanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.binds = loadKeybinds();
    this.open = false;
    this.rebinding = null;     // action name awaiting a key, or null
    this.confirmReset = false;  // two-step guard for Reset Progress
    this.build();
  }

  // Reverse-lookup: which action (if any) is bound to a KeyboardEvent.code.
  actionFor(code) {
    for (const k in this.binds) if (this.binds[k] === code) return k;
    return null;
  }

  build() {
    const cx = CONFIG.width / 2, cy = CONFIG.height / 2;
    const s = this.scene;
    const W = 470, H = 520;
    const panel = s.add.container(0, 0).setDepth(130).setScrollFactor(0).setVisible(false);
    panel.add(s.add.rectangle(cx, cy, W, H, 0x10131f, 0.97).setStrokeStyle(2, 0xb8a4ff).setScrollFactor(0));
    panel.add(s.add.text(cx, cy - H / 2 + 22, 'SETTINGS', { fontFamily: 'Segoe UI', fontSize: '18px', fontStyle: 'bold', color: '#b8a4ff' }).setOrigin(0.5).setScrollFactor(0));
    panel.add(s.add.text(cx, cy - H / 2 + 46, 'Keybinds — click a key to rebind', { fontFamily: 'Segoe UI', fontSize: '11px', color: '#8b93ad' }).setOrigin(0.5).setScrollFactor(0));

    // Keybind rows.
    this.rowBtns = {};
    const y0 = cy - H / 2 + 74, rowH = 24;
    BIND_ROWS.forEach(([action, label], i) => {
      const ry = y0 + i * rowH;
      panel.add(s.add.text(cx - W / 2 + 26, ry, label, { fontFamily: 'Consolas, monospace', fontSize: '13px', color: '#e6e9f2' }).setOrigin(0, 0.5).setScrollFactor(0));
      const keyBg = s.add.rectangle(cx + W / 2 - 90, ry, 120, 20, 0x222845, 1).setStrokeStyle(1, 0x3a4366).setScrollFactor(0).setInteractive({ useHandCursor: true });
      const keyTxt = s.add.text(cx + W / 2 - 90, ry, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5).setScrollFactor(0);
      keyBg.on('pointerdown', () => this.startRebind(action));
      panel.add(keyBg); panel.add(keyTxt);
      this.rowBtns[action] = { bg: keyBg, txt: keyTxt };
    });

    // Action buttons.
    const mkBtn = (x, y, w, label, color, cb) => {
      const r = s.add.rectangle(x, y, w, 36, color, 1).setStrokeStyle(2, 0xffffff, 0.35).setScrollFactor(0).setInteractive({ useHandCursor: true });
      const t = s.add.text(x, y, label, { fontFamily: 'Segoe UI', fontSize: '14px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setScrollFactor(0);
      r.on('pointerover', () => r.setStrokeStyle(3, 0xffffff, 0.8));
      r.on('pointerout', () => r.setStrokeStyle(2, 0xffffff, 0.35));
      r.on('pointerdown', cb);
      panel.add(r); panel.add(t);
      return t;
    };
    const by = cy + H / 2;
    mkBtn(cx - 115, by - 130, 210, 'MAIN MENU', 0x3a4f8a, () => this.opts.onMainMenu && this.opts.onMainMenu());
    mkBtn(cx + 115, by - 130, 210, 'RESUME', 0x2a6e3a, () => this.hide());
    mkBtn(cx - 115, by - 88, 210, 'RESET KEYBINDS', 0x4a3a6a, () => { this.binds = resetKeybinds(); this.refresh(); });
    mkBtn(cx + 115, by - 88, 210, 'FULLSCREEN', 0x33384a, () => { if (s.scale.isFullscreen) s.scale.stopFullscreen(); else s.scale.startFullscreen(); });
    if (this.opts.onResetProgress) {
      this.resetTxt = mkBtn(cx, by - 46, 432, 'RESET CLASS PROGRESS', 0x7a2f3a, () => {
        if (!this.confirmReset) { this.confirmReset = true; this.resetTxt.setText('CLICK AGAIN TO CONFIRM RESET'); return; }
        this.opts.onResetProgress();
      });
    }

    this.panel = panel;
    this.refresh();
  }

  startRebind(action) {
    if (this.rebinding) this.rowBtns[this.rebinding].txt.setText(codeLabel(this.binds[this.rebinding])).setColor('#ffd24a');
    this.rebinding = action;
    this.rowBtns[action].txt.setText('press a key…').setColor('#9be8ff');
  }

  // Called by the scene's keydown handler. Returns true if it consumed the key.
  captureKey(e) {
    if (!this.open || !this.rebinding) return false;
    const action = this.rebinding;
    this.rebinding = null;
    if (e.code !== 'Escape') {
      // If the key is already used elsewhere, free that binding first.
      const clash = this.actionFor(e.code);
      if (clash && clash !== action) this.binds[clash] = null;
      this.binds[action] = e.code;
      saveKeybinds(this.binds);
    }
    this.refresh();
    return true;
  }

  refresh() {
    for (const [action] of BIND_ROWS) this.rowBtns[action].txt.setText(codeLabel(this.binds[action])).setColor('#ffd24a');
    if (this.resetTxt) { this.confirmReset = false; this.resetTxt.setText('RESET CLASS PROGRESS'); }
  }

  show() { this.open = true; this.panel.setVisible(true); this.refresh(); }
  hide() { this.open = false; this.rebinding = null; this.panel.setVisible(false); }
  toggle() { this.open ? this.hide() : this.show(); }
}
