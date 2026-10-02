import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
describe("shop-first routing", () => {
  it.each(["/lp/consult","/lp/discover","/lp/subscription"])("preserves subscription acquisition and attribution for %s", path => {
    const result = middleware(new NextRequest(`https://www.mymully.com${path}?utm_source=google&gclid=click`));
    expect(result.status).toBe(301);
    expect(result.headers.get("location")).toBe("https://www.mymully.com/subscription?utm_source=google&gclid=click");
  });
  it.each(["/home", "/dashboard"])("deprecates %s without losing query attribution", path => {
    const result = middleware(new NextRequest(`https://www.mymully.com${path}?tab=shop&utm_source=email`));
    expect(result.headers.get("location")).toBe("https://www.mymully.com/?utm_source=email");
  });
  it.each(["/", "/shop", "/subscription", "/account", "/auth/callback"])("does not redirect working route %s", path => {
    expect(middleware(new NextRequest(`https://www.mymully.com${path}`)).headers.get("location")).toBeNull();
  });
});
