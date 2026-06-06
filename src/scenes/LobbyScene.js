import { CONFIG } from '../config.js';
import { CLASSES } from '../classes/classes.js';
import NetClient from '../net/NetClient.js';
import { loadProgress } from '../progress.js';

export default class LobbyScene extends Phaser.Scene {
  constructor() { super('LobbyScene'); }

  create(data) {
    this.classKey = data.classKey;
    const def = CLASSES[this.classKey];
    this.cameras.main.setBackgroundColor(CONFIG.colors.bg);
    const cx = CONFIG.width / 2;

    this.add.text(cx, 60, 'CHOOSE A MODE', { fontFamily: 'Segoe UI', fontSize: '32px', fontStyle: 'bold', color: '#ffd24a' }).setOrigin(0.5);
    this.add.circle(cx - 120, 110, 12, def.color);
    this.add.text(cx - 100, 100, `${def.name} — ${def.role}`, { fontFamily: 'Segoe UI', fontSize: '16px', color: '#fff' }).setOrigin(0, 0.5);

    // Solo
    this.makeButton(cx, 180, 360, 54, 'PLAY SOLO  (offline)', 0x2a6e3a, () => {
      this.scene.start('GameScene', { classKey: this.classKey });
    });

    this.add.text(cx, 250, '— or play online with friends —', { fontFamily: 'Segoe UI', fontSize: '14px', color: '#9aa6c4' }).setOrigin(0.5);

    this.btnCreate = this.makeButton(cx - 95, 300, 170, 50, 'CREATE PARTY', 0x3a4f8a, () => this.showForm('create'));
    this.btnJoin   = this.makeButton(cx + 95, 300, 170, 50, 'JOIN PARTY',   0x3a4f8a, () => this.showForm('join'));

    this.makeButton(cx, 380, 200, 40, '← Back', 0x33384a, () => this.scene.start('ClassSelectScene'));

    this.status = this.add.text(cx, 540, '', { fontFamily: 'Segoe UI', fontSize: '14px', color: '#ffb4a8', align: 'center', wordWrap: { width: 600 } }).setOrigin(0.5);

    this.formEl = null;
    this.confirmBtn = null;
    this.mode = null;
  }

  showForm(mode) {
    this.mode = mode;
    if (this.formEl) this.formEl.destroy();
    if (this.confirmBtn) { this.confirmBtn.forEach(o => o.destroy()); this.confirmBtn = null; }

    const cx = CONFIG.width / 2;
    const showCode = mode === 'join';

    const form = document.createElement('div');
    form.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:340px;';
    form.innerHTML = `
      <input id="pname" maxlength="16" placeholder="Your name" style="${INPUT_CSS}" />
      ${showCode ? `<input id="pcode" maxlength="4" placeholder="Party code (4 letters)" style="${INPUT_CSS};text-transform:uppercase" />` : ''}`;
    this.formEl = this.add.dom(cx, showCode ? 460 : 450, form);

    const label = mode === 'create' ? 'CREATE →' : 'JOIN →';
    const cy = showCode ? 530 : 510;
    const r = this.add.rectangle(cx, cy, 170, 46, 0x3a4f8a, 1).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
    const t = this.add.text(cx, cy, label, { fontFamily: 'Segoe UI', fontSize: '15px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    r.on('pointerover', () => r.setStrokeStyle(3, 0xffffff, 0.9));
    r.on('pointerout',  () => r.setStrokeStyle(2, 0xffffff, 0.4));
    r.on('pointerdown', () => this.go());
    this.confirmBtn = [r, t];

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

  go() {
    const name = this.field('pname') || 'Player';
    const code = (this.field('pcode') || '').toUpperCase();
    if (this.mode === 'join' && code.length < 4) { this.status.setText('Enter a 4-character party code to join.'); return; }

    this.status.setText('Connecting…');
    const net = new NetClient();
    net.on('error', (d) => this.status.setText(d.message + '\n(Online needs the server running — see README. Solo works offline.)'));
    net.on('join_error', (d) => this.status.setText(d.message));
    net.on('party_joined', () => {
      if (this.formEl) this.formEl.destroy();
      this.scene.start('OnlineScene', { net, classKey: this.classKey });
    });
    const progress = loadProgress(this.classKey);
    net.on('connect', () => {
      if (this.mode === 'create') net.createParty(name, this.classKey, progress);
      else net.joinParty(code, name, this.classKey, progress);
    });
    net.connect();
  }
}

const INPUT_CSS = 'padding:10px;border-radius:6px;border:1px solid #3a4366;background:#10131f;color:#e6e9f2;font-size:15px;font-family:Segoe UI,sans-serif;outline:none';
