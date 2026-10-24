// PolyZone: Tactics server entry point — npm start
import { createGameServer, lanAddresses } from './server/app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const { httpServer, close } = createGameServer();

httpServer.listen(PORT, HOST, () => {
  console.log('\nPolyZone: Tactics server running');
  console.log(`  PC game:        http://localhost:${PORT}/`);
  const lan = lanAddresses();
  if (lan.length) {
    console.log('  Phone controller / other PCs on the same Wi-Fi:');
    for (const ip of lan) console.log(`    http://${ip}:${PORT}/controller.html   (game: http://${ip}:${PORT}/)`);
  } else {
    console.log('  No LAN address found. Check your network connection.');
  }
  console.log('  Note: typing localhost on a phone points to the phone itself, not the PC.\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
