import ShopPage from "./shop/page";
import ShopLayout from "./shop/layout";
export { metadata } from "./shop/page";
export const revalidate = 3600;

export default async function Home() {
  return <ShopLayout>{await ShopPage()}</ShopLayout>;
}
