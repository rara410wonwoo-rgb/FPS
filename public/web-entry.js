// Static web build entry: solo mode running the server simulation inside the browser, no Node server
import { boot } from './game/app.js';
import { LocalTransport } from './transports/local-transport.js';

boot({ mode: 'local', createTransport: () => new LocalTransport() });
