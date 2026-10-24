// DOM HUD: health, ammo, weapon, alive/kills, zone, connection, minimap, kill feed, hitmarker, prompts
import { WEAPONS, ITEMS, WORLD_HALF, MAX_HP } from '../../shared/config.js';

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor(map) {
    this.map = map;
    this.el = {
      hud: $('hud'), hpFill: $('hp-fill'), hpText: $('hp-text'),
      weaponName: $('weapon-name'), mag: $('ammo-mag'), reserve: $('ammo-reserve'), slots: $('weapon-slots'),
      alive: $('stat-alive'), kills: $('stat-kills'),
      zonePhase: $('zone-phase'), zoneTimer: $('zone-timer'), zoneInfo: $('zone-info'),
      net: $('net-status'), netDot: $('net-dot'), ctrl: $('ctrl-status'), fps: $('fps'),
      killfeed: $('killfeed'), banner: $('banner'), prompt: $('prompt'), toast: $('toast'),
      cross: $('crosshair'), hit: $('hitmarker'), reload: $('reload-bar'), reloadFill: $('reload-fill'),
      dmg: $('damage-vignette'), zoneVig: $('zone-vignette'), zoneWarn: $('zone-warning'),
      help: $('help'), minimap: $('minimap'), spectate: $('spectate-label'),
      compass: $('compass'), heading: $('heading'), stance: $('stance'), stanceIcon: $('stance-icon'), stanceText: $('stance-text'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.mapLayer = this.buildMapLayer();
    this.pings = [];
    this.feed = [];
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.hitTimer = 0;
  }

  show(v) { this.el.hud.hidden = !v; }

  buildMapLayer() {
    const size = 360;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const s = size / (WORLD_HALF * 2);
    const X = (x) => (x + WORLD_HALF) * s;
    g.fillStyle = '#5f6f3e';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#4b4a45';
    for (const r of this.map.roads) g.fillRect(X(r.minX), X(r.minZ), (r.maxX - r.minX) * s, (r.maxZ - r.minZ) * s);
    const colors = { building: '#cfc3a6', tower: '#e2d8be', wall: '#9a958a', crate: '#8a6a3e', rock: '#8f8b82', tree: '#3e5a2a' };
    for (const o of this.map.obstacles) {
      g.fillStyle = colors[o.kind] ?? '#888';
      const pad = o.kind === 'tree' ? 0.8 : 0;
      g.fillRect(X(o.minX - pad), X(o.minZ - pad), (o.maxX - o.minX + pad * 2) * s, (o.maxZ - o.minZ + pad * 2) * s);
    }
    return c;
  }

  setConnection(status, ping) {
    const labels = { online: 'Online', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Disconnected', local: 'Local (in-browser server)' };
    this.el.net.textContent = `${labels[status] ?? status}${ping != null && status === 'online' ? ` · ${ping}ms` : ''}`;
    this.el.netDot.className = `dot ${status === 'online' || status === 'local' ? 'ok' : status === 'offline' ? 'bad' : 'warn'}`;
  }

  setController(state) {
    // state: 'connected' | 'none' | 'unavailable' | 'ble'
    const t = { connected: '📱 Controller connected (keyboard movement off)', none: '📱 Controller not connected', unavailable: '📱 Controller: server mode only', ble: '🔵 BLE controller connected (experimental)' };
    this.el.ctrl.textContent = t[state] ?? '';
    this.el.ctrl.className = state === 'connected' || state === 'ble' ? 'ok' : '';
  }

  setFps(fps) { this.el.fps.textContent = `${fps} FPS`; }

  banner(text, ms = 2200, kind = '') {
    this.el.banner.textContent = text;
    this.el.banner.className = `show ${kind}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.el.banner.className = ''; }, ms);
  }

  toast(text, ms = 1600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  hitmarker(kill) {
    this.el.hit.className = kill ? 'show kill' : 'show';
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => { this.el.hit.className = ''; }, kill ? 260 : 120);
  }

  damage(amount) {
    const v = this.el.dmg;
    v.style.opacity = String(Math.min(0.85, 0.25 + amount / 40));
    v.style.transition = 'none';
    requestAnimationFrame(() => { v.style.transition = 'opacity 0.6s ease-out'; v.style.opacity = '0'; });
  }

  addKill(entry, youId) {
    const div = document.createElement('div');
    div.className = 'kf';
    if (entry.k === youId || entry.v === youId) div.classList.add('me');
    const w = WEAPONS[entry.w];
    const killer = document.createElement('span');
    killer.className = 'kn';
    killer.textContent = entry.kn ?? (entry.w === 'zone' ? 'Zone' : '—');
    const weapon = document.createElement('span');
    weapon.className = 'kw';
    weapon.textContent = w ? `[${w.short}]` : entry.w === 'zone' ? '[ZONE]' : entry.w === 'left' ? '[LEFT]' : '[×]';
    const victim = document.createElement('span');
    victim.className = 'vn';
    victim.textContent = entry.vn;
    div.append(killer, weapon, victim);
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.classList.add('fade'), 5000);
    setTimeout(() => div.remove(), 5600);
  }

  clearFeed() { this.el.killfeed.textContent = ''; }

  ping(x, z) { this.pings.push({ x, z, t: performance.now() }); }

  setPrompt(text) {
    this.el.prompt.textContent = text ?? '';
    this.el.prompt.classList.toggle('show', !!text);
  }

  crosshair(px, py, spreadPx, visible) {
    const c = this.el.cross;
    c.style.display = visible ? 'block' : 'none';
    c.style.transform = `translate(${px}px, ${py}px)`;
    c.style.setProperty('--gap', `${Math.round(6 + spreadPx)}px`);
  }

  toggleHelp(force) { this.el.help.hidden = force === undefined ? !this.el.help.hidden : !force; }

  update(view) {
    const { latest, you, self, zone, selfPos, spectating } = view;
    if (!latest) return;
    const hp = self ? Math.max(0, self.hp) : 0;
    this.el.hpFill.style.width = `${(hp / MAX_HP) * 100}%`;
    this.el.hpFill.className = hp < 30 ? 'low' : '';
    this.el.hpText.textContent = String(hp);
    const w = you?.weapons?.[you.slot];
    if (w) {
      this.el.weaponName.textContent = WEAPONS[w.type].name;
      this.el.mag.textContent = String(w.mag);
      this.el.mag.className = w.mag <= Math.ceil(WEAPONS[w.type].magSize * 0.25) ? 'low' : '';
      this.el.reserve.textContent = String(w.reserve);
    }
    this.el.slots.textContent = (you?.weapons ?? []).map((x, i) => `${i === you.slot ? '▶' : ' '}${i + 1}:${x ? WEAPONS[x.type].short : '—'}`).join('  ');
    const reloading = (you?.reloadT ?? 0) > 0 && you.reloadTotal > 0;
    this.el.reload.style.display = reloading ? 'block' : 'none';
    if (reloading) this.el.reloadFill.style.width = `${(1 - you.reloadT / you.reloadTotal) * 100}%`;
    this.el.alive.textContent = `Alive ${latest.alive}/${latest.total}`;
    this.el.kills.textContent = `Kills ${self?.k ?? 0}`;

    const z = latest.zone;
    if (latest.state === 'COUNTDOWN') {
      this.el.zonePhase.textContent = 'Get ready';
      this.el.zoneTimer.textContent = String(Math.ceil(latest.countdown));
      this.el.zoneInfo.textContent = '';
    } else if (z) {
      const stageText = z.sudden ? 'Final collapse' : z.stage === 'SHRINK' ? 'Shrinking' : z.stage === 'FINAL' ? 'Final stage' : z.phase === 0 ? 'Zone idle' : 'Shrink pending';
      this.el.zonePhase.textContent = z.sudden ? `Zone collapse · ${stageText}` : `Zone ${Math.min(z.phase, z.total)}/${z.total} · ${stageText}`;
      this.el.zoneTimer.textContent = z.stage === 'FINAL' ? '—' : fmtTime(z.left);
      this.el.zoneInfo.textContent = `Damage ${z.dps}/s`;
    }
    const outside = self?.al && zone && selfPos && Math.hypot(selfPos.x - zone.cx, selfPos.z - zone.cz) > zone.r;
    this.el.zoneVig.style.opacity = outside ? '1' : '0';
    this.el.zoneWarn.classList.toggle('show', !!outside);
    if (outside) this.el.zoneWarn.textContent = `Outside the safe zone! -${z.dps}/s — get inside the white circle`;
    this.el.spectate.hidden = !spectating;
    if (spectating) this.el.spectate.textContent = `Spectating: ${spectating}`;
  }

  drawMinimap(view) {
    const { zone, selfPos, selfAim } = view;
    if (selfPos) this.lastSelf = selfPos;
    const g = this.ctx;
    const W = this.el.minimap.width;
    const s = W / (WORLD_HALF * 2);
    const X = (v) => (v + WORLD_HALF) * s;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.mapLayer, 0, 0, W, W);
    if (zone) {
      g.save();
      g.fillStyle = 'rgba(255,80,40,0.28)';
      g.beginPath();
      g.rect(0, 0, W, W);
      g.arc(X(zone.cx), X(zone.cz), Math.max(0, zone.r * s), 0, Math.PI * 2, true);
      g.fill('evenodd');
      g.strokeStyle = '#ff6a3c';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(zone.cx), X(zone.cz), Math.max(0, zone.r * s), 0, Math.PI * 2);
      g.stroke();
      if (zone.nr < zone.r - 0.5 && zone.nr > 0) {
        g.strokeStyle = '#ffffff';
        g.setLineDash([4, 3]);
        g.beginPath();
        g.arc(X(zone.nx), X(zone.nz), zone.nr * s, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    }
    // show gunfire locations (enemy shots)
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 1500);
    for (const p of this.pings) {
      g.fillStyle = `rgba(228,87,46,${1 - (now - p.t) / 1500})`;
      g.beginPath();
      g.arc(X(p.x), X(p.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // Free-for-all: other players are not shown on the minimap (only where they fired)
    if (selfPos) {
      g.save();
      g.translate(X(selfPos.x), X(selfPos.z));
      g.rotate(selfAim);
      g.fillStyle = '#37d0e6';
      g.strokeStyle = '#0b1a1d';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(7, 0); g.lineTo(-5, 4.5); g.lineTo(-2.5, 0); g.lineTo(-5, -4.5); g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }
  }

  // Top compass: heading + direction of enemy gunfire (aim angle: 0 = +X (east), north = -Z)
  drawCompass(aim) {
    const c = this.el.compass;
    if (!c) return;
    if (aim === null || aim === undefined) { c.style.visibility = 'hidden'; return; }
    c.style.visibility = 'visible';
    const g = this.compassCtx ?? (this.compassCtx = c.getContext('2d'));
    const W = c.width;
    const H = c.height;
    const bearing = ((((aim + Math.PI / 2) * 180) / Math.PI) % 360 + 360) % 360;
    const span = 110; // visible degrees on screen
    const pxPerDeg = W / span;
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.15, 'rgba(0,0,0,0.35)');
    grd.addColorStop(0.85, 'rgba(0,0,0,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 6, W, H - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const start = Math.floor((bearing - span / 2) / 5) * 5;
    for (let d = start; d <= bearing + span / 2; d += 5) {
      const x = W / 2 + (d - bearing) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const fade = 1 - Math.abs(x - W / 2) / (W / 2);
      g.globalAlpha = Math.max(0, fade) * 0.95;
      g.fillStyle = '#f1ece0';
      if (names[dd] !== undefined) {
        g.font = `700 ${names[dd].length === 1 ? 15 : 12}px system-ui, sans-serif`;
        g.fillStyle = dd === 0 ? '#ffcf5a' : '#f1ece0';
        g.fillText(names[dd], x, H / 2);
      } else if (dd % 15 === 0) {
        g.fillRect(x - 0.75, H / 2 - 6, 1.5, 12);
        g.font = '500 9px ui-monospace, monospace';
        g.fillText(String(dd), x, H - 7);
      } else {
        g.fillRect(x - 0.5, H / 2 - 3, 1, 6);
      }
    }
    // enemy gunfire direction markers
    const now = performance.now();
    if (this.lastSelf) {
      for (const p of this.pings) {
        const age = (now - p.t) / 1500;
        if (age > 1) continue;
        const a = Math.atan2(p.z - this.lastSelf.z, p.x - this.lastSelf.x);
        const b = ((((a + Math.PI / 2) * 180) / Math.PI) % 360 + 360) % 360;
        let rel = b - bearing;
        rel = ((rel + 540) % 360) - 180;
        if (Math.abs(rel) > span / 2) continue;
        const x = W / 2 + rel * pxPerDeg;
        g.globalAlpha = 1 - age;
        g.fillStyle = '#ff4b2b';
        g.beginPath();
        g.moveTo(x, 8); g.lineTo(x - 5, 1); g.lineTo(x + 5, 1); g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffcf5a';
    g.beginPath();
    g.moveTo(W / 2, H - 2); g.lineTo(W / 2 - 5, H + 4); g.lineTo(W / 2 + 5, H + 4); g.closePath();
    g.fillRect(W / 2 - 1, H - 10, 2, 8);
    this.el.heading.textContent = String(Math.round(bearing) % 360).padStart(3, '0');
  }

  // Stance: 0 standing 1 crouching 2 sliding 3 vaulting 4 airborne (-1 hidden)
  setStance(st, sprint) {
    const el = this.el.stance;
    if (!el) return;
    const key = `${st}|${sprint}`;
    if (key === this.lastStance) return;
    this.lastStance = key;
    el.hidden = st < 0;
    const [icon, text] = st === 1 ? ['🧎', 'Crouching'] : st === 2 ? ['🛷', 'Sliding'] : st === 3 ? ['🧗', 'Vaulting'] : st === 4 ? ['🤸', 'Jumping'] : sprint ? ['🏃', 'Sprinting'] : ['🧍', 'Standing'];
    this.el.stanceIcon.textContent = icon;
    this.el.stanceText.textContent = text;
    el.className = st === 2 || sprint ? 'active' : '';
  }

  itemLabel(type) { return ITEMS[type]?.label ?? type; }
}
