// Server mode entry (connects over Socket.IO to the Node server started with npm start)
import { boot } from './game/app.js';
import { SocketTransport } from './transports/socket-transport.js';

boot({ mode: 'server', createTransport: () => new SocketTransport() });
