# Outfit photography

The six WebP images in this folder are derived from the merchant's actual Shopify catalog photography. Original URLs, the catalog primary-image version, and output paths are recorded in `src/lib/shopProductPhotos.json`.

Processing: edge-connected neutral studio backgrounds changed to white; the shorts' gradient studio background was segmented around the existing model. The vest uses the merchant's transparent alternate product shot rather than its model shot. External whitespace was cropped, then each image was proportionally centered on a white 1000 × 1250 canvas. No garment, model, or product detail was generated. The folded polo and on-model products remain faithful to the available source photographs.

Used by the outfit choices, category thumbnails, outfit summary, and enlarged-photo dialog. If the live primary catalog image changes, the display helper automatically falls back to the new merchant image rather than retaining an outdated prepared photo. Shopify originals, product records, inventory, and checkout data are unchanged.

Original merchant URLs:

- Remy polo: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/RemyPoloWine1.jpg?v=1789572975
- Delta polo: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/1-DeltaPiquePolo-Black_1000x_05457878-5236-4778-a37b-fef27a5d27ae.jpg?v=1789572961
- Commuter pant: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Rhone_100161-212_CommuterPantClassic_Khaki_Resized-1_d39903ba-061d-4c45-96c1-ee63fea35776.jpg?v=1789572760
- Commuter short: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/7_-CommterShort-Khaki_0069_2000x_65189828-ca04-45ae-ab4f-141564e3709e.webp?v=1775579867
- Quarter-zip: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/1gray-comquartzip-onmod_1100x_62076eb5-4857-4c91-b48b-e1bc4465e81c.jpg?v=1789572896
- Fremont vest: https://cdn.shopify.com/s/files/1/0561/0530/4256/files/duckhead-2026-fall-0165-transparent-lowres.png?v=1789572913
