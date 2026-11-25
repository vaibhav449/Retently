import { describe, expect, it } from "vitest";
import { checkDemoAllowed, checkTarget, describeTarget, UnsafeTargetError } from "./safety";

describe("checkTarget", () => {
  it.each([
    "postgres://app:app@localhost:5432/app",
    "postgres://app:app@127.0.0.1:5432/app",
    "postgres://app:app@[::1]:5432/app",
    "postgres://app:app@LOCALHOST/app",
  ])("accepts this machine: %s", (url) => {
    expect(checkTarget(url, { allowRemote: false }).local).toBe(true);
  });

  it("refuses any other host unless --allow-remote", () => {
    const url = "postgres://app:secret@db.example.com:6543/prod";
    expect(() => checkTarget(url, { allowRemote: false })).toThrow(UnsafeTargetError);
    expect(checkTarget(url, { allowRemote: true })).toEqual({
      host: "db.example.com",
      port: "6543",
      database: "prod",
      local: false,
    });
  });

  it("reads a host given as ?host=, as libpq does", () => {
    expect(describeTarget("postgres://app@localhost/app?host=10.0.0.5").host).toBe("10.0.0.5");
    expect(() =>
      checkTarget("postgres://app@localhost/app?host=10.0.0.5", { allowRemote: false }),
    ).toThrow(UnsafeTargetError);
  });

  it("never prints the password", () => {
    const target = describeTarget("postgres://app:hunter2@localhost:5432/app");
    expect(JSON.stringify(target)).not.toContain("hunter2");
  });
});

describe("checkDemoAllowed", () => {
  it("refuses the demo sign-in in production only", () => {
    expect(() => checkDemoAllowed({ NODE_ENV: "production" }, true)).toThrow(UnsafeTargetError);
    expect(() => checkDemoAllowed({ NODE_ENV: "production" }, false)).not.toThrow();
    expect(() => checkDemoAllowed({ NODE_ENV: "development" }, true)).not.toThrow();
    expect(() => checkDemoAllowed({}, true)).not.toThrow();
  });
});
