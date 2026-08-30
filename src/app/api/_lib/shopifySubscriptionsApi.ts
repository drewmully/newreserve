/**
 * Shopify Subscriptions Admin GraphQL client — server-side only.
 *
 * This is the NEW Partner-Dashboard-app client that owns subscription contract
 * mutations. It is separate from `shopifyAdmin.ts` because the existing
 * admin-installed custom app token (`SHOPIFY_ADMIN_TOKEN`) CANNOT be granted
 * protected subscription scopes — that is a hard Shopify constraint. See
 * `memory/knowledge/projects/loop-to-shopify-subscription-migration.md` and
 * the full migration plan for context.
 *
 * This client is currently unused at runtime. It ships behind the
 * `SUBSCRIPTIONS_BACKEND` feature flag (default: "loop") so `/api/subscription/*`
 * routes 404 until Drew flips the flag to "shopify".
 *
 * Credentials:
 *   SHOPIFY_SUBSCRIPTIONS_TOKEN     — new Partner-app access token
 *
 * Reuses (from shopifyAdmin.ts semantics):
 *   SHOPIFY_STORE_DOMAIN            — e.g. "mullybox-store.myshopify.com"
 *   SHOPIFY_ADMIN_API_VERSION       — defaults to "2024-10"
 *
 * Every mutation string in this file matches the migration plan Section 3
 * (`memory/sessions/2026-06-29_2026-07-05/a0280c2d/ai_outputs/loop_to_shopify_migration_plan.md`).
 * If you change a mutation string, update the plan reference in the PR body
 * so the audit trail stays intact.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        "Add it to your server-side environment (never expose to the client)."
    );
  }
  return value;
}

function getStoreDomain(): string {
  return requireEnv("SHOPIFY_STORE_DOMAIN", process.env.SHOPIFY_STORE_DOMAIN);
}

function getApiVersion(): string {
  return process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
}

function getGraphQLEndpoint(): string {
  return `https://${getStoreDomain()}/admin/api/${getApiVersion()}/graphql.json`;
}

function getSubscriptionsHeaders(): Record<string, string> {
  const token = process.env.SHOPIFY_SUBSCRIPTIONS_TOKEN;
  if (!token) {
    throw new Error(
      "Missing SHOPIFY_SUBSCRIPTIONS_TOKEN. This is the new Partner-app token " +
        "for subscription contract mutations. It is distinct from " +
        "SHOPIFY_ADMIN_TOKEN, which cannot access subscription scopes."
    );
  }
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

export interface ShopifyUserError {
  field?: string[] | null;
  message: string;
}

async function subscriptionsGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(getGraphQLEndpoint(), {
    method: "POST",
    headers: getSubscriptionsHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `Shopify Subscriptions API error ${res.status}: ${await res.text()}`
    );
  }

  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(
      `Shopify Subscriptions GraphQL errors: ${JSON.stringify(json.errors)}`
    );
  }

  return json.data;
}

function throwOnUserErrors(
  mutationName: string,
  userErrors: ShopifyUserError[] | undefined | null
): void {
  if (userErrors && userErrors.length > 0) {
    throw new Error(
      `${mutationName} userErrors: ${JSON.stringify(userErrors)}`
    );
  }
}

// ─── Status mutations (no draft) ─────────────────────────────────────────────

export const PAUSE_CONTRACT_MUTATION = `
  mutation SubscriptionContractPause($id: ID!) {
    subscriptionContractPause(subscriptionContractId: $id) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export async function pauseContract(contractId: string) {
  const data = await subscriptionsGraphQL<{
    subscriptionContractPause: {
      contract: { id: string; status: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(PAUSE_CONTRACT_MUTATION, { id: contractId });
  throwOnUserErrors("subscriptionContractPause", data.subscriptionContractPause.userErrors);
  return data.subscriptionContractPause.contract;
}

export const ACTIVATE_CONTRACT_MUTATION = `
  mutation SubscriptionContractActivate($id: ID!) {
    subscriptionContractActivate(subscriptionContractId: $id) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export async function activateContract(contractId: string) {
  const data = await subscriptionsGraphQL<{
    subscriptionContractActivate: {
      contract: { id: string; status: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(ACTIVATE_CONTRACT_MUTATION, { id: contractId });
  throwOnUserErrors(
    "subscriptionContractActivate",
    data.subscriptionContractActivate.userErrors
  );
  return data.subscriptionContractActivate.contract;
}

export const CANCEL_CONTRACT_MUTATION = `
  mutation SubscriptionContractCancel($id: ID!) {
    subscriptionContractCancel(subscriptionContractId: $id) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export async function cancelContract(contractId: string) {
  const data = await subscriptionsGraphQL<{
    subscriptionContractCancel: {
      contract: { id: string; status: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(CANCEL_CONTRACT_MUTATION, { id: contractId });
  throwOnUserErrors(
    "subscriptionContractCancel",
    data.subscriptionContractCancel.userErrors
  );
  return data.subscriptionContractCancel.contract;
}

// ─── Draft lifecycle (Update → DraftUpdate/DraftLineUpdate → DraftCommit) ───

export const CONTRACT_UPDATE_MUTATION = `
  mutation SubscriptionContractUpdate($id: ID!) {
    subscriptionContractUpdate(contractId: $id) {
      draft { id }
      userErrors { field message }
    }
  }
`;

export const DRAFT_UPDATE_MUTATION = `
  mutation SubscriptionDraftUpdate($draftId: ID!, $input: SubscriptionDraftInput!) {
    subscriptionDraftUpdate(draftId: $draftId, input: $input) {
      draft { id }
      userErrors { field message }
    }
  }
`;

export const DRAFT_LINE_UPDATE_MUTATION = `
  mutation SubscriptionDraftLineUpdate(
    $draftId: ID!
    $lineId: ID!
    $input: SubscriptionLineUpdateInput!
  ) {
    subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
      draft {
        id
        lines(first: 20) {
          edges {
            node { id productId variantId sellingPlanId customAttributes { key value } }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

export const DRAFT_COMMIT_MUTATION = `
  mutation SubscriptionDraftCommit($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
        status
        lines(first: 20) {
          edges {
            node { id productId variantId sellingPlanId }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

export interface BillingPolicyInput {
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  minCycles?: number | null;
  maxCycles?: number | null;
}

export interface DeliveryPolicyInput {
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
}

export interface SubscriptionLineChange {
  lineId: string;
  productVariantId?: string;
  sellingPlanId?: string;
  quantity?: number;
}

export interface UpdateContractParams {
  billingPolicy?: BillingPolicyInput;
  deliveryPolicy?: DeliveryPolicyInput;
  paymentMethodId?: string;
  lines?: SubscriptionLineChange[];
  /**
   * Fit-profile / custom attributes keyed by line id. Replace-not-merge
   * semantics — always send the full attribute array per line. See
   * migration plan Section 3, "custom attributes on SubscriptionLine".
   */
  customAttributesByLineId?: Record<string, Array<{ key: string; value: string }>>;
}

