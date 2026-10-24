// Optional extension: Web Bluetooth adapter.
// Ordinary phone browsers cannot act as a BLE peripheral (advertise), so a phone browser cannot connect directly to a PC browser.
// This adapter only works when a separate BLE device (a microcontroller, etc.) or a native bridge
// provides the GATT service in config.BLUETOOTH. Not verified on real hardware.
// Web Bluetooth (BLE GATT) is a different API from Bluetooth Classic SPP or Web Serial.
import { BLUETOOTH, INPUT_TIMEOUT_MS } from '../../shared/config.js';

export function parsePacket(view) {
  if (view.byteLength < BLUETOOTH.packetLength) return null;
  const mx = Math.max(-1, view.getInt8(1) / 127);
  const mz = Math.max(-1, view.getInt8(2) / 127);
  const aim = (view.getUint16(3, true) / 65535) * Math.PI * 2;
  const b = view.getUint8(5);
  return { seq: view.getUint8(0), mx, mz, aim: aim > Math.PI ? aim - Math.PI * 2 : aim, fire: !!(b & 1), ads: !!(b & 2), reload: !!(b & 4), interact: !!(b & 8), swap: !!(b & 16) };
}

export class BleControllerAdapter {
  static supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth && window.isSecureContext;
  }

  constructor({ onStatus }) {
    this.onStatus = onStatus;
    this.device = null;
    this.char = null;
    this.latest = null;
    this.latestAt = 0;
    this.edges = { reload: false, interact: false, swap: false };
    this.connected = false;
    this.onValue = (e) => this.handle(e.target.value);
    this.onDisconnect = () => this.setDisconnected('The device disconnected.');
  }

  // Must be called inside a user gesture such as a button click
  async connect() {
    try {
      this.onStatus('connecting', 'Choose a BLE device…');
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLUETOOTH.serviceUuid] }] });
      this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(BLUETOOTH.serviceUuid);
      this.char = await service.getCharacteristic(BLUETOOTH.inputCharacteristicUuid);
      this.char.addEventListener('characteristicvaluechanged', this.onValue);
      await this.char.startNotifications();
      this.connected = true;
      this.onStatus('connected', `Connected: ${this.device.name ?? 'BLE controller'} (untested on hardware)`);
    } catch (err) {
      this.setDisconnected(err?.name === 'NotFoundError' ? 'No device was selected.' : `Connection failed: ${err?.message ?? err}`);
    }
  }

  handle(view) {
    const p = parsePacket(view);
    if (!p) return;
    if (p.reload) this.edges.reload = true;
    if (p.interact) this.edges.interact = true;
    if (p.swap) this.edges.swap = true;
    this.latest = p;
    this.latestAt = performance.now();
  }

  // neutral input 300ms after the last packet
  read() {
    const fresh = this.latest && performance.now() - this.latestAt <= INPUT_TIMEOUT_MS;
    const base = fresh ? this.latest : { mx: 0, mz: 0, aim: this.latest?.aim ?? 0, fire: false, ads: false };
    const out = { mx: base.mx, mz: base.mz, aim: base.aim, fire: base.fire, ads: base.ads, ...this.edges };
    this.edges = { reload: false, interact: false, swap: false };
    return out;
  }

  disconnect() {
    try { this.char?.stopNotifications(); } catch { /* already disconnected */ }
    this.device?.gatt?.disconnect();
    this.setDisconnected('Disconnected.');
  }

  setDisconnected(msg) {
    this.connected = false;
    this.latest = null;
    this.char?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.char = null;
    this.onStatus('disconnected', msg);
  }
}
