import { describe, expect, it } from "vitest";
import { buildLoopCancelBody } from "@/app/api/_lib/loopAdmin";

describe("buildLoopCancelBody", () => {
  it("cancels prepaid contracts immediately so Loop does not return 422", () => {
    expect(buildLoopCancelBody("Too expensive", { isPrepaid: true })).toEqual({
      comment: "Too expensive",
      markForCancellation: false,
    });
  });

  it("allows end-of-cycle cancel for prepaid contracts when asked", () => {
    expect(
      buildLoopCancelBody("", { isPrepaid: true, markForCancellation: true })
    ).toEqual({ markForCancellation: true });
  });

  it("omits markForCancellation for pay-as-you-go contracts", () => {
    expect(buildLoopCancelBody("Moving", { isPrepaid: false })).toEqual({
      comment: "Moving",
    });
    expect(buildLoopCancelBody("")).toEqual({});
  });
});
