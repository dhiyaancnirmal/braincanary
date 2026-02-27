import { describe, expect, it } from "vitest";
import { assertTransitionAllowed } from "./machine.js";

describe("state transitions", () => {
  it("allows stage promote transition", () => {
    expect(() => assertTransitionAllowed("STAGE", "STAGE")).not.toThrow();
  });

  it("rejects illegal transition", () => {
    expect(() => assertTransitionAllowed("IDLE", "PROMOTED")).toThrow(/Invalid transition/);
  });
});
