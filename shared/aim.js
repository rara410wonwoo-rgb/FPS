// Shared eye height prevents crouch/jump camera and hitscan disagreement.
export function eyeHeight(y = 0, crouch = false) { return y + (crouch ? 1.07 : 1.62); }
export function anglesToPoint(origin, target) {
  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
  return { aim: Math.atan2(dz, dx), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
