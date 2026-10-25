# 2026-10-25 ADS 수정

이번 ADS 사격·조준경 수정 내용은 [UPDATE-2026-10-25.md](UPDATE-2026-10-25.md)를 확인하세요.

# 2026-10-24 수정본

ADS 조준 정렬과 그래픽/성능 수정 내용 및 현재 검증 범위는 [UPDATE-2026-10-24.md](UPDATE-2026-10-24.md)를 먼저 확인하세요. 아래는 기존 프로젝트 안내입니다.

## Expanded battle royale update

The battlefield is now 600 × 600 metres (nine times the original area). Houses have doorway collision and indoor weapon crates, ammo and healing pickups. Matches begin on an aircraft: press Space or the phone Jump button to exit, then Jump to open the parachute; it also opens automatically below 38 metres. Steer with movement controls. Periodic supply pickups descend under parachutes.

Phone look and fire-drag now support horizontal rotation and vertical pitch. The server validates pitch and performs 3D ray intersections against walls, roofs and player bodies. ADS enters the first-person sight for alignment.

Aircraft, parachutes and new buildings currently use basic procedural models. Existing licensed soldier and environment assets remain; this update does not establish photorealistic quality or a measured client FPS improvement. Browser visual QA and real-device controller QA remain pending.

# PolyZone: Tactics (working title)

A **third/first-person 3D battle royale** that runs in a PC web browser, with an optional **phone-as-controller** mode.
The full game loop works: move → loot → fight → escape the zone → win/lose → restart.

## Play online

Open **https://polyzone-tactics.onrender.com/** on a PC. Choose **Create room** and share the five-character room code; another player opens the same URL and chooses **Join**. The host starts the match. For a phone controller, use the in-game QR code or open **https://polyzone-tactics.onrender.com/controller.html** on the phone and pair it with the PC player. Both devices need internet access, but do not need the same Wi-Fi.

This is a free Render Web Service running the Node and Socket.IO server. It may take about a minute to wake after 15 minutes without traffic; active WebSocket messages keep it awake. Matches and pair codes are held in memory and reset if the service restarts.

- 12-player free-for-all (up to 4 humans + bots), server-authoritative simulation at 30Hz, snapshots at 15Hz
- Over-the-shoulder third person (default), first person, and the classic top-down view
- Sprint, jump, crouch, slide, and vault over low cover — all judged by the server
- Graphics: Three.js + CC0 photoreal assets (Poly Haven textures, HDRI sky and props; Quaternius animated soldier). Sound effects are synthesized with the Web Audio API
- Assets live in `public/assets/` and can be re-downloaded with `python3 scripts/fetch-assets.py` (all CC0, see THIRD_PARTY_NOTICES.md)
- “PolyZone: Tactics” is a working title; trademark availability has not been checked.
- No commercial game's names, logos, maps, UI, weapon designs or sounds are copied. The look only borrows the general mood of modern military shooters.

---

## 1. Quick start on a Mac (double-click)

1. Install **Node.js 22 or newer** once from https://nodejs.org (the “LTS” installer).
2. Unzip `polyzone-tactics.zip` (for example into your Downloads folder).
3. Double-click **`Start PolyZone.command`** inside the folder.
   - The first time, macOS may say it “cannot be opened because it is from an unidentified developer”. Right-click (or Control-click) the file → **Open** → **Open**. You only need to do this once.
4. A Terminal window installs what is needed (first run only, needs internet), starts the server, and opens the game in your browser.
5. To stop the game, close the Terminal window (or press `Ctrl+C` in it).

## 2. Run the Node server manually

Requirement: **Node.js 22+** (Node 24 LTS recommended)

```bash
cd polyzone-tactics
npm install        # first time only; needs internet
npm start          # starts the server on 0.0.0.0:3000
```

- After `npm install` the game runs **offline**. three.js, Socket.IO and the QR library are served locally from `node_modules`; no CDN, fonts or remote images.
- Change the port: `PORT=8080 npm start`
- Auto-restart while developing: `npm run dev`
- Opening the HTML file directly (`file://`) is not supported. Always run the server.

The console prints the addresses to use:

```
PolyZone: Tactics server running
  PC game:        http://localhost:3000/
  Phone controller / other PCs on the same Wi-Fi:
    http://192.168.0.12:3000/controller.html   (game: http://192.168.0.12:3000/)
```

### Modes

| Mode | How |
|---|---|
| A. Local solo | Open `http://localhost:3000` → **Solo play**. 1 player + 11 bots |
| B. Phone controller | **📱 Play with your phone as controller** on the main menu, or **📱 Connect phone** in game (`P`) → scan the QR code |
| C. Online room | **Create room** → share the 5-character room code → others press **Join**. Up to 4 humans; bots fill the match to 12. The host starts and restarts |

