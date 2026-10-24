// Simulate several bot-only matches headlessly: node scripts/simulate-matches.mjs [match count]
import { generateMap } from '../shared/map.js';
import { Match } from '../server/simulation.js';
import { TICK_DT } from '../shared/config.js';
const map = generateMap();
const N = Number(process.argv[2] ?? 5);
for (let seed = 1; seed <= N; seed++) {
  const t0 = performance.now();
  const m = new Match({ map, seed });
  let now = 0; const c = { shot: 0, hit: 0, pickup: 0, kill: 0, reload: 0, swap: 0, zoneKill: 0 }; let maxTick = 0;
  while (m.state !== 'FINISHED' && m.elapsed < 700) {
    const a = performance.now(); m.step(TICK_DT, now); now += 1000 / 30; maxTick = Math.max(maxTick, performance.now() - a);
    for (const e of m.drainEvents()) { if (c[e.type] !== undefined) c[e.type]++; if (e.type === 'kill' && e.w === 'zone') c.zoneKill++; }
  }
  console.log(`seed ${seed}: ${m.state} ${m.elapsed.toFixed(0)}s winner=${m.results?.winnerName ?? '-'} draw=${m.results?.draw} kills=${c.kill}(zone ${c.zoneKill}) shots=${c.shot} hits=${c.hit} pickups=${c.pickup} reloads=${c.reload} swaps=${c.swap} | ${(performance.now() - t0).toFixed(0)}ms, max tick ${maxTick.toFixed(1)}ms`);
}
