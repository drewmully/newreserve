import { agreementCollectionSource, agreementCollectionTransport } from "./agreement-collection-source.mjs";
if (process.env.NODE_ENV !== "test") throw new Error("synthetic_only");
globalThis.fetch = agreementCollectionTransport(agreementCollectionSource(), process.env.SYNTHETIC_AGREEMENT_MODE);
