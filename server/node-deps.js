// Node.js secure random and hash dependencies (injected into RoomManager)
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

export const nodeDeps = {
  randomToken: (bytes) => randomBytes(bytes).toString('base64url'),
  randomInt: (max) => randomInt(max),
  hash: (s) => createHash('sha256').update(s).digest('base64url'),
  safeEqual: (a, b) => {
    const A = Buffer.from(a);
    const B = Buffer.from(b);
    return A.length === B.length && timingSafeEqual(A, B);
  },
  now: () => Date.now(),
  seed: () => randomInt(1, 2 ** 31 - 1),
};
