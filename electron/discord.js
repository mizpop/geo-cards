// Discord Rich Presence（Discord のプロフィールの「プレイ中」に、今見ているタブなどを出す）。
// Discord アプリが起動しているときだけ、ローカルの IPC（名前付きパイプ）で接続する。ライブラリは使わず、必要な分だけ実装している
const net = require('net');
const os = require('os');
const path = require('path');

const DEBUG = !!process.env.GEOCHECKER_DEBUG_DISCORD; // 動作確認用: Discord とのやり取りを表示する
const log = (...a) => { if (DEBUG) console.log('[discord]', ...a); };
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MIN_INTERVAL = 4000; // 更新の間隔（Discord は短い間に何度も更新すると制限する）
const RETRY_MS = 15000; // Discord が起動していない・切れたときの、つなぎ直しの間隔

const pipePath = (i) => (process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir() || '/tmp', `discord-ipc-${i}`));

const encode = (op, data) => {
  const json = Buffer.from(JSON.stringify(data));
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
};

class DiscordPresence {
  constructor(clientId, pipeStart = 0) {
    this.clientId = clientId;
    this.pipeStart = pipeStart; // 最初に試すパイプの番号（動作確認用に、本物の Discord を避けられるように）
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.desired = null; // 出したい内容（null なら消す）
    this.sent = undefined; // 最後に送った内容（JSON）
    this.lastSend = 0;
    this.timer = null;
    this.retry = null;
    this.closed = false;
    this.nonce = 0;
    this.status = 'idle'; // idle（まだ何も出していない）/ connecting / ready（つながった）/ no-discord（Discord が見つからない）
  }

  /** 内容を設定する。activity: { details, state } か、null（消す）。つながっていなければ、つながったときに出す */
  set(activity) {
    this.desired = activity;
    if (!this.sock && !this.retry) this.connect();
    this.flush();
  }

  connect(i = this.pipeStart) {
    if (this.closed || this.sock) return;
    if (i > this.pipeStart + 9) { this.status = 'no-discord'; this.scheduleRetry(); return; }
    if (i === this.pipeStart) this.status = 'connecting';
    const sock = net.createConnection(pipePath(i));
    let opened = false;
    sock.once('connect', () => {
      log('connected', pipePath(i));
      opened = true;
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    sock.on('data', (d) => this.onData(d));
    sock.on('error', (e) => { log('error', i, e.code); if (!opened) this.connect(i + 1); }); // 次のパイプ番号を試す
    sock.on('close', () => {
      if (!opened) return;
      this.sock = null; this.ready = false; this.sent = undefined; this.status = 'no-discord';
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, RETRY_MS);
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let payload = null;
      try { payload = JSON.parse(this.buf.slice(8, 8 + len).toString()); } catch { /* 無視 */ }
      this.buf = this.buf.slice(8 + len);
      log('recv', op, JSON.stringify(payload)?.slice(0, 200));
      if (op === OP.PING) this.sock?.write(encode(OP.PONG, payload || {}));
      else if (op === OP.CLOSE) { this.sock?.destroy(); }
      else if (op === OP.FRAME && payload?.evt === 'READY') { this.ready = true; this.status = 'ready'; this.flush(); }
    }
  }

  flush() {
    if (!this.ready || !this.sock) return;
    const json = JSON.stringify(this.desired);
    if (json === this.sent) return;
    const wait = this.lastSend + MIN_INTERVAL - Date.now();
    if (wait > 0) { if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait); return; }
    this.lastSend = Date.now();
    this.sent = json;
    log('send', json);
    this.sock.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: this.desired ? { ...this.desired, instance: false } : undefined },
      nonce: String(++this.nonce),
    }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer); clearTimeout(this.retry);
    try { if (this.sock && this.ready) this.sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: 'bye' })); } catch { /* 無視 */ }
    try { this.sock?.destroy(); } catch { /* 無視 */ }
  }
}

module.exports = { DiscordPresence };
