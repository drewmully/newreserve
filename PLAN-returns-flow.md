# Returns Flow — Implementation Plan

## Overview
A self-service returns flow at `/returns` that lets customers initiate returns by entering their order number, viewing eligible items, and submitting a return request. Store credit is issued at equal value via Shopify Returns. A "Returns" link will be added to the site footer.

---

## Route: `/returns`

Single-page, multi-step client component (`"use client"`) matching existing patterns (see `/onboarding`).

---

## Step 1 — Enter Order Number

**UI**
- Clean centered card on `bg-bone` with the standard `ShopHeader`
- Input field for order number + email (email for verification, matches Shopify lookup)
- "Look Up Order" button (forest green, `btn-press` class)
- Subtle helper text: "Find your order number in your confirmation email"
- Error state for invalid/not-found orders

**Backend stub (for Leo)**
```
// POST /api/returns/lookup
// Body: { orderNumber: string, email: string }
// 1. Fetch order from Shopify Admin API (GET /admin/api/2024-01/orders.json?name={orderNumber})
// 2. Fetch shipment from ShipStation API (GET /shipments?orderNumber={orderNumber})
//    — ShipStation shipment contains child SKU data for bundles/kits
//    — Use this to break down parent line items into individual returnable SKUs
// 3. Return merged payload:
//    {
//      orderId: string,
//      orderName: string,         // e.g. "#1042"
//      orderDate: string,
//      items: Array<{
//        lineItemId: string,
//        sku: string,
//        title: string,
//        variantTitle: string,     // e.g. "Navy / L"
//        quantity: number,
//        returnableQty: number,    // quantity minus already-returned
//        price: number,            // unit price
//        image: string,            // product image URL
//        isChildSku: boolean,      // true if expanded from ShipStation bundle
//        parentSku?: string,       // parent SKU if isChildSku
//      }>
//    }
```

---

## Step 2 — Select Items to Return

**UI**
- Display order summary header (order #, date)
- List of returnable items as selectable cards:
  - Product image (left), title + variant + price (right)
  - Checkbox/toggle to select for return
  - Quantity selector if qty > 1
  - Greyed-out items that are not eligible (already returned, final sale)
- Each selected item gets a "Reason for return" dropdown:
  - Wrong size
  - Didn't like the fit
  - Not as described
  - Damaged/defective
  - Changed my mind
  - Other
- Running total of store credit at bottom
- "Continue" button (disabled until ≥1 item selected)

**Backend stub (for Leo)**
```
// No additional API call needed here — all data comes from Step 1 response
// State is managed client-side
```

---

## Step 3 — Review & Submit

**UI**
- Summary of selected return items with quantities and credit amounts
- Policy reminder: "Returns are issued as store credit to your Mully Pro Shop account at equal value."
- Return shipping info based on membership tier (from MembershipContext):
  - Reserve Member & Black: "Free prepaid return label"
  - Reserve Access: "$5.95 flat-rate return shipping"
  - Free: "You'll need to ship the return yourself"
- "Submit Return" button

**Backend stub (for Leo)**
```
// POST /api/returns/create
// Body: {
//   orderId: string,
//   items: Array<{ lineItemId: string, quantity: number, reason: string }>,
//   customerEmail: string
// }
//
// Implementation:
// 1. Create return via Shopify Admin API — POST /admin/api/2024-01/orders/{orderId}/returns.json
//    — Shopify Returns API handles the return record, restocking, etc.
//    — Set return_line_items with decline_reason mapped from user selection
//
// 2. Issue store credit via Shopify Admin API
//    — POST /admin/api/2024-01/gift_cards.json (or use store credit metafield)
//    — Amount = sum of selected item prices
//    — Associate with customer email
//
// 3. (Optional) Create return shipping label via ShipStation API
//    — POST /shipments/createlabel
//    — Use original shipment's toAddress as fromAddress and vice versa
//    — Weight/dimensions from original shipment
//    — Return label URL in response to show user
//
// 4. Return confirmation:
//    {
//      returnId: string,
//      creditAmount: number,
//      labelUrl?: string,        // if auto-generated
//      labelTrackingNumber?: string,
//      status: "submitted"
//    }
```

---

## Step 4 — Confirmation

**UI**
- Success checkmark animation
- "Your return has been submitted" message
- Store credit amount displayed prominently
- If label was generated: download/print label button + tracking number
- If no label: shipping instructions with return address
- "Return to Shop" button linking to `/shop`
- "View Account" button linking to `/account`

---

## Footer Update

Add a "Returns" link to the footer across all pages that have one. The footer pattern is inline (not a shared component), so we update each instance:

**Files to update:**
- `src/app/shop/page.tsx`
- `src/app/shop/[slug]/page.tsx`
- `src/app/page.tsx` (landing)
- `src/app/faq/page.tsx`
- `src/app/blog/page.tsx`
- `src/app/community/page.tsx`
- `src/app/community/post/[id]/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/account/page.tsx`
- `src/app/policies/layout.tsx`

Add between existing links:
```tsx
<Link href="/returns" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Returns</Link>
```

---

## File Structure

```
src/app/returns/
  page.tsx          — Main returns flow (client component, multi-step)
src/app/api/returns/
  lookup/route.ts   — Stub: order lookup endpoint (for Leo)
  create/route.ts   — Stub: return submission endpoint (for Leo)
```

---

## Design Notes

- Matches existing brand: `bg-bone`, `text-forest`, `font-serif` headings, `font-sans` body
- Uses existing animation classes (`animate-fade-up`, `glass-card`)
- Step indicator dots similar to onboarding flow
- Mobile-first responsive layout
- Uses `ShopHeader` for consistent navigation
- Leverages `MembershipContext` for tier-based shipping info
