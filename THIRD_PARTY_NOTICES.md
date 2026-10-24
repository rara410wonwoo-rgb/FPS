# Third-Party Notices

PolyZone: Tactics uses the open-source packages and CC0 (public domain) 3D assets below. Sounds are synthesized with Web Audio; fonts are system fonts.

## CC0 assets (`public/assets/`, re-download with `python3 scripts/fetch-assets.py`)

CC0 is a public-domain dedication: commercial use, modification and redistribution are allowed without attribution. Credits are listed here as thanks.

| Asset | Type | Source | License |
|---|---|---|---|
| Kloofendal 48d Partly Cloudy (Pure Sky) | HDRI sky | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 |
| dirt_floor, sparse_grass, rocky_terrain_02, rock_face_03 | Terrain textures | https://polyhaven.com/textures | CC0 |
| plastered_wall_04, red_brick_03, concrete_wall_008, corrugated_iron_02 | Building textures | https://polyhaven.com/textures | CC0 |
| asphalt_02, bark_brown_02, wood_planks_grey | Road and tree textures | https://polyhaven.com/textures | CC0 |
| boulder_01, rock_07, wooden_military_crate, covered_car, Barrel_01, shrub_02, ammo_box, medical_box | Prop 3D models | https://polyhaven.com/models | CC0 |
| Character Soldier (Quaternius) | Animated soldier model | https://poly.pizza/m/PpLF4rt4ah | CC0 |

## Packages

| Package | Purpose | License | Source |
|---|---|---|---|
| three (0.186.1) | 3D rendering (browser) | MIT | https://github.com/mrdoob/three.js |
| express (5.x) | HTTP server, static files | MIT | https://github.com/expressjs/express |
| socket.io (4.x) | Real-time server | MIT | https://github.com/socketio/socket.io |
| socket.io-client (4.x) | Real-time client (browser and tests) | MIT | https://github.com/socketio/socket.io |
| qrcode-generator (2.x) | QR code for phone pairing | MIT | https://github.com/kazuhikoarase/qrcode-generator |
| esbuild (dev only) | Static web build bundling | MIT | https://github.com/evanw/esbuild |

Copyright notices:

- three.js — Copyright © 2010-2026 three.js authors
- Express — Copyright (c) 2009-2014 TJ Holowaychuk, (c) 2013-2014 Roman Shtylman, (c) 2014-2015 Douglas Christopher Wilson
- Socket.IO / socket.io-client — Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors
- qrcode-generator — Copyright (c) 2009 Kazuhiko Arase
- esbuild — Copyright (c) 2020 Evan Wallace

To list the licenses of transitive dependencies (engine.io, ws, etc.) after installing, run:

```bash
npx license-checker --production --summary
```

The full license text of each package is in its installed `node_modules/<package>/LICENSE` file.

---

## MIT License (common form for the packages above)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

“PolyZone: Tactics” is a working title; trademark availability has not been checked.
