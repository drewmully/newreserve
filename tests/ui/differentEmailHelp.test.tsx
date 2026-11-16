import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DifferentEmailHelp, supportMailto } from "@/app/account/DifferentEmailHelp";

describe("DifferentEmailHelp", () => {
  it("builds a support email with the account email and uid, using %20 for spaces", () => {
    const href = supportMailto({ email: "a@b.co", uid: "uid_1", topic: "subscription" });
    expect(href.startsWith("mailto:info@mymully.com?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("subject=")[1].split("&")[0])).toBe("Can't find my subscription");
    expect(href).not.toContain("+");
    const body = decodeURIComponent(href.split("body=")[1]);
    expect(body).toContain("Account email: a@b.co");
    expect(body).toContain("Account ID: uid_1");
  });

  it("renders without a sign-out button when no handler is given", () => {
    render(<DifferentEmailHelp email={null} topic="orders" />);
    expect(screen.getByText(/Bought with a different email\?/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect((screen.getByRole("link", { name: "Contact us" }) as HTMLAnchorElement).href).toContain("not%20available");
  });
});
