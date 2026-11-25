import { isSyntheticEmail } from "@repo/db";
import { CLAMP_PARAMETERS, default_w, W17_W18_Ceiling } from "ts-fsrs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { DEFAULT_SYNTH } from "./config";
import { DEMO_EMAIL } from "./demo";
import { seededUuid, studentId } from "./ids";
import { drawStudent } from "./student";

const cohort = (seed: string, n: number) =>
  Array.from({ length: n }, (_, i) => drawStudent(seed, i, DEFAULT_SYNTH));

describe("synthetic students", () => {
  it("are the same for the same seed and differ between seeds", () => {
    expect(cohort("a", 5)).toEqual(cohort("a", 5));
    expect(cohort("b", 5).map((s) => s.bias)).not.toEqual(cohort("a", 5).map((s) => s.bias));
    expect(cohort("a", 2)[0]?.id).not.toBe(cohort("b", 2)[0]?.id);
  });

  it("all carry the synthetic marker; the first is the demo student", () => {
    const students = cohort("marker", 20);
    for (const student of students) {
      expect(isSyntheticEmail(student.email)).toBe(true);
      expect(student.id).toMatch(/^synth_[0-9a-f]{8}_\d{2}$/);
    }
    expect(students[0]?.email).toBe(DEMO_EMAIL);
    expect(new Set(students.map((s) => s.email)).size).toBe(20);
  });

  it("get perturbed FSRS-6 parameters inside ts-fsrs's valid ranges, never the defaults", () => {
    const clip = CLAMP_PARAMETERS(W17_W18_Ceiling, false);
    for (const student of cohort("params", 10)) {
      expect(student.w).toHaveLength(21);
      student.w.forEach((w, i) => {
        const [low, high] = clip[i] as [number, number];
        expect(w).toBeGreaterThanOrEqual(low);
        expect(w).toBeLessThanOrEqual(high);
      });
      expect(student.w).not.toEqual([...default_w]);
    }
  });

  it("follow the documented mix: 20 % expHalfLife, both bias signs, some exams", () => {
    const students = cohort("mix", 20);
    expect(students.filter((s) => s.family === "expHalfLife")).toHaveLength(4);
    expect(students.filter((s) => s.exam !== "none")).toHaveLength(10);
    expect(students.filter((s) => s.exam === "high")).toHaveLength(2);
    const over = students.filter((s) => s.biasGroup === "over").map((s) => s.bias);
    const under = students.filter((s) => s.biasGroup === "under").map((s) => s.bias);
    expect(Math.min(...over)).toBeGreaterThan(Math.max(...under));
    expect(Math.max(...under)).toBeLessThan(0);
    // The quick cohort covers over, under, a non-FSRS truth and an exam.
    const quick = students.slice(0, DEFAULT_SYNTH.quick.students);
    expect(new Set(quick.map((s) => s.biasGroup))).toEqual(
      new Set(["over", "under", "calibrated"]),
    );
    expect(quick.some((s) => s.family === "expHalfLife")).toBe(true);
    expect(quick.some((s) => s.exam !== "none")).toBe(true);
  });

  it("have adherence, speed and ability drawn as the spec says", () => {
    for (const student of cohort("draws", 20)) {
      expect(student.adherence).toBeGreaterThan(0);
      expect(student.adherence).toBeLessThan(1);
      expect(student.speed).toBeGreaterThan(0);
      expect(student.ability).toBeGreaterThan(0);
      const [earliest, latest] = DEFAULT_SYNTH.day.sessionHours;
      expect(student.sessionHour).toBeGreaterThanOrEqual(earliest);
      expect(student.sessionHour).toBeLessThanOrEqual(latest);
    }
  });
});

describe("seeded ids", () => {
  it("are valid, stable uuids", () => {
    const id = seededUuid("a", 1, "item");
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(seededUuid("a", 1, "item")).toBe(id);
    expect(seededUuid("a", 2, "item")).not.toBe(id);
    expect(studentId("x", 0)).toBe(studentId("x", 0));
  });
});
