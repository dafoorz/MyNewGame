import { CONFIG } from '../config.js';

// Entry screen: choose how to play (Solo / Create party / Join party). The
// class is chosen next, in ClassSelectScene, which actually starts the game.

export default class LobbyScene extends Phaser.Scene {
  constructor() { super('LobbyScene'); }

  create() {
    this.cameras.main.setBackgroundColor(CONFIG.colors.bg);
    const cx = CONFIG.width / 2;

    this.add.text(cx, 70, 'MyNewGame', { fontFamily: 'Segoe UI', fontSize: '40px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5);
    this.add.text(cx, 120, 'CHOOSE A MODE', { fontFamily: 'Segoe UI', fontSize: '20px', fontStyle: 'bold', color: '#cdd6ee' }).setOrigin(0.5);

    // Solo
    this.makeButton(cx, 200, 360, 54, 'PLAY SOLO  (offline)', 0x2a6e3a, () => {
      this.scene.start('ClassSelectScene', { mode: 'solo' });
    });

    this.add.text(cx, 270, '— or play online with friends —', { fontFamily: 'Segoe UI', fontSize: '14px', color: '#9aa6c4' }).setOrigin(0.5);

    this.makeButton(cx - 95, 320, 170, 50, 'CREATE PARTY', 0x3a4f8a, () => this.showForm('create'));
    this.makeButton(cx + 95, 320, 170, 50, 'JOIN PARTY',   0x3a4f8a, () => this.showForm('join'));

    this.status = this.add.text(cx, 560, '', { fontFamily: 'Segoe UI', fontSize: '14px', color: '#ffb4a8', align: 'center', wordWrap: { width: 600 } }).setOrigin(0.5);

    this.formEl = null;
    this.mode = null;
  }

  showForm(mode) {
    this.mode = mode;
    if (this.formEl) this.formEl.destroy();

    const cx = CONFIG.width / 2;
    const showCode = mode === 'join';
    const label = mode === 'create' ? 'CREATE → pick class' : 'JOIN → pick class';

    const form = document.createElement('div');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:340px;';
    form.innerHTML = `
      <input id="pname" maxlength="16" placeholder="Your name" style="${INPUT_CSS}" />
      ${showCode ? `<input id="pcode" maxlength="4" placeholder="Party code (4 letters)" style="${INPUT_CSS};text-transform:uppercase" />` : ''}
      <button id="pgo" style="${BTN_CSS}">${label}</button>`;
    this.formEl = this.add.dom(cx, showCode ? 430 : 415, form);
    form.querySelector('#pgo').addEventListener('click', () => this.next());

    this.status.setText('');
    setTimeout(() => { const el = form.querySelector('#pname'); if (el) el.focus(); }, 80);
  }

  makeButton(x, y, w, h, label, color, onClick) {
    const r = this.add.rectangle(x, y, w, h, color, 1).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    r.on('pointerover', () => r.setStrokeStyle(3, 0xffffff, 0.9));
    r.on('pointerout',  () => r.setStrokeStyle(2, 0xffffff, 0.4));
    r.on('pointerdown', onClick);
    return r;
  }

  field(id) { const el = this.formEl && this.formEl.node.querySelector('#' + id); return el ? el.value.trim() : ''; }

  next() {
    const name = this.field('pname') || 'Player';
    const code = (this.field('pcode') || '').toUpperCase();
    if (this.mode === 'join' && code.length < 4) { this.status.setText('Enter a 4-character party code to join.'); return; }
    if (this.formEl) this.formEl.destroy();
    this.scene.start('ClassSelectScene', { mode: this.mode, name, code });
  }
}

const INPUT_CSS = 'padding:10px;border-radius:6px;border:1px solid #3a4366;background:#10131f;color:#e6e9f2;font-size:15px;font-family:Segoe UI,sans-serif;outline:none';
const BTN_CSS = 'padding:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:#3a4f8a;color:#fff;font-size:15px;font-weight:bold;font-family:Segoe UI,sans-serif;cursor:pointer';
