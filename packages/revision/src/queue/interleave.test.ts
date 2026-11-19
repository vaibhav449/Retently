import { describe, expect, it } from "vitest";
import { interleave } from "./interleave";

const item = (name: string, topicKey: string) => ({ name, topicKey });
const names = (items: readonly { name: string }[]) => items.map((entry) => entry.name).join(" ");

describe("interleave (06 §7)", () => {
  it("takes the highest-priority item whose topic differs from the last", () => {
    const byPriority = [item("a", "T1"), item("b", "T1"), item("c", "T2"), item("d", "T3")];
    expect(names(interleave(byPriority))).toBe("a c b d");
  });

  it("repeats a topic only when every remaining item shares it (Q-E12)", () => {
    expect(names(interleave([item("a", "T1"), item("b", "T1"), item("c", "T1")]))).toBe("a b c");
    expect(names(interleave([item("a", "T1"), item("b", "T1"), item("c", "T2")]))).toBe("a c b");
  });

  it("avoids a repeat across the boundary with the topic before the list (an extension)", () => {
    const byPriority = [item("a", "T1"), item("b", "T2")];
    expect(names(interleave(byPriority, "T1"))).toBe("b a");
    expect(names(interleave(byPriority, null))).toBe("a b");
  });

  it("handles an empty list and leaves its input unchanged", () => {
    expect(interleave([])).toEqual([]);
    const input = [item("a", "T1"), item("b", "T1"), item("c", "T2")];
    const copy = [...input];
    interleave(input);
    expect(input).toEqual(copy);
  });
});