## 3. Phone controller

**Easiest way:** press **📱 Play with your phone as controller** on the main menu, or **📱 Connect phone** (top right, shortcut `P`) during a match. A QR code appears. Scan it with your phone camera and it connects automatically — no code to type. Tap the phone screen once to go full screen.

Manual way:
1. Put the PC and the phone on the **same Wi-Fi** (or use the online address, see section 8).
2. On the PC, open the menu (`Esc`) → **📱 Connect phone controller**.
3. Open the shown address (e.g. `http://192.168.0.12:3000/controller.html?code=ABCDEFGH`) on the phone.
   - ⚠️ `localhost` on a phone means **the phone itself**. Always use the PC's LAN IP.
   - If it will not connect, allow incoming connections for Node (port 3000) in the PC firewall.
4. Hold the phone sideways. Codes are single-use and expire after 5 minutes.

Controller layout (CODM-style): left side = floating movement joystick (push all the way up to sprint), drag on the right side = look around, **FIRE** (right) and a second fire button (left), **ADS** (toggle), **JUMP** (jump / vault), **CROUCH** (toggle; slide while sprinting), **R** reload, **PICK** pick up, and **swap weapon**. Dragging while holding FIRE also turns the view.

Rules and limits:
- One controller per player. A new controller replaces the old one (newest wins).
- While a controller is connected, the PC keyboard and mouse are ignored (shown in the HUD).
- If controller input stops for 300ms or the phone goes to the background, movement and firing stop immediately.
- **Keep-screen-on (Wake Lock) needs HTTPS.** On a LAN `http://` address it shows as unsupported; the game still works.
- **iPhone Safari does not support fullscreen or orientation lock.** Holding it upright shows a “turn your device” hint.
- Web browsers cannot pair a phone and a PC directly over Bluetooth, so the controller talks to the same server over the network.

## 4. PC controls

| Key | Action |
|---|---|
| Click the game | Capture the mouse (Esc releases it and opens the menu) |
| WASD | Move (relative to where you look) |
| Mouse | Look and aim |
| Arrow keys | Turn (works even if mouse capture is unavailable) |
| Shift | Sprint (walks while firing or aiming) |
| Space | Jump · vault when right in front of low cover (wall, crate, rock, car) |
| C | Crouch (slide while sprinting) |
| Left click | Fire |
| Right click | Aim down sights (less spread, 60% move speed) |
| R | Reload |
| E | Pick up |
| Q / 1 / 2 | Swap weapon |
| V | Switch view: third person → first person → top-down |
| P | Phone controller QR code |
| M | Mute |
| H | Controls help |
| Esc | Menu (only your input goes neutral; server time keeps running) |

## 5. Game rules

- 100 HP, move speed 7 units/s, 200×200 world (−100 to 100)
- Three weapons (tune them in `shared/config.js`)

| Weapon | Damage | Mag / reserve | Fire interval | Reload | Range |
|---|---|---|---|---|---|
| Kestrel Rifle (default) | 19 | 24 / 96 | 0.12s | 1.6s | 48 |
| Hornet SMG | 12 | 36 / 108 | 0.07s | 1.4s | 28 |
| Breaker Shotgun | 10 × 8 pellets | 6 / 18 | 0.8s | 2.2s | 13 |

- Movement: sprint ×1.45 speed, crouch ×0.55 (tighter spread), slide 0.75s burst from a sprint, jump about 0.9m high, vault over cover up to 1.75m tall and 2.6m thick. Shooting while airborne or sliding spreads more.
- Items: Medkit (+45 HP), Ammo box, Weapon crate. Eliminated players drop an ammo box.
- Zone: starts at radius 135 → 30s wait → 5 phases (20s wait + 25s shrink) → final radius 12. Each new circle is always inside the previous one. If there is still no winner, a **final collapse** shrinks it to 0 over 40s.
- Win/loss: last survivor wins; if everyone dies at once it is a draw. The results screen shows placement, kills and survival time. When eliminated you spectate your killer (or another survivor).

## 6. Architecture

```
PC browser  ──input(seq)──▶  Node server (Express + Socket.IO)
     ▲                       RoomManager ─ Match (30Hz) ─ combat / bots / zone / movement
     └──────snapshot 15Hz────┘        ▲
phone controller.html ──controller:input──┘
```

