import { describe, it, expect } from "vitest";
import { cpuLevel, nextLoad, signalShape, LEVELS, TRAVEL, WINDOW, DWELL } from "../mods/eva-chrome/signal.js";

describe("cpuLevel", () => {
  it("rounds down to 10% steps, 100% in the top level", () => {
    expect(cpuLevel(0, 0)).toBe(0);
    expect(cpuLevel(9.9, 0)).toBe(0);
    expect(cpuLevel(10, 0)).toBe(1);
    expect(cpuLevel(99, 0)).toBe(9);
    expect(cpuLevel(100, 0)).toBe(9);
  });

  it("steps up at once", () => {
    expect(cpuLevel(20, 1)).toBe(2);
    expect(cpuLevel(73, 2)).toBe(7);
  });

  it("steps down only 3 points under the level's floor", () => {
    expect(cpuLevel(18, 2)).toBe(2);
    expect(cpuLevel(17, 2)).toBe(2);
    expect(cpuLevel(16.9, 2)).toBe(1);
    expect(cpuLevel(5, 2)).toBe(0);
    expect(cpuLevel(88, 9)).toBe(9);
    expect(cpuLevel(86, 9)).toBe(8);
  });

  it("keeps the last level without a reading, 0 before any", () => {
    expect(cpuLevel(null, 4)).toBe(4);
    expect(cpuLevel(undefined, 4)).toBe(4);
    expect(cpuLevel(null)).toBe(0);
  });

  it("gives the same level when run again on the same reading", () => {
    for (const cpu of [0, 8, 12, 18, 19.5, 35, 67, 100]) {
      for (let previous = 0; previous < LEVELS; previous++) {
        const once = cpuLevel(cpu, previous);
        expect(cpuLevel(cpu, once)).toBe(once);
      }
    }
  });
});

describe("nextLoad", () => {
  const feed = (readings, start = null, t0 = 0) =>
    readings.reduce((load, [cpu, at]) => nextLoad(load, cpu, t0 + at), start);

  it("sets the level from the first reading at once", () => {
    const load = nextLoad(null, 45, 1000);
    expect(load).toEqual({ samples: [45], mean: 45, level: 4, changedAt: 1000 });
  });

  it("leaves the state alone without a reading", () => {
    const load = nextLoad(null, 45, 0);
    expect(nextLoad(load, null, 5000)).toBe(load);
    expect(nextLoad(null, null, 0)).toEqual({ samples: [], mean: null, level: 0, changedAt: -Infinity });
  });

  it("follows the mean of the last WINDOW readings", () => {
    const load = feed([[10, 0], [10, 5000], [10, 10000], [10, 15000], [10, 20000], [10, 25000], [70, 30000]]);
    expect(load.samples).toHaveLength(WINDOW);
    expect(load.mean).toBeCloseTo(20);
    expect(load.level).toBe(2);
  });

  it("changes level at most once every DWELL ms", () => {
    const first = nextLoad(null, 45, 0);
    const early = nextLoad(first, 95, DWELL - 1);
    expect(early.level).toBe(4);
    expect(early.changedAt).toBe(0);
    const later = nextLoad(early, 95, DWELL);
    expect(later.level).toBe(cpuLevel(later.mean, 4));
    expect(later.changedAt).toBe(DWELL);
  });

  it("holds through a reading that swings ten points around a boundary", () => {
    const swing = [42.8, 42.3, 35.2, 42.8, 46.6, 40.7, 36.5, 43.1, 41.0, 50.0, 42.6, 44.4];
    const levels = [];
    swing.reduce((load, cpu, i) => {
      const next = nextLoad(load, cpu, i * 5000);
      levels.push(next.level);
      return next;
    }, null);
    expect(new Set(levels)).toEqual(new Set([4]));
  });
});

describe("signalShape", () => {
  it("is still and in phase at level 0", () => {
    const shape = signalShape(0);
    expect(shape.phase).toBe(0);
    expect(shape.travel).toBe(0);
  });

  it("is the full slide at level 9", () => {
    const shape = signalShape(LEVELS - 1);
    expect(shape.phase).toBeCloseTo(1.8);
    expect(shape.travel).toBeCloseTo(TRAVEL);
  });

  it("grows with every level", () => {
    for (let level = 1; level < LEVELS; level++) {
      const prev = signalShape(level - 1), next = signalShape(level);
      expect(next.phase).toBeGreaterThan(prev.phase);
      expect(next.travel).toBeGreaterThan(prev.travel);
    }
  });
});