/**
 * Full draft lifecycle: Update → DraftUpdate → (per-line DraftLineUpdate)+ → DraftCommit.
 * Every "edit" to a contract other than pause/activate/cancel/skip goes through
 * this path per the migration plan.
 */
export async function updateContract(
  contractId: string,
  params: UpdateContractParams
) {
  // 1) Open a draft.
  const draftData = await subscriptionsGraphQL<{
    subscriptionContractUpdate: {
      draft: { id: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(CONTRACT_UPDATE_MUTATION, { id: contractId });
  throwOnUserErrors(
    "subscriptionContractUpdate",
    draftData.subscriptionContractUpdate.userErrors
  );
  const draftId = draftData.subscriptionContractUpdate.draft?.id;
  if (!draftId) {
    throw new Error("subscriptionContractUpdate returned no draft id");
  }

  // 2) DraftUpdate for contract-level fields (billingPolicy, deliveryPolicy, paymentMethodId).
  const draftInput: Record<string, unknown> = {};
  if (params.billingPolicy) draftInput.billingPolicy = params.billingPolicy;
  if (params.deliveryPolicy) draftInput.deliveryPolicy = params.deliveryPolicy;
  if (params.paymentMethodId) draftInput.paymentMethodId = params.paymentMethodId;

  if (Object.keys(draftInput).length > 0) {
    const upd = await subscriptionsGraphQL<{
      subscriptionDraftUpdate: {
        draft: { id: string } | null;
        userErrors: ShopifyUserError[];
      };
    }>(DRAFT_UPDATE_MUTATION, { draftId, input: draftInput });
    throwOnUserErrors(
      "subscriptionDraftUpdate",
      upd.subscriptionDraftUpdate.userErrors
    );
  }

  // 3) Per-line DraftLineUpdate for variant / selling-plan / quantity swaps.
  if (params.lines?.length) {
    for (const line of params.lines) {
      const lineInput: Record<string, unknown> = {};
      if (line.productVariantId) lineInput.productVariantId = line.productVariantId;
      if (line.sellingPlanId) lineInput.sellingPlanId = line.sellingPlanId;
      if (typeof line.quantity === "number") lineInput.quantity = line.quantity;

      const attrs = params.customAttributesByLineId?.[line.lineId];
      if (attrs) lineInput.customAttributes = attrs;

      if (Object.keys(lineInput).length === 0) continue;

      const lineRes = await subscriptionsGraphQL<{
        subscriptionDraftLineUpdate: {
          draft: unknown;
          userErrors: ShopifyUserError[];
        };
      }>(DRAFT_LINE_UPDATE_MUTATION, {
        draftId,
        lineId: line.lineId,
        input: lineInput,
      });
      throwOnUserErrors(
        "subscriptionDraftLineUpdate",
        lineRes.subscriptionDraftLineUpdate.userErrors
      );
    }
  }

  // 3b) Custom-attribute-only line updates (no variant/plan/quantity change).
  if (params.customAttributesByLineId) {
    const touched = new Set(params.lines?.map((l) => l.lineId) ?? []);
    for (const [lineId, attrs] of Object.entries(params.customAttributesByLineId)) {
      if (touched.has(lineId)) continue;
      const lineRes = await subscriptionsGraphQL<{
        subscriptionDraftLineUpdate: {
          draft: unknown;
          userErrors: ShopifyUserError[];
        };
      }>(DRAFT_LINE_UPDATE_MUTATION, {
        draftId,
        lineId,
        input: { customAttributes: attrs },
      });
      throwOnUserErrors(
        "subscriptionDraftLineUpdate",
        lineRes.subscriptionDraftLineUpdate.userErrors
      );
    }
  }

  // 4) Commit the draft.
  const commit = await subscriptionsGraphQL<{
    subscriptionDraftCommit: {
      contract: {
        id: string;
        status: string;
        lines: {
          edges: Array<{
            node: {
              id: string;
              productId: string;
              variantId: string;
              sellingPlanId: string | null;
            };
          }>;
        };
      } | null;
      userErrors: ShopifyUserError[];
    };
  }>(DRAFT_COMMIT_MUTATION, { draftId });
  throwOnUserErrors(
    "subscriptionDraftCommit",
    commit.subscriptionDraftCommit.userErrors
  );

  return commit.subscriptionDraftCommit.contract;
}

// ─── Billing-cycle skip / unskip ────────────────────────────────────────────

export const BILLING_CYCLE_SKIP_MUTATION = `
  mutation SubscriptionBillingCycleSkip($billingCycleInput: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleSkip(billingCycleInput: $billingCycleInput) {
      billingCycle { cycleIndex skipped }
      userErrors { field message }
    }
  }
`;

export const BILLING_CYCLE_UNSKIP_MUTATION = `
  mutation SubscriptionBillingCycleUnskip($billingCycleInput: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleUnskip(billingCycleInput: $billingCycleInput) {
      billingCycle { cycleIndex skipped }
      userErrors { field message }
    }
  }
`;

/**
 * Skip the next scheduled billing cycle for a contract. Uses the
 * `nextBillingDate` selector shape from Shopify's SubscriptionBillingCycleInput.
 */
export async function skipNextCycle(contractId: string) {
  const data = await subscriptionsGraphQL<{
    subscriptionBillingCycleSkip: {
      billingCycle: { cycleIndex: number; skipped: boolean } | null;
      userErrors: ShopifyUserError[];
    };
  }>(BILLING_CYCLE_SKIP_MUTATION, {
    billingCycleInput: {
      contractId,
      selector: { index: 1 },
    },
  });
  throwOnUserErrors(
    "subscriptionBillingCycleSkip",
    data.subscriptionBillingCycleSkip.userErrors
  );
  return data.subscriptionBillingCycleSkip.billingCycle;
}

export async function unskipNextCycle(contractId: string) {
  const data = await subscriptionsGraphQL<{
    subscriptionBillingCycleUnskip: {
      billingCycle: { cycleIndex: number; skipped: boolean } | null;
      userErrors: ShopifyUserError[];
    };
  }>(BILLING_CYCLE_UNSKIP_MUTATION, {
    billingCycleInput: {
      contractId,
      selector: { index: 1 },
    },
  });
  throwOnUserErrors(
    "subscriptionBillingCycleUnskip",
    data.subscriptionBillingCycleUnskip.userErrors
  );
  return data.subscriptionBillingCycleUnskip.billingCycle;
}

// ─── Atomic create (used for prepaid → quarterly migration) ─────────────────

export const ATOMIC_CREATE_MUTATION = `
  mutation SubscriptionContractAtomicCreate($input: SubscriptionContractAtomicCreateInput!) {
    subscriptionContractAtomicCreate(input: $input) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export interface AtomicCreateInput {
  customerId: string;
  nextBillingDate: string; // ISO
  currencyCode: string; // e.g. "USD"
  billingPolicy: BillingPolicyInput;
  deliveryPolicy: DeliveryPolicyInput;
  paymentMethodId: string;
  lines: Array<{
    productVariantId: string;
    sellingPlanId?: string;
    quantity: number;
    customAttributes?: Array<{ key: string; value: string }>;
    currentPrice?: number;
  }>;
  deliveryMethod?: unknown;
  contract?: { status?: "ACTIVE" | "PAUSED" };
  idempotencyKey?: string;
}

export async function createContractAtomic(input: AtomicCreateInput) {
  const data = await subscriptionsGraphQL<{
    subscriptionContractAtomicCreate: {
      contract: { id: string; status: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(ATOMIC_CREATE_MUTATION, { input });
  throwOnUserErrors(
    "subscriptionContractAtomicCreate",
    data.subscriptionContractAtomicCreate.userErrors
  );
  return data.subscriptionContractAtomicCreate.contract;
}

// ─── Manual retry after failed charge ────────────────────────────────────────

export const BILLING_ATTEMPT_CREATE_MUTATION = `
  mutation SubscriptionBillingAttemptCreate(
    $contractId: ID!
    $input: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) {
      subscriptionBillingAttempt { id ready errorCode }
      userErrors { field message }
    }
  }
`;

export async function retryBilling(contractId: string) {
  const idempotencyKey = `retry_${contractId}_${Date.now()}`;
  const data = await subscriptionsGraphQL<{
    subscriptionBillingAttemptCreate: {
      subscriptionBillingAttempt: {
        id: string;
        ready: boolean;
        errorCode: string | null;
      } | null;
      userErrors: ShopifyUserError[];
    };
  }>(BILLING_ATTEMPT_CREATE_MUTATION, {
    contractId,
    input: { idempotencyKey },
  });
  throwOnUserErrors(
    "subscriptionBillingAttemptCreate",
    data.subscriptionBillingAttemptCreate.userErrors
  );
  return data.subscriptionBillingAttemptCreate.subscriptionBillingAttempt;
}

// ─── Query: read a contract with everything /account needs ──────────────────

export const GET_CONTRACT_QUERY = `
  query SubscriptionContract($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      nextBillingDate
      customer { id email }
      billingPolicy { interval intervalCount minCycles maxCycles }
      deliveryPolicy { interval intervalCount }
      deliveryMethod {
        __typename
        ... on SubscriptionDeliveryMethodShipping {
          address {
            address1 address2 city province provinceCode country countryCode zip
            firstName lastName phone company
          }
        }
      }
      lines(first: 20) {
        edges {
          node {
            id
            productId
            variantId
            title
            variantTitle
            quantity
            sellingPlanId
            sellingPlanName
            currentPrice { amount currencyCode }
            customAttributes { key value }
          }
        }
      }
      billingCycles(first: 1) {
        edges {
          node {
            cycleIndex
            skipped
            billingAttemptExpectedDate
          }
        }
      }
    }
  }
`;

export interface ContractSummary {
  id: string;
  status: string;
  nextBillingDate: string | null;
  customer: { id: string; email: string | null } | null;
  billingPolicy: {
    interval: string;
    intervalCount: number;
    minCycles: number | null;
    maxCycles: number | null;
  } | null;
  deliveryPolicy: { interval: string; intervalCount: number } | null;
  lines: Array<{
    id: string;
    productId: string;
    variantId: string;
    title: string | null;
    variantTitle: string | null;
    quantity: number;
    sellingPlanId: string | null;
    sellingPlanName: string | null;
    currentPrice: { amount: string; currencyCode: string } | null;
    customAttributes: Array<{ key: string; value: string }>;
  }>;
  nextBillingCycle: {
    cycleIndex: number;
    skipped: boolean;
    billingAttemptExpectedDate: string | null;
  } | null;
  /**
   * Prepaid contracts expose remaining shipments through billingPolicy.maxCycles
   * minus consumed cycles; the full computation lives in the migration script.
   * This scaffold surfaces the raw fields so the caller can compute it.
   */
  prepaidRemaining: number | null;
}

export async function getContract(contractId: string): Promise<ContractSummary | null> {
  const data = await subscriptionsGraphQL<{
    subscriptionContract: {
      id: string;
      status: string;
      nextBillingDate: string | null;
      customer: { id: string; email: string | null } | null;
      billingPolicy: ContractSummary["billingPolicy"];
      deliveryPolicy: ContractSummary["deliveryPolicy"];
      lines: {
        edges: Array<{
          node: {
            id: string;
            productId: string;
            variantId: string;
            title: string | null;
            variantTitle: string | null;
            quantity: number;
            sellingPlanId: string | null;
            sellingPlanName: string | null;
            currentPrice: { amount: string; currencyCode: string } | null;
            customAttributes: Array<{ key: string; value: string }>;
          };
        }>;
      };
      billingCycles: {
        edges: Array<{
          node: {
            cycleIndex: number;
            skipped: boolean;
            billingAttemptExpectedDate: string | null;
          };
        }>;
      };
    } | null;
  }>(GET_CONTRACT_QUERY, { id: contractId });

  const contract = data.subscriptionContract;
  if (!contract) return null;

  const maxCycles = contract.billingPolicy?.maxCycles ?? null;
  const nextCycle = contract.billingCycles.edges[0]?.node ?? null;
  const prepaidRemaining =
    maxCycles !== null && nextCycle
      ? Math.max(0, maxCycles - (nextCycle.cycleIndex - 1))
      : null;

  return {
    id: contract.id,
    status: contract.status,
    nextBillingDate: contract.nextBillingDate,
    customer: contract.customer,
    billingPolicy: contract.billingPolicy,
    deliveryPolicy: contract.deliveryPolicy,
    lines: contract.lines.edges.map((e) => e.node),
    nextBillingCycle: nextCycle,
    prepaidRemaining,
  };
}

// Internal export for tests to intercept the fetch layer.
export const __internal = {
  subscriptionsGraphQL,
};
