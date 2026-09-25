import { permissionTransport } from "./journey-permission-collection-source.mjs";
if (process.env.NODE_ENV !== "test") throw new Error("synthetic_only");
globalThis.fetch = permissionTransport();
