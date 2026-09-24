import { offerTransport } from "./offer-collection-source.mjs";
if (process.env.NODE_ENV !== "test") throw new Error("synthetic_only");
globalThis.fetch = offerTransport();
