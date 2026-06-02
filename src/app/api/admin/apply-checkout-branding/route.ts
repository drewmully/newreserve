/**
 * POST /api/admin/apply-checkout-branding
 *
 * One-shot endpoint that uploads the Mully favicon + checkout header logo
 * to Shopify and applies the full checkout branding (color schemes,
 * typography, corner radius, button styling) to the published checkout
 * profile so the headless checkout at checkout.mymully.com visually matches
 * mymully.com.
 *
 * Auth: requireAdmin (Firebase ID token from allowlisted admin email).
 *
 * Body (optional JSON):
 *   {
 *     "profile": "published" | "draft"   // default: "published"
 *     "dryRun": boolean                   // default: false — uploads files but skips brandingUpsert
 *   }
 *
 * Intended to be invoked once via curl, then the route file should be
 * deleted from the repo. The script equivalent lives at
 * scripts/apply-checkout-branding.mjs.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";

// Publicly-hosted asset URLs. Shopify's fileCreate downloads from these directly,
// which avoids needing the write_files scope that stagedUploadsCreate requires.
const PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://www.mymully.com";
const FAVICON_URL = `${PUBLIC_ORIGIN}/checkout-branding/favicon.png`;
const LOGO_URL = `${PUBLIC_ORIGIN}/checkout-branding/header-logo.png`;

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================
// Brand tokens — kept in sync with src/app/globals.css @theme inline
// ============================================================
const COLORS = {
  forest: "#1F3D2B",
  forestLight: "#2A5239",
  forestDark: "#162B1E",
  bone: "#F5F1E8",
  boneDark: "#EDE8DC",
  cream: "#FAF9F6",
  obsidian: "#111111",
  charcoal: "#2A2A2A",
  sage: "#6E8B74",
  taupe: "#C8BFAF",
  ember: "#D4772C",
};

const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2025-01";
const STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ?? "mullybox-store.myshopify.com";

function adminEndpoint() {
  return `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
}

function adminToken() {
  const t = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!t) throw new Error("SHOPIFY_ADMIN_TOKEN is not set in the environment");
  return t;
}

// ============================================================
// GraphQL helper
// ============================================================
type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(adminEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": adminToken(),
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GqlResponse<T>;
  if (!res.ok || json.errors) {
    throw new Error(
      `GraphQL ${res.status}: ${JSON.stringify(json.errors ?? json)}`
    );
  }
  if (!json.data) throw new Error("GraphQL returned no data");
  return json.data;
}

// ============================================================
// 1. Register an image with Shopify by URL (no write_files scope needed).
//    fileCreate downloads the image from `originalSource` itself.
// ============================================================
async function registerImageFromUrl(url: string, alt: string): Promise<string> {
  const fileCreateQuery = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on MediaImage { image { url } }
        }
        userErrors { field message }
      }
    }
  `;
  type FileCreateResp = {
    fileCreate: {
      files: Array<{ id: string; fileStatus: string; image?: { url: string } }>;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  };
  const created = await gql<FileCreateResp>(fileCreateQuery, {
    files: [{ alt, contentType: "IMAGE", originalSource: url }],
  });
  if (created.fileCreate.userErrors.length) {
    throw new Error("fileCreate: " + JSON.stringify(created.fileCreate.userErrors));
  }
  const file = created.fileCreate.files[0];
  return await waitForReady(file.id);
}

async function waitForReady(fileId: string, timeoutMs = 60_000): Promise<string> {
  const query = `
    query node($id: ID!) {
      node(id: $id) {
        ... on MediaImage { id fileStatus image { url } }
      }
    }
  `;
  type Resp = { node: { id: string; fileStatus: string; image?: { url: string } } | null };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await gql<Resp>(query, { id: fileId });
    const node = data.node;
    if (node?.fileStatus === "READY") return node.id;
    if (node?.fileStatus === "FAILED") throw new Error(`File ${fileId} FAILED processing`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`File ${fileId} not READY after ${timeoutMs}ms`);
}

// ============================================================
// 2. Find checkout profile
// ============================================================
type Profile = { id: string; name: string; isPublished: boolean };

async function getProfile(target: "published" | "draft"): Promise<Profile> {
  const query = `
    query profiles {
      checkoutProfiles(first: 20) {
        edges { node { id name isPublished } }
      }
    }
  `;
  type Resp = { checkoutProfiles: { edges: Array<{ node: Profile }> } };
  const data = await gql<Resp>(query);
  const profiles = data.checkoutProfiles.edges.map((e) => e.node);
  const match =
    target === "draft"
      ? profiles.find((p) => !p.isPublished)
      : profiles.find((p) => p.isPublished);
  if (!match) throw new Error(`No ${target} checkout profile found`);
  return match;
}

// ============================================================
// 3. Build CheckoutBrandingInput
// ============================================================
function buildBrandingInput(faviconMediaId: string, logoMediaId: string) {
  return {
    designSystem: {
      colors: {
        global: { accent: COLORS.forest, brand: COLORS.forest },
        schemes: {
          // Scheme 1 — main canvas
          scheme1: {
            base: {
              background: COLORS.bone,
              text: COLORS.obsidian,
              accent: COLORS.forest,
              decorative: COLORS.sage,
              border: COLORS.taupe,
              icon: COLORS.charcoal,
            },
            control: {
              color: COLORS.obsidian,
              background: COLORS.cream,
              border: COLORS.taupe,
              decorative: COLORS.sage,
              icon: COLORS.charcoal,
            },
            primaryButton: {
              background: COLORS.forest,
              text: COLORS.bone,
              border: COLORS.forest,
              hover: {
                background: COLORS.forestLight,
                text: COLORS.bone,
                border: COLORS.forestLight,
              },
            },
            secondaryButton: {
              background: "TRANSPARENT",
              text: COLORS.forest,
              border: COLORS.forest,
              hover: {
                background: COLORS.forest,
                text: COLORS.bone,
                border: COLORS.forest,
              },
            },
          },
          // Scheme 2 — order summary
          scheme2: {
            base: {
              background: COLORS.cream,
              text: COLORS.obsidian,
              accent: COLORS.forest,
              decorative: COLORS.sage,
              border: COLORS.taupe,
              icon: COLORS.charcoal,
            },
            control: {
              color: COLORS.obsidian,
              background: COLORS.bone,
              border: COLORS.taupe,
              decorative: COLORS.sage,
              icon: COLORS.charcoal,
            },
            primaryButton: {
              background: COLORS.forest,
              text: COLORS.bone,
              border: COLORS.forest,
              hover: {
                background: COLORS.forestLight,
                text: COLORS.bone,
                border: COLORS.forestLight,
              },
            },
            secondaryButton: {
              background: "TRANSPARENT",
              text: COLORS.forest,
              border: COLORS.forest,
              hover: {
                background: COLORS.forest,
                text: COLORS.bone,
                border: COLORS.forest,
              },
            },
          },
        },
      },
      typography: {
        size: { base: 14.0, ratio: 1.2 },
        primary: {
          shopifyFontGroup: {
            name: "Playfair Display",
            baseWeight: 400,
            boldWeight: 700,
          },
        },
        secondary: {
          shopifyFontGroup: {
            name: "Inter",
            baseWeight: 400,
            boldWeight: 600,
          },
        },
      },
      cornerRadius: { base: 8, small: 4 },
    },
    customizations: {
      favicon: { mediaImageId: faviconMediaId },
      headingLevel1: { typography: { font: "PRIMARY", weight: "BOLD" } },
      headingLevel2: { typography: { font: "PRIMARY", weight: "BOLD" } },
      headingLevel3: { typography: { font: "PRIMARY", weight: "BOLD" } },
      header: {
        position: "INLINE",
        alignment: "CENTER",
        logo: {
          image: { mediaImageId: logoMediaId },
          maxWidth: 180,
        },
      },
      main: { colorScheme: "SCHEME1" },
      orderSummary: { colorScheme: "SCHEME2" },
      primaryButton: {
        blockPadding: "BASE",
        inlinePadding: "BASE",
        cornerRadius: "BASE",
        border: "FULL",
      },
      secondaryButton: { cornerRadius: "BASE", border: "FULL" },
      buyerJourney: { visibility: "ALL" },
      cartLink: { contentType: "ICON" },
      checkbox: { cornerRadius: "SMALL" },
      controls: { cornerRadius: "SMALL", border: "FULL", labelPosition: "INSIDE" },
      textField: { border: "FULL", cornerRadius: "SMALL" },
      select: { border: "FULL", cornerRadius: "SMALL" },
      merchandiseThumbnail: { cornerRadius: "SMALL", border: "FULL" },
      expressCheckout: { button: { cornerRadius: "BASE" } },
      content: { divider: { style: "SOLID", width: "BASE" } },
      footer: {
        position: "INLINE",
        alignment: "START",
        content: { visibility: "VISIBLE" },
      },
      global: { typography: { letterCase: "NONE", kerning: "BASE" } },
    },
  };
}

// ============================================================
// 4. Apply branding
// ============================================================
async function applyBranding(profileId: string, input: ReturnType<typeof buildBrandingInput>) {
  const query = `
    mutation upsert($checkoutBrandingInput: CheckoutBrandingInput!, $checkoutProfileId: ID!) {
      checkoutBrandingUpsert(
        checkoutBrandingInput: $checkoutBrandingInput
        checkoutProfileId: $checkoutProfileId
      ) {
        checkoutBranding {
          designSystem {
            colors { global { accent brand } }
            typography { primary { name } secondary { name } }
          }
          customizations {
            favicon { mediaImage { id image { url } } }
            header { logo { image { mediaImage { id image { url } } } } }
          }
        }
        userErrors { field message code }
      }
    }
  `;
  type Resp = {
    checkoutBrandingUpsert: {
      checkoutBranding: unknown;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  };
  const data = await gql<Resp>(query, {
    checkoutProfileId: profileId,
    checkoutBrandingInput: input,
  });
  if (data.checkoutBrandingUpsert.userErrors.length) {
    throw new Error(
      "checkoutBrandingUpsert: " +
        JSON.stringify(data.checkoutBrandingUpsert.userErrors)
    );
  }
  return data.checkoutBrandingUpsert.checkoutBranding;
}

// ============================================================
// Handler
// ============================================================
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  let body: { profile?: "published" | "draft"; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const profileTarget = body.profile ?? "published";
  const dryRun = body.dryRun ?? false;

  const log: Record<string, unknown> = {
    store: STORE_DOMAIN,
    apiVersion: API_VERSION,
    profileTarget,
    dryRun,
    admin: guard.email,
    startedAt: new Date().toISOString(),
  };

  try {
    log.faviconUrl = FAVICON_URL;
    log.logoUrl = LOGO_URL;

    const profile = await getProfile(profileTarget);
    log.profile = profile;

    const faviconMediaId = await registerImageFromUrl(
      FAVICON_URL,
      "Mully checkout favicon"
    );
    log.faviconMediaId = faviconMediaId;

    const logoMediaId = await registerImageFromUrl(
      LOGO_URL,
      "Mully checkout header logo"
    );
    log.logoMediaId = logoMediaId;

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, log }, { status: 200 });
    }

    const branding = await applyBranding(
      profile.id,
      buildBrandingInput(faviconMediaId, logoMediaId)
    );
    log.applied = true;
    log.completedAt = new Date().toISOString();

    return NextResponse.json({ ok: true, log, branding }, { status: 200 });
  } catch (err) {
    log.error = err instanceof Error ? err.message : String(err);
    log.failedAt = new Date().toISOString();
    return NextResponse.json({ ok: false, log }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json(
    {
      hint: "POST with a Firebase ID token from an allowlisted admin email. Body: { profile?: 'published'|'draft', dryRun?: boolean }",
    },
    { status: 200 }
  );
}
