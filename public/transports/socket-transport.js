// Socket.IO transport (default). Connects to the same-origin server and uses wss automatically on https pages.
import { io } from 'socket.io-client';

export class SocketTransport {
  constructor() {
    this.kind = 'socket';
    this.statusFns = [];
    this.status = 'connecting';
    this.socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 });
    this.socket.on('connect', () => this.setStatus('online'));
    this.socket.on('disconnect', () => this.setStatus('reconnecting'));
    this.socket.on('connect_error', () => this.setStatus('offline'));
    this.socket.io.on('reconnect_attempt', () => this.setStatus('reconnecting'));
  }

  setStatus(s) {
    this.status = s;
    for (const fn of this.statusFns) fn(s);
  }

  onStatus(fn) {
    this.statusFns.push(fn);
    fn(this.status);
  }

  on(ev, fn) { this.socket.on(ev, fn); }

  emit(ev, data, ack) {
    if (!this.socket.connected) {
      ack?.({ ok: false, reason: 'Not connected to the server.' });
      return;
    }
    if (ack) this.socket.timeout(6000).emit(ev, data, (err, res) => ack(err ? { ok: false, reason: 'Server timed out' } : res));
    else this.socket.emit(ev, data);
  }
}
