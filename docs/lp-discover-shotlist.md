# /lp/discover shot list

Every frame that /lp/discover expects. Brief the shoot from this table in one pass.

## Consistency rules that apply to every shot

- **Background**: one of two options only.
  - Forest paper background (Mully brand forest green, matte, seamless roll) for every flat lay and the hero. This matches the existing `/lp/hero/hero-landscape-4x3.webp` reference.
  - Bone paper background (warm off-white, matte, seamless roll) for the unboxing frame only.
- **Lighting**: one soft key light from upper-left, one bounce card camera-right. No harsh shadows. Same setup for every flat lay in the tier row and the What's Inside row so density is the visible variable.
- **Camera**: 50mm equivalent lens. 90 degree overhead for flat lays. High three-quarter (roughly 35 degree tilt) for the hero and the unboxing frame.
- **Styling**: pieces folded consistently, tags either all visible or all hidden across the three tier flat lays, spacing between items roughly equal.
- **File format**: deliver TIFF or 100% JPEG masters + web-ready WebP at the target resolution.
- **Color**: shoot to Mully palette. Reference `--color-forest #1f3a2f`, `--color-bone #f7f3eb`, `--color-charcoal #1a1a1a`.

## Shot list

| # | Section | Subject | Angle | Background | Orientation | Min resolution | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Hero (desktop) | Open Reserve Collection box with full contents styled around it | High three-quarter (35 degree) | Forest paper | Landscape 4:3 | 2400 x 1800 | Same look as `/lp/hero/hero-landscape-4x3.webp`. This may end up being that exact frame; deliver a fresh one if we want tighter product density. |
| 2 | Hero (mobile) | Same scene, reframed tighter | Same 35 degree | Forest paper | Portrait 4:5 | 1600 x 2000 | Vertical crop that keeps the box and 3 to 4 pieces clearly readable at 400px wide. |
| 3 | Tier card: Discovery | 2 pieces, styled | 90 degree overhead | Forest paper | Landscape 4:3 | 1600 x 1200 | One folded polo or 1/4 zip + one accessory (belt or headwear) + Mully hangtag. Minimal negative space. |
| 4 | Tier card: Signature Preview | 3 to 4 pieces, styled | 90 degree overhead | Forest paper | Landscape 4:3 | 1600 x 1200 | One layer + one polo + one bottom or accessory + Mully box lid corner in frame. Visibly denser than shot 3. |
| 5 | Tier card: Reserve Collection | 5 to 6 pieces, styled | 90 degree overhead | Forest paper | Landscape 4:3 | 1600 x 1200 | Two layers + one polo + one bottom + two accessories + open Mully box in frame. Visibly the fullest of the three. |
| 6 | What's Inside: Discovery | Same subject as shot 3, restyled full-frame | 90 degree overhead | Forest paper | Square 1:1 | 2000 x 2000 | Larger presentation of the same 2-piece grouping. Items can be spread more generously than the tier card version. |
| 7 | What's Inside: Signature Preview | Same subject as shot 4, restyled full-frame | 90 degree overhead | Forest paper | Square 1:1 | 2000 x 2000 | Same setup as shot 6, one tier up in density. |
| 8 | What's Inside: Reserve Collection | Same subject as shot 5, restyled full-frame | 90 degree overhead | Forest paper | Square 1:1 | 2000 x 2000 | Same setup, must read as the fullest. |
| 9 | Unboxing moment | Closed Mully box + tissue folded to one side + insert card angled forward | High three-quarter (35 degree) | Bone paper | Landscape 4:3 | 2400 x 1800 | The single non-forest frame on the page. Product photography look, not lifestyle. |

## Notes for post

- Deliver each shot as (a) a full-resolution master and (b) a `.webp` copy at 80% quality sized to the "min resolution" column, named with the exact filenames below.
- Once delivered, drop the WebPs into `public/lp/discover/` and set the corresponding constants in `DiscoverLPClient.tsx`:

| Shot | Filename | Wire-up |
|---|---|---|
| 1 | `public/lp/discover/hero-landscape.webp` | `HERO_LANDSCAPE` constant |
| 2 | `public/lp/discover/hero-portrait.webp` | `HERO_PORTRAIT` constant |
| 3 | `public/lp/discover/tier-discovery.webp` | `TIERS[0].image` |
| 4 | `public/lp/discover/tier-signature.webp` | `TIERS[1].image` |
| 5 | `public/lp/discover/tier-reserve.webp` | `TIERS[2].image` |
| 6 | `public/lp/discover/inside-discovery.webp` | Reuse `TIERS[0].image` if identical, otherwise add a separate field |
| 7 | `public/lp/discover/inside-signature.webp` | Same |
| 8 | `public/lp/discover/inside-reserve.webp` | Same |
| 9 | `public/lp/discover/unboxing.webp` | `UNBOXING_IMAGE` constant |

Until finals are delivered the page renders `PlaceholderFrame` components with the shot direction printed on them at the exact final aspect ratio, so swapping in the WebP is a one-line change with zero layout rework.
