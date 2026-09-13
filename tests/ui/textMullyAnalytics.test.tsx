import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextMullyAnalytics from "@/app/text-mully/TextMullyAnalytics";

const trackEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tracking", () => ({
  trackEvent: trackEventMock,
}));

function renderTracker() {
  return render(
    <>
      <a href="sms:+15550100101" data-sms-link>
        Text stylist
      </a>
      <TextMullyAnalytics />
    </>
  );
}

function smsCalls() {
  return trackEventMock.mock.calls.filter(([eventName]) => eventName === "sms_click");
}

describe("TextMullyAnalytics", () => {
  beforeEach(() => {
    trackEventMock.mockReset().mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/text-mully?src=meta");
  });

  it.each([
    ["mouse", (link: HTMLAnchorElement) => fireEvent.click(link)],
    ["touch", (link: HTMLAnchorElement) => {
      fireEvent.touchStart(link);
      fireEvent.touchEnd(link);
      fireEvent.click(link);
    }],
    ["keyboard", (link: HTMLAnchorElement) => fireEvent.click(link, { detail: 0 })],
  ])("emits one event for a completed %s activation", async (_input, activate) => {
    const { getByRole } = renderTracker();
    const link = getByRole("link", { name: "Text stylist" }) as HTMLAnchorElement;

    activate(link);

    await waitFor(() => expect(smsCalls()).toHaveLength(1));
    expect(smsCalls()[0]).toEqual([
      "sms_click",
      { properties: { src: "meta" } },
      { includeAuth: false, navigation: true },
    ]);
  });

  it("does not emit for a cancelled pointer interaction", () => {
    const { getByRole } = renderTracker();
    const link = getByRole("link", { name: "Text stylist" });

    fireEvent.pointerDown(link);
    fireEvent.pointerCancel(link);

    expect(smsCalls()).toHaveLength(0);
  });

  it("does not block SMS navigation when analytics fails", async () => {
    trackEventMock.mockRejectedValue(new Error("fixture analytics outage"));
    const { getByRole } = renderTracker();
    const link = getByRole("link", { name: "Text stylist" }) as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    link.dispatchEvent(event);

    await waitFor(() => expect(smsCalls()).toHaveLength(1));
    expect(event.defaultPrevented).toBe(false);
    expect(link.href).toBe("sms:+15550100101");
  });
});
