import { ExamError, type ExamErrorCode } from "@repo/revision";
import { describe, expect, it } from "vitest";
import { examErrorBody, examResponse, jsonBody } from "./exams";

// The age gate is enforced once, at sign-up (dobSchema in lib/age.ts, tested in age.test.ts); like
// the review routes, the exam routes check only for a session (EM-14).

describe("examErrorBody (plan §4.6)", () => {
  it.each<[ExamErrorCode, number]>([
    ["invalid_request", 400],
    ["invalid_date", 400],
    ["date_too_far", 400],
    ["invalid_target", 400],
    ["empty_scope", 400],
    ["unreadable_scope", 400],
    ["too_many_exams", 400],
    ["not_found", 404],
  ])("%s → %d", (code, status) => {
    expect(examErrorBody(new ExamError(code, "Why."))).toEqual({
      status,
      body: { error: code, message: "Why." },
    });
  });

  it("names the field when there is one, and ignores other errors", () => {
    expect(examErrorBody(new ExamError("invalid_target", "Range.", "target_retention"))).toEqual({
      status: 400,
      body: { error: "invalid_target", message: "Range.", field: "target_retention" },
    });
    expect(examErrorBody(new Error("boom"))).toBeNull();
  });
});

describe("examResponse", () => {
  it("answers JSON with the status, no-store, and an empty 204", async () => {
    const created = await examResponse(false, async () => ({ status: 201, body: { id: "x" } }));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(await created.json()).toEqual({ id: "x" });
    const deleted = await examResponse(false, async () => ({ status: 204 }));
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
  });

  it("turns an ExamError into its status and rethrows anything else", async () => {
    const missing = await examResponse(false, async () => {
      throw new ExamError("not_found", "No such exam.");
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found", message: "No such exam." });
    await expect(
      examResponse(false, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("refuses a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/exams", { method: "POST", body: "{" });
    await expect(jsonBody(request)).rejects.toMatchObject({ code: "invalid_request" });
  });
});
