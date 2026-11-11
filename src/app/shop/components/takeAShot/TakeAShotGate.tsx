"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ShopSignupPopup } from "../ShopSignupPopup";
import { TakeAShotTrigger } from "./TakeAShotTrigger";
import type { TriggerType } from "@/lib/takeAShot/popupRules";

/** The modal (and its CSS) is a separate chunk, fetched the first time the popup would show. */
const TakeAShotModal = dynamic(() => import("./TakeAShotModal").then((m) => m.TakeAShotModal), { ssr: false });

/**
 * Chooses the shop signup. Flag off (default): ShopSignupPopup, unchanged.
 * Flag on: Take a Shot fully replaces it, with its own trigger, caps,
 * suppression and launcher (TakeAShotTrigger).
 * On preview/dev, ?tas=1 forces Take a Shot on and ?tas=0 off for this tab.
 */
export function TakeAShotGate({ enabled, allowOverride }: { enabled: boolean; allowOverride: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const [opened, setOpened] = useState<{ n: number; trigger: TriggerType }>({ n: 0, trigger: "manual" });
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    if (!allowOverride) return;
    const q = new URLSearchParams(window.location.search).get("tas");
    try {
      if (q === "1" || q === "0") sessionStorage.setItem("mully_tas_override", q);
      const saved = sessionStorage.getItem("mully_tas_override");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL after hydration
      if (saved === "1" || saved === "0") setOverride(saved === "1");
    } catch { if (q === "1" || q === "0") setOverride(q === "1"); }
  }, [allowOverride]);
  const on = override ?? enabled;
  if (!on) return <ShopSignupPopup />;
  return <>
    <TakeAShotTrigger modalOpen={modalOpen} onOpen={(trigger) => { setModalOpen(true); setOpened((o) => ({ n: o.n + 1, trigger })); }} />
    {opened.n > 0 && <TakeAShotModal openSignal={opened.n} trigger={opened.trigger} onClosed={() => setModalOpen(false)} />}
  </>;
}
