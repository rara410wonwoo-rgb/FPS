# Progress: graphics overhaul (CODM/Warzone-style third/first person)

Goal: make the game look and play like the reference videos/screenshots (Call of Duty: Warzone / Mobile): 3D, realistic textures, modern movement — without copying any commercial assets, logos or UI. Keep all existing features (server authority, online rooms, phone controller, bots, zone).

## Done — session 1 (2026-10-23)
- [x] Fixed the `npm start` crash (`three` does not export `package.json` → `server/app.js` packageDir)
- [x] Serve three.js addons (`/vendor/three-addons`) + import maps, web build externals
- [x] Procedural PBR fallback textures (`public/game/textures.js`)
- [x] Scene rewrite: sky + IBL, tone mapping, post-processing (bloom/GTAO/grading), detailed buildings, trees, grass, gas wall
- [x] First-person camera + pointer lock + view-relative movement; viewmodel, effects, HUD (compass, minimap, ammo/HP)

## Done — session 2 (2026-10-23), CODM references
- [x] CC0 photoreal assets: 11 Poly Haven textures + HDRI sky + 8 prop models, Quaternius animated soldier (`scripts/fetch-assets.py`, `public/game/assets.js`)
- [x] Terrain: grass/dirt blend shader + rock on slopes and heights, terraced hills; asphalt main roads, dirt loop roads with ruts
- [x] Buildings with plaster/brick/concrete + corrugated gable roofs; sandbag cover, military crate stacks, scanned rocks, covered cars (added to the map as obstacles), barrels and shrubs
- [x] Animated soldier (idle/run/jump/crouch/death), per-weapon gun, shader camo (my character = urban blue digital)
- [x] Over-the-shoulder third person (default, camera wall collision) / first person / top-down — V to switch
- [x] Movement shared by server and client prediction: Shift sprint, Space jump, Space at low cover = vault, C crouch, C while sprinting = slide (`shared/movement.js`, `tests/movement.test.js`)
- [x] CODM-style phone controller: floating stick (push fully to sprint), drag to look, 2× FIRE / ADS / JUMP / CROUCH / R / PICK / swap. Browsers cannot pair phone ↔ PC over Bluetooth directly, so it connects through the server
- [x] Stance HUD, loading screen, assets included in the web build
- [x] git repository ready (clean clone → npm install → npm start verified)

## Done — session 3 (2026-10-23)
- [x] One-tap phone pairing: main menu button + HUD button + `P` → QR code; the phone pairs automatically from the link
- [x] Fixed: the view did not rotate on macOS (pointer lock with `unadjustedMovement` failed). Plain pointer lock now, plus mouse-move and arrow-key turning when lock is unavailable
- [x] Whole project translated to English (UI, server messages, controller, comments, tests, docs)
- [x] macOS double-click launcher `Start PolyZone.command` + downloadable ZIP

## Next
- [ ] Deploy online (Render chosen) — the user needs to: ① create an empty GitHub repo ② `git remote add origin …` + `git push -u origin main`
      ③ render.com → sign up with GitHub → New → Blueprint → pick the repo → Apply (uses render.yaml) ④ share https://<name>.onrender.com
- [ ] Replace the first-person viewmodel with a glTF gun model; more realistic trees (distant conifers)
- [ ] Shrink assets (about 49MB now → KTX2/WebP)

## Resuming in a new session
Continue from the first unchecked item above. `npm test` must always pass. Port 3000 may be busy on this Mac; test with `PORT=3210 npm start`. The pre-overhaul backup is `backup-before-graphics.tgz` (not in git).
