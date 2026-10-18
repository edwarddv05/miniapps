// Recognises a deliberate shake from accelerometer samples (in g). One jolt or
// a bump counts once; a shake is several strong jolts close together.

export type ShakeOptions = { threshold?: number; peaks?: number; window?: number; gap?: number; cooldown?: number };

export function createShakeDetector({ threshold = 2.2, peaks = 3, window = 1000, gap = 100, cooldown = 1500 }: ShakeOptions = {}) {
  let times: number[] = [];
  let quietUntil = 0;
  return (x: number, y: number, z: number, now: number) => {
    if (now < quietUntil) return false;
    if (Math.sqrt(x * x + y * y + z * z) < threshold) return false;
    // Samples of the same jolt arrive a few ms apart; only the first counts.
    if (times.length && now - times[times.length - 1] < gap) return false;
    times = [...times.filter((time) => now - time <= window), now];
    if (times.length < peaks) return false;
    times = [];
    quietUntil = now + cooldown;
    return true;
  };
}
