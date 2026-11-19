import { describe, it, expect, vi, beforeEach } from "vitest";

// head answers from `heads` by file; a missing file answers empty, as head does.
const heads = new Map();
const calls = [];
vi.mock("herdr", () => ({
  terminals: () => [],
  exec: async (cmd, args) => {
    calls.push([cmd, args]);
    return { stdout: cmd === "head" ? (heads.get(args.at(-1)) ?? "") : "" };
  },
  home: () => "/nonexistent",
  readTextFile: async () => null,
}));

const storage = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
});

const load = async () => {
  vi.resetModules();
  return (await import("../mods/eva-agents/sync.js")).restarts;
};

const T0 = Date.parse("2026-11-20T00:00:00Z");
const handover = (at) =>
  JSON.stringify({
    type: "attachment",
    timestamp: new Date(at).toISOString(),
    attachment: {
      type: "hook_additional_context",
      content: ["[HANDOVER RESUME] セッションがクリアされた。"],
      hookEvent: "SessionStart",
    },
  });
const plain = [
  JSON.stringify({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
  JSON.stringify({ type: "system", subtype: "local_command", commandRun: { command: "clear" } }),
].join("\n");
const opening = JSON.stringify({ type: "mode", mode: "normal" });

let restarts;
beforeEach(async () => {
  heads.clear();
  storage.clear();
  calls.length = 0;
  restarts = await load();
});

describe("restarts", () => {
  it("starts at 0 for a process seen the first time, without reading the transcript", async () => {
    heads.set("/t/a.jsonl", handover(T0));
    expect(await restarts("1:1", "a", "/t/a.jsonl", T0 + 1000)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("counts a new session that opens with a handover", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/b.jsonl", [plain, handover(T0 + 60000)].join("\n"));
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 70000)).toBe(1);
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 85000)).toBe(1);
    heads.set("/t/c.jsonl", handover(T0 + 200000));
    expect(await restarts("1:1", "c", "/t/c.jsonl", T0 + 210000)).toBe(2);
  });

  it("doesn't count a plain /clear", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/b.jsonl", plain);
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 70000)).toBe(0);
  });

  it("doesn't count a /resume into a session that began with an older handover", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/old.jsonl", handover(T0 - 3600000));
    expect(await restarts("1:1", "old", "/t/old.jsonl", T0 + 70000)).toBe(0);
  });

  it("looks again next poll while the new transcript can't be read", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 15000)).toBe(0);
    heads.set("/t/b.jsonl", handover(T0 + 10000));
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 30000)).toBe(1);
  });

  it("waits while the new transcript has neither the handover nor a user line", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/b.jsonl", opening);
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 15000)).toBe(0);
    heads.set("/t/b.jsonl", [opening, handover(T0 + 16000), plain].join("\n"));
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 30000)).toBe(1);
  });

  it("counts a change once when several polls see it at the same time", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/b.jsonl", handover(T0 + 60000));
    const counts = await Promise.all([
      restarts("1:1", "b", "/t/b.jsonl", T0 + 70000),
      restarts("1:1", "b", "/t/b.jsonl", T0 + 70000),
    ]);
    expect(Math.max(...counts)).toBe(1);
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 85000)).toBe(1);
  });

  it("keeps processes apart", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    await restarts("2:1", "x", "/t/x.jsonl", T0);
    heads.set("/t/b.jsonl", handover(T0 + 60000));
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 70000)).toBe(1);
    expect(await restarts("2:1", "x", "/t/x.jsonl", T0 + 70000)).toBe(0);
  });

  it("keeps the count across a Herdr restart and catches a restart made meanwhile", async () => {
    await restarts("1:1", "a", "/t/a.jsonl", T0);
    heads.set("/t/b.jsonl", handover(T0 + 60000));
    await restarts("1:1", "b", "/t/b.jsonl", T0 + 70000);
    restarts = await load();
    expect(await restarts("1:1", "b", "/t/b.jsonl", T0 + 100000)).toBe(1);
    restarts = await load();
    heads.set("/t/c.jsonl", handover(T0 + 500000));
    expect(await restarts("1:1", "c", "/t/c.jsonl", T0 + 900000)).toBe(2);
  });
});
