import { useEffect, useState } from "react";
import {
  extend,
  render,
  useExtensionInput,
  BlockStack,
  Button,
  BuyerConsent,
  CalloutBanner,
  Heading,
  Separator,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
} from "@shopify/post-purchase-ui-extensions-react";

const APP_URL = "https://www.mymully.com";

async function post(path, inputData) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${inputData.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ referenceId: inputData.initialPurchase.referenceId }),
  });
  return res.json();
}

extend("Checkout::PostPurchase::ShouldRender", async ({ inputData, storage }) => {
  try {
    const data = await post("/api/post-purchase/offer", inputData);
    if (!data.render) return { render: false };
    await storage.update(data.offer);
    return { render: true };
  } catch {
    return { render: false };
  }
});

render("Checkout::PostPurchase::Render", () => <App />);

const money = (amount) => {
  const n = Number(amount || 0);
  return n === 0 ? "Free" : `$${n.toFixed(2)}`;
};

function App() {
  const { storage, inputData, calculateChangeset, applyChangeset, done } = useExtensionInput();
  const offer = storage.initialData;
  const [total, setTotal] = useState();
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState();
  const [error, setError] = useState();

  useEffect(() => {
    calculateChangeset({ changes: offer.changes })
      .then((r) => setTotal(r.calculatedPurchase?.totalOutstandingSet?.presentmentMoney?.amount))
      .finally(() => setLoading(false));
  }, [calculateChangeset, offer.changes]);

  async function accept() {
    setLoading(true);
    setError(undefined);
    setConsentError(undefined);
    try {
      const { token } = await post("/api/post-purchase/sign-changeset", inputData);
      if (!token) throw new Error("no token");
      const result = await applyChangeset(token, { buyerConsentToSubscriptions: consent });
      if (result.errors?.some((e) => e.code === "buyer_consent_required")) {
        setConsentError("Check the box to join.");
        setLoading(false);
        return;
      }
      if (result.errors?.length) throw new Error(result.errors[0].code);
      done();
    } catch {
      setError("We couldn't add Mully Access. Your order is all set.");
      setLoading(false);
    }
  }

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="Your order is in. One more thing." />
      <BlockStack spacing="tight">
        <Heading>{offer.title}</Heading>
        <TextContainer>
          <Text size="large" emphasized>First month free</Text>
          <Text size="large" subdued> then ${offer.monthlyPrice}/mo</Text>
        </TextContainer>
        <TextBlock>{offer.discountPercent}% off every order</TextBlock>
        <TextBlock>Free shipping on every order</TextBlock>
        <TextBlock>First look at new drops</TextBlock>
      </BlockStack>
      <Separator />
      <Tiles>
        <TextBlock emphasized>Due today</TextBlock>
        <TextContainer alignment="trailing">
          <TextBlock emphasized>{loading && total === undefined ? "" : money(total)}</TextBlock>
        </TextContainer>
      </Tiles>
      <TextBlock size="small" subdued>Renews monthly at ${offer.monthlyPrice}. Cancel anytime.</TextBlock>
      <BuyerConsent policy="subscriptions" checked={consent} onChange={setConsent} error={consentError} />
      {error && <TextBlock appearance="critical">{error}</TextBlock>}
      <BlockStack spacing="tight">
        <Button submit onPress={accept} loading={loading}>Join Mully Access</Button>
        <Button subdued onPress={() => done()} disabled={loading}>No thanks</Button>
      </BlockStack>
    </BlockStack>
  );
}
