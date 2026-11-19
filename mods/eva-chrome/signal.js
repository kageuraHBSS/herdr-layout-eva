// How the command deck's signal field follows CPU load. Pure, so tests run without Herdr.
// Ten 10% levels. The layers swing in opposite directions around the spot where they lie
// on top of each other, so at n% CPU they drift up to ±n% of the field width apart, and
// faster as CPU climbs. At level 0 they lie still on top of each other.

export const LEVELS = 10;
// How far one layer swings to each side at 100%, in field widths: half the ±100% the two
// drift apart. The layers are sized for it.
export const MAX_SHIFT = 0.5;
// Step down only once CPU is this many points under the level's floor, so a reading
// hovering on a boundary doesn't restart the loop (and jump the waves) every poll.
const HYSTERESIS = 3;
// A level change restarts the slide from its start. Summed ps readings swing about
// ten points poll to poll, which changed the level every ten seconds or so and kept the
// 42 s / 57 s slide from ever showing. So the field follows the mean of the last WINDOW
// readings (5 s polls: 30 s) and changes level at most once every DWELL ms.
export const WINDOW = 6;
export const DWELL = 30000;

const floorLevel = (cpu) => Math.min(LEVELS - 1, Math.max(0, Math.floor(cpu / 10)));

// One mean to a level: up at once, down with hysteresis. No reading yet keeps the last level. Idempotent,
// so it is safe to run on every render.
export function cpuLevel(cpu, previous = 0) {
  if (cpu == null) return previous;
  const raw = floorLevel(cpu);
  return raw >= previous ? raw : Math.min(previous, floorLevel(cpu + HYSTERESIS));
}

// The field's state after one more host reading: the last WINDOW CPU readings, their
// mean, the level and when it last changed. No reading (null) leaves it as it was.
// The first reading sets the level at once.
export function nextLoad(load, cpu, now) {
  const last = load ?? { samples: [], mean: null, level: 0, changedAt: -Infinity };
  if (cpu == null) return last;
  const samples = [...last.samples, cpu].slice(-WINDOW);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const level = cpuLevel(mean, last.level);
  const change = level !== last.level && now - last.changedAt >= DWELL;
  return { samples, mean, level: change ? level : last.level, changedAt: change ? now : last.changedAt };
}

// A level stands for its floor, level × 10%. Each layer swings ±shift field widths, and
// the loop periods scale by tempo: whole at 0%, half at 100%.
export function signalShape(level) {
  const load = level / LEVELS;
  return { shift: MAX_SHIFT * load, tempo: 1 - load / 2 };
}
