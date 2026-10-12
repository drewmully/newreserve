/**
 * Map a mangled tab value ("shop" + original Shopify path) to a headless
 * route. Returns null when the tab is a plain dashboard tab.
 */
export function recoverShopifyPath(
  tab: string | null,
): { pathname: string; params: URLSearchParams } | null {
  if (!tab || !tab.startsWith("shop") || tab.length <= 4) return null;
  const rest = tab.slice(4);
  const qIndex = rest.indexOf("?");
  const rawPath = (qIndex === -1 ? rest : rest.slice(0, qIndex)).replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams(qIndex === -1 ? "" : rest.slice(qIndex + 1));
  const parts = rawPath.split("/").filter(Boolean).map((p) => {
    try { return encodeURIComponent(decodeURIComponent(p)); } catch { return encodeURIComponent(p); }
  });
  if (parts.length === 0) return null;

  let pathname = "/";
  if (parts[0] === "products" && parts[1]) {
    pathname = `/shop/${parts[1]}`;
  } else if (parts[0] === "collections") {
    if (parts[2] === "products" && parts[3]) pathname = `/shop/${parts[3]}`;
    else if (!parts[1] || parts[1] === "all") pathname = "/shop";
    else pathname = `/shop/collection/${parts[1]}`;
  }
  return { pathname, params };
}
