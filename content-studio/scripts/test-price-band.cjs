#!/usr/bin/env node
const assert = require("assert");
const {
  itemPriceOk,
  isHighTicketItem,
  resolvePriceLimits,
} = require("./lib/price-band.cjs");

const gadgetOps = {
  productRules: {
    priceMinYen: 300,
    priceMaxYen: 20000,
    highTicket: {
      priceMaxYen: 100000,
      categories: ["power"],
      namePatterns: ["ソーラー", "ポータブル電源", "防災"],
    },
  },
};

assert.equal(
  itemPriceOk({ priceRange: "200円", category: "desk" }, gadgetOps),
  false,
  "floor rejects junk",
);
assert.equal(
  itemPriceOk({ priceRange: "8,000円", category: "desk" }, gadgetOps),
  true,
  "normal mid ok",
);
assert.equal(
  itemPriceOk({ priceRange: "25,000円", category: "desk" }, gadgetOps),
  false,
  "normal over ceiling",
);
assert.equal(
  itemPriceOk(
    { priceRange: "85,000円", category: "power", name: "USB充電器" },
    gadgetOps,
  ),
  true,
  "power category high ticket to 10万",
);
assert.equal(
  itemPriceOk(
    {
      priceRange: "98,000円",
      category: "other",
      name: "ポータブル電源 ソーラー対応",
    },
    gadgetOps,
  ),
  true,
  "name pattern high ticket",
);
assert.equal(
  itemPriceOk(
    {
      priceRange: "55,000円",
      category: "table",
      name: "季節の銘品",
      labels: { limited: true },
    },
    gadgetOps,
  ),
  true,
  "limited scarce not blocked by price",
);
assert.equal(
  isHighTicketItem({ labels: { stockpile: true }, category: "other" }, gadgetOps),
  true,
);
assert.equal(
  resolvePriceLimits(
    { priceRange: "1,000円", category: "cable" },
    gadgetOps,
  ).maxYen,
  20000,
);

console.log("test-price-band: OK");
