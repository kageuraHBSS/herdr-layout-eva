// How the command deck's signal field follows CPU load. Pure, so tests run without Herdr.
// Ten 10% levels: at 0 both layers sit still on top of each other; at 9 they are out of
// phase and slide the full distance apart. The wave height never changes.

export const LEVELS = 10;
// The farthest a layer slides, in field widths (level 9). The layers are sized for it.
export const TRAVEL = 0.6;
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

// The purple layer's phase (the orange one stays at 0) and each layer's slide (field
// widths), linear from level 0 to level 9.
export function signalShape(level) {
  const k = level / (LEVELS - 1);
  return { phase: 1.8 * k, travel: TRAVEL * k };
}