- **Server-authoritative:** position, movement (including jump/slide/vault), HP, ammo, reloads, fire rate, damage, hits, items, bots, zone and win/loss are all computed on the server. Clients only send input.
- **Client:** the local character uses prediction + server reconciliation (same `shared/movement.js` code as the server); remote characters are interpolated from snapshots with a 100ms delay.
- **Hit detection:** server-side hitscan with slab ray-AABB and ray-circle tests. Rays start at the character center and take the nearest hit, so shooting through walls (even with the muzzle inside one) is impossible. The client's Three.js Raycaster is only used for visuals (aim point, tracers, bullet holes, camera collision).
- **Bots:** notice enemies only by sight (FOV + obstacle occlusion) and gunfire; reaction delay, aim error, bursts, reloads, grid A* paths with stuck recovery, and states (roam, loot, investigate, fight, chase, move to zone).
- **Room/pairing security:** room codes (5 chars) are separate from controller pairing codes (8 chars, single use, 5-minute expiry). Session tokens come from `crypto.randomBytes` and only their hashes are stored. Persistent `playerId`s instead of socket IDs. Input rate limit (45/s, burst 15), event rate limit, per-IP join and pairing limits, payload type/finite-number/range validation, `maxHttpBufferSize` 8KB, unknown events (like HP edits) rejected, disconnect on repeated violations.
- **Reconnects:** disconnected players are kept for 60s (30s in the lobby) and reclaim the same player with their token, receiving a full snapshot. Empty rooms, expired codes and timers are cleaned up automatically.

## 7. Tests

```bash
npm test            # unit, simulation, room, security, movement and Socket.IO integration tests (57)
npm run simulate    # play 5 full 12-bot matches headlessly
npm run build:web   # build the static solo web version (dist/web)
```

## 8. Put it online so others can play

Running `npm start` locally only works **inside your own network**. To play over the internet you need Node hosting with WebSocket support and HTTPS/WSS. Static hosts (GitHub Pages, Netlify) cannot run the Socket.IO server.

Example with a free Render web service (`render.yaml` is included):

1. Push this folder to a GitHub repository (including `package-lock.json`).
2. Render dashboard → **New → Blueprint** → connect the repository → **Apply**.
3. Build `npm install`, start `npm start`, health check `/healthz`, instance Free (all set by `render.yaml`).
4. After deploying, `https://<service>.onrender.com` is the game and `/controller.html` on the same address is the controller. Thanks to HTTPS, keep-screen-on works on phones, and phones can connect from any network.

Note: free Render instances sleep after a while without traffic (the first visit takes about a minute to wake up), and sleeping clears all rooms in memory. Free-tier rules can change, so check the official docs. The server honours the `PORT` environment variable and binds to `0.0.0.0`.

## 9. Bluetooth

A normal phone browser and a PC browser **cannot connect directly with Web Bluetooth** (browsers cannot act as a BLE peripheral, and iOS Safari has no Web Bluetooth at all). The default controller path is Socket.IO.

As an optional extension, `public/transports/bluetooth-transport.js` contains a Web Bluetooth adapter for a BLE GATT peripheral (a separate microcontroller or native bridge). The service/characteristic UUIDs and the 7-byte packet format are in `BLUETOOTH` in `shared/config.js`. **It has not been tested with real BLE hardware.** In unsupported browsers the button is disabled and points to the Socket.IO controller; it never shows “connected” unless it really is.

## 10. File layout

```
Start PolyZone.command     macOS double-click launcher
server.js                  server entry (PORT, 0.0.0.0, prints LAN addresses)
server/app.js              Express static files + Socket.IO + 30Hz loop
server/rooms.js            rooms, sessions, pairing, rate limits, reconnects (transport independent)
server/simulation.js       match state machine, input, items, win/loss
server/combat.js           firing, reloading, hitscan, damage
server/bots.js             bot AI + grid A*
server/zone.js             the zone
server/node-deps.js        Node crypto random and hashing
shared/config.js           rules, weapons, movement, zone, bots, quality presets
shared/protocol.js         message names and payload validation
shared/map.js              seed-based map (server collision = client visuals)
shared/collision.js        ray-AABB, ray-circle, circle-AABB, spatial index
shared/movement.js         movement shared by server and client (sprint/jump/crouch/slide/vault)
public/index.html          PC game page
public/game.js             server-mode entry
public/web-entry.js        static solo web build entry
public/game/*.js           scene, assets, textures, entities, viewmodel, camera, input, network, effects, audio, hud, app
public/controller.html/js  phone controller
public/transports/*.js     socket / local (in-browser server) / bluetooth transports
public/assets/             CC0 textures, HDRI and models
tests/*.test.js            node:test tests
scripts/                   match simulation, web build, asset download
render.yaml                Render deployment config
```

## 11. Known limits

- Hits use the server's current state (no lag compensation/rewind), so moving targets are harder to hit on high-latency connections.
- Bullets travel in 2D on the server: height (jumping, crouching, looking up/down) is visual only.
- Free-for-all only (no teams); one fixed map seed.
- Restarting the server clears all rooms (no persistence).
- Assets add about 49MB, so the first load takes a moment.
- Not yet verified on real iPhone/Android hardware for touch, Wake Lock and fullscreen; the BLE controller is untested on hardware.
