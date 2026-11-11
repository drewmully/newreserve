import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinForm } from "@/app/join/JoinForm";
import JoinPage from "@/app/join/page";

afterEach(() => vi.unstubAllGlobals());

describe("/join page", () => {
  it("renders the copy with no em dashes and whitelists ?source=", async () => {
    const { container } = render(await JoinPage({ searchParams: Promise.resolve({ source: "not-allowed" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Get The Mully Edit.");
    expect(container.textContent).toContain("A twice-weekly guide to golf style, gear and the stories behind them.");
    expect(container.textContent).not.toMatch(/\u2014/);
    expect(container.querySelector("form")?.getAttribute("data-source")).toBe("forwarded");
  });

  it("keeps a whitelisted ?source=", async () => {
    const { container } = render(await JoinPage({ searchParams: Promise.resolve({ source: "qr" }) }));
    expect(container.querySelector("form")?.getAttribute("data-source")).toBe("qr");
  });

  it("has an unchecked, required consent box and posts source with consent", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    render(<JoinForm source="forwarded" />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.required).toBe(true);
    expect(box.closest("label")?.textContent).toContain("I’d like emails from Mully. Unsubscribe anytime.");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "fwd@example.com" } });
    fireEvent.click(box);
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("You’re on the list."));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/editorial/drop-signup");
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "fwd@example.com", source: "forwarded", consent: true, hp: "" });
  });
});
