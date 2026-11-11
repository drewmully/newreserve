import { SHOP_CATEGORY_PAGES } from "@/lib/shopCategoryPages";
import { ShopCategoryLanding, categoryMetadata } from "../components/ShopCategoryLanding";

// ISR one hour, same cadence as /shop and the collection pages.
export const revalidate = 3600;

const page = SHOP_CATEGORY_PAGES["vests"];
export const metadata = categoryMetadata(page);

export default function Page() {
  return <ShopCategoryLanding page={page} />;
}
