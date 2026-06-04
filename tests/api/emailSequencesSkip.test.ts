import { beforeEach, describe, expect, it, vi } from "vitest";

const adminDbCollectionMock = vi.fn();

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

async function loadModule() {
  vi.resetModules();
  return import("@/lib/email/sequences");
}

describe("email sequence skip conditions", () => {
  beforeEach(() => {
    adminDbCollectionMock.mockReset();
  });

  it("checks concierge requests by user_id", async () => {
    const whereMock = vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ empty: false }),
      })),
    }));

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "concierge_requests") {
        throw new Error(`Unexpected collection ${name}`);
      }

      return {
        where: whereMock,
      };
    });

    const { checkSkip } = await loadModule();
    await expect(checkSkip("uid_2", "has_concierge_request")).resolves.toBe(
      true
    );
    expect(whereMock).toHaveBeenCalledWith("user_id", "==", "uid_2");
  });

  it("checks V1 activation by user_id and the canonical benefit key", async () => {
    const secondWhereMock = vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ empty: false }),
      })),
    }));
    const firstWhereMock = vi.fn(() => ({
      where: secondWhereMock,
    }));

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "benefit_actions") {
        throw new Error(`Unexpected collection ${name}`);
      }

      return {
        where: firstWhereMock,
      };
    });

    const { checkSkip } = await loadModule();
    await expect(checkSkip("uid_3", "has_v1_activated")).resolves.toBe(true);
    expect(firstWhereMock).toHaveBeenCalledWith("user_id", "==", "uid_3");
    expect(secondWhereMock).toHaveBeenCalledWith(
      "benefit",
      "==",
      "v1_virtual_coaching"
    );
  });
});
