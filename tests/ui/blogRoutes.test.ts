import { describe, expect, it, vi } from "vitest";
import { BLOG_POSTS, getBlogPostBySlug } from "@/app/blog/posts";

vi.mock("@/app/components/AuthAwareSignIn", () => ({
  AuthAwareSignIn: () => null,
}));

async function loadRouteModule() {
  return import("@/app/blog/[slug]/page");
}

describe("blog routes and data helpers", () => {
  it("generateStaticParams returns every blog slug", async () => {
    const { generateStaticParams } = await loadRouteModule();
    const expectedSlugs = BLOG_POSTS.map((post) => post.slug).sort();
    const params = generateStaticParams();
    const actualSlugs = params.map((item) => item.slug).sort();

    expect(actualSlugs).toEqual(expectedSlugs);
  });

  it("generateMetadata returns article metadata for valid slug", async () => {
    const { generateMetadata } = await loadRouteModule();
    const post = BLOG_POSTS[0];
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: post.slug }),
    });

    expect(metadata.title).toBe(`${post.title} | Mully Reserve Journal`);
    expect(metadata.description).toBe(post.excerpt);
    expect(metadata.openGraph).toMatchObject({
      title: post.title,
      description: post.excerpt,
      type: "article",
    });
  });

  it("generateMetadata returns empty object for unknown slug", async () => {
    const { generateMetadata } = await loadRouteModule();
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "missing-slug" }),
    });

    expect(metadata).toEqual({});
  });

  it("getBlogPostBySlug resolves valid and invalid values", () => {
    expect(getBlogPostBySlug(BLOG_POSTS[0].slug)).toBeDefined();
    expect(getBlogPostBySlug("does-not-exist")).toBeUndefined();
  });
});
