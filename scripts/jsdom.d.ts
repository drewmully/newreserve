// Minimal types for the jsdom API used by scripts/newsletter-to-post.ts
// (jsdom ships without types and @types/jsdom is not installed).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    window: { document: Document };
  }
}
