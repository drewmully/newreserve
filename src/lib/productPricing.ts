export interface TieredPriceSource {
  price: number;
  reservePrice: number;
}

export interface TieredPriceDisplay {
  activePrice: number;
  compareAtPrice: number | null;
  memberPrice: number | null;
  badgeLabel: string | null;
}

export function resolveTieredPrice(
  source: TieredPriceSource,
  isPaid: boolean
): number {
  return isPaid ? source.reservePrice : source.price;
}

export function resolveTieredPriceDisplay(
  source: TieredPriceSource,
  isPaid: boolean
): TieredPriceDisplay {
  const hasMemberSavings = source.price !== source.reservePrice;

  if (isPaid) {
    return {
      activePrice: source.reservePrice,
      compareAtPrice: hasMemberSavings ? source.price : null,
      memberPrice: null,
      badgeLabel: hasMemberSavings ? "Member Price" : null,
    };
  }

  return {
    activePrice: source.price,
    compareAtPrice: null,
    memberPrice: hasMemberSavings ? source.reservePrice : null,
    badgeLabel: hasMemberSavings ? "Member Price" : null,
  };
}
