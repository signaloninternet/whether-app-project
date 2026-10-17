import { describe, expect, it } from "vitest";
import { blendFor } from "./heat";

describe("heatmap hour blending", () => {
  it("interpolates wind between hourly values", () => {
    expect(blendFor("wind", 0.25, 48)).toEqual({ i0: 0, i1: 1, t: 0.25 });
    expect(blendFor("wind", 48, 48)).toEqual({ i0: 48, i1: 48, t: 0 });
  });

  it("keeps hourly totals on the hour that contains the time", () => {
    // Frame i holds rain/snow/risk for hour [i, i+1): it must dominate inside that hour.
    for (const layer of ["rain", "snow", "risk"] as const) {
      expect(blendFor(layer, 0.4, 48)).toEqual({ i0: 0, i1: 1, t: 0 });
      expect(blendFor(layer, 1.5, 48)).toEqual({ i0: 1, i1: 2, t: 0 });
      const { i0, i1, t } = blendFor(layer, 1.2, 48); // still inside hour 1
      expect(i0).toBe(0);
      expect(i1).toBe(1);
      expect(t).toBeGreaterThan(0.5);
    }
  });
});
