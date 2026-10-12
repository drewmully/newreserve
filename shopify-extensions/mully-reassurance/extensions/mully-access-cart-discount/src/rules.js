// Mully Access monthly membership variant (Shopify Subscriptions, $15/mo).
export const ACCESS_VARIANT_ID = "gid://shopify/ProductVariant/50477797081280";
export const ACCESS_PERCENT = 10;

export const accessLines = (lines = []) =>
  lines.filter((l) => l.merchandise?.__typename === "ProductVariant" && l.merchandise.id === ACCESS_VARIANT_ID);

export function cartLinesDiscountsGenerateRun(input) {
  const classes = input.discount?.discountClasses ?? [];
  const access = accessLines(input.cart?.lines);
  const others = (input.cart?.lines ?? []).length - access.length;
  if (!classes.includes("ORDER") || !access.length || others < 1) return { operations: [] };
  return {
    operations: [{
      orderDiscountsAdd: {
        selectionStrategy: "FIRST",
        candidates: [{
          message: `Mully Access ${ACCESS_PERCENT}%`,
          targets: [{ orderSubtotal: { excludedCartLineIds: access.map((l) => l.id) } }],
          value: { percentage: { value: ACCESS_PERCENT } },
        }],
      },
    }],
  };
}

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  const classes = input.discount?.discountClasses ?? [];
  const groups = input.cart?.deliveryGroups ?? [];
  if (!classes.includes("SHIPPING") || !accessLines(input.cart?.lines).length || !groups.length) return { operations: [] };
  return {
    operations: [{
      deliveryDiscountsAdd: {
        selectionStrategy: "ALL",
        candidates: [{
          message: "Mully Access free shipping",
          targets: groups.map((g) => ({ deliveryGroup: { id: g.id } })),
          value: { percentage: { value: 100 } },
        }],
      },
    }],
  };
}
