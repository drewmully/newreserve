import { describe, expect, it } from "vitest";
import { buildLoopCancelBody } from "@/app/api/_lib/loopAdmin";

describe("buildLoopCancelBody", () => {
  it("marks prepaid contracts for cancellation so Loop does not return 422", () => {
    expect(buildLoopCancelBody("Too expensive", { isPrepaid: true })).toEqual({
      comment: "Too expensive",
      markForCancellation: true,
    });
  });

  it("allows an explicit immediate cancel for prepaid contracts", () => {
    expect(
      buildLoopCancelBody("", { isPrepaid: true, markForCancellation: false })
    ).toEqual({ markForCancellation: false });
  });

  it("omits markForCancellation for pay-as-you-go contracts", () => {
    expect(buildLoopCancelBody("Moving", { isPrepaid: false })).toEqual({
      comment: "Moving",
    });
    expect(buildLoopCancelBody("")).toEqual({});
  });
});
