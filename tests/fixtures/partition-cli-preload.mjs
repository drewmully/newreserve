import { partitionTransport } from "./partition-collection-source.mjs";
if (process.env.NODE_ENV !== "test") throw new Error("synthetic_only");
globalThis.fetch = partitionTransport();
