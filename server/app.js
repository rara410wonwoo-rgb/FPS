// Express + Socket.IO server setup. Kept separate so tests can use it before listen().
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { nodeDeps } from './node-deps.js';
import { TICK_DT } from '../shared/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Some packages (three, etc.) don't export `${name}/package.json`, so
// resolve the entry file and walk up until a package.json with a matching name is found.
function packageDir(name) {
  let dir = path.dirname(require.resolve(name));
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).name === name) return dir;
      } catch { /* skip a broken package.json */ }
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Package directory not found: ${name}`);
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export function createGameServer({ deps = nodeDeps, managerOptions = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Serve only the needed directories (server/, tests/ and the whole node_modules are not exposed)
  app.use(express.static(path.join(root, 'public'), { index: 'index.html' }));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(path.join(packageDir('three'), 'build')));
  app.use('/vendor/three-addons', express.static(path.join(packageDir('three'), 'examples', 'jsm')));
  app.use('/vendor/socket.io', express.static(path.join(packageDir('socket.io-client'), 'dist')));
  app.use('/vendor/qrcode', express.static(path.join(packageDir('qrcode-generator'), 'dist')));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/api/info', (req, res) => res.json({ lan: lanAddresses(), port: Number(process.env.PORT) || 3000 }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 8 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  const manager = new RoomManager(deps, managerOptions);

  io.on('connection', (socket) => {
    const client = {
      id: socket.id,
      ip: socket.handshake.address,
      emit: (ev, data) => socket.emit(ev, data),
      disconnect: () => socket.disconnect(true),
    };
    manager.connect(client);
    socket.onAny((event, payload, ack) => {
      if (typeof event !== 'string' || event.length > 40) return;
      if (typeof payload === 'function') { ack = payload; payload = undefined; }
      try {
        manager.handle(client, event, payload, ack);
      } catch (err) {
        console.error('handler error', event, err);
      }
    });
    socket.on('disconnect', () => manager.disconnect(client));
  });

  // fixed 30Hz simulation (accumulator, independent of rendering)
  const tickMs = TICK_DT * 1000;
  let last = performance.now();
  let acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= tickMs) {
      manager.tick(TICK_DT);
      acc -= tickMs;
    }
  }, 5);

  const close = () => new Promise((resolve) => {
    clearInterval(loop);
    io.close(() => resolve());
  });

  return { app, httpServer, io, manager, close };
}
