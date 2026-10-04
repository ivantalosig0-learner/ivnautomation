/* Mogoba POS: the shop's real menu (transcribed from Mogoba's menu board) and a starting
 * ingredient list with recipes. Ingredient costs, par levels and portion sizes are sensible
 * starting values for the owner to correct in Stock and Menu. They are not supplier quotes. */
(function (M) {
  'use strict';

  const P = (pesos) => Math.round(pesos * 100);
  /* cost per base unit in centavos, from a price per buying unit */
  const per = (pesos, factor) => (pesos * 100) / factor;

  /* id, name, group, unit, buyUnit, buyFactor, buyPrice(₱), par(buy units), reorder(buy units) */
  const ING = [
    ['chicken', 'Chicken, cut (raw)', 'Meat and seafood', 'g', 'kg', 1000, 200, 25, 10],
    ['pork', 'Pork belly', 'Meat and seafood', 'g', 'kg', 1000, 360, 8, 3],
    ['fishcake', 'Fishcake (eomuk)', 'Meat and seafood', 'g', 'kg', 1000, 320, 4, 1.5],
    ['ham', 'Gimbap ham and crabstick', 'Meat and seafood', 'g', 'kg', 1000, 300, 3, 1],
    ['egg', 'Eggs', 'Meat and seafood', 'pc', 'tray (30)', 30, 270, 4, 1.5],
    ['rice', 'Rice', 'Dry goods', 'g', 'kg', 1000, 56, 50, 15],
    ['breading', 'Breading mix', 'Dry goods', 'g', 'kg', 1000, 110, 10, 3],
    ['oil', 'Cooking oil', 'Dry goods', 'ml', 'L', 1000, 125, 20, 6],
    ['tteok', 'Rice cakes (tteok)', 'Dry goods', 'g', 'kg', 1000, 260, 6, 2],
    ['ramyeon', 'Ramyeon packs', 'Dry goods', 'pc', 'pc', 1, 62, 40, 12],
    ['bihon', 'Bihon noodles', 'Dry goods', 'g', 'kg', 1000, 95, 5, 2],
    ['seaweed', 'Gim seaweed sheets', 'Dry goods', 'pc', 'pack (50)', 50, 300, 4, 1.2],
    ['fries', 'Frozen fries', 'Dry goods', 'g', 'kg', 1000, 190, 10, 3],
    ['veg', 'Gimbap vegetables', 'Produce and prepped', 'g', 'kg', 1000, 120, 5, 1.5],
    ['mixveg', 'Mixed vegetables', 'Produce and prepped', 'g', 'kg', 1000, 110, 4, 1.5],
    ['kimchi', 'Kimchi', 'Produce and prepped', 'g', 'kg', 1000, 180, 10, 3],
    ['cukimchi', 'Cucumber kimchi', 'Produce and prepped', 'g', 'kg', 1000, 150, 4, 1.5],
    ['danmuji', 'Pickled radish (danmuji)', 'Produce and prepped', 'g', 'kg', 1000, 200, 4, 1.5],
    ['gochujang', 'Gochujang sauce', 'Sauces and dairy', 'ml', 'L', 1000, 280, 5, 1.5],
    ['honeybutter', 'Honey butter glaze', 'Sauces and dairy', 'ml', 'L', 1000, 320, 3, 1],
    ['spicyglaze', 'Spicy yangnyeom glaze', 'Sauces and dairy', 'ml', 'L', 1000, 300, 3, 1],
    ['cheesepowder', 'Prinkle cheese powder', 'Sauces and dairy', 'g', 'kg', 1000, 650, 2, 0.6],
    ['mozzarella', 'Mozzarella', 'Sauces and dairy', 'g', 'kg', 1000, 520, 3, 1],
    ['milk', 'Fresh milk', 'Sauces and dairy', 'ml', 'L', 1000, 95, 12, 4],
    ['condensed', 'Condensed milk', 'Sauces and dairy', 'ml', 'L', 1000, 250, 3, 1],
    ['teabase', 'Black tea base', 'Drink bar', 'ml', 'L', 1000, 15, 8, 3],
    ['creamer', 'Non-dairy creamer', 'Drink bar', 'g', 'kg', 1000, 180, 5, 1.5],
    ['pearls', 'Tapioca pearls', 'Drink bar', 'g', 'kg', 1000, 90, 6, 2],
    ['espresso', 'Espresso beans', 'Drink bar', 'g', 'kg', 1000, 800, 3, 1],
    ['matchapw', 'Matcha powder', 'Drink bar', 'g', 'kg', 1000, 1100, 1.5, 0.5],
    ['okinawa', 'Okinawa brown sugar syrup', 'Drink bar', 'ml', 'L', 1000, 220, 2, 0.6],
    ['taro', 'Taro powder', 'Drink bar', 'g', 'kg', 1000, 350, 1.5, 0.5],
    ['choco', 'Chocolate powder', 'Drink bar', 'g', 'kg', 1000, 350, 1.5, 0.5],
    ['cookies', 'Cookies and cream powder', 'Drink bar', 'g', 'kg', 1000, 350, 1.5, 0.5],
    ['redvelvet', 'Red velvet powder', 'Drink bar', 'g', 'kg', 1000, 350, 1.5, 0.5],
    ['s_wintermelon', 'Wintermelon syrup', 'Drink bar', 'ml', 'L', 1000, 220, 3, 1],
    ['s_strawberry', 'Strawberry syrup', 'Drink bar', 'ml', 'L', 1000, 220, 2, 0.6],
    ['s_lychee', 'Lychee syrup', 'Drink bar', 'ml', 'L', 1000, 220, 2, 0.6],
    ['s_mango', 'Mango syrup', 'Drink bar', 'ml', 'L', 1000, 220, 2, 0.6],
    ['s_blueberry', 'Blueberry syrup', 'Drink bar', 'ml', 'L', 1000, 220, 1.5, 0.5],
    ['s_greenapple', 'Green apple syrup', 'Drink bar', 'ml', 'L', 1000, 220, 1.5, 0.5],
    ['s_lemon', 'Lemon syrup', 'Drink bar', 'ml', 'L', 1000, 220, 1.5, 0.5],
    ['s_passion', 'Passion fruit syrup', 'Drink bar', 'ml', 'L', 1000, 220, 1.5, 0.5],
    ['s_watermelon', 'Watermelon syrup', 'Drink bar', 'ml', 'L', 1000, 220, 1.5, 0.5],
    ['soda', 'Soda water', 'Drink bar', 'ml', 'L', 1000, 45, 24, 8],
    ['coke', 'Coke or Sprite (bottle)', 'Ready-to-sell', 'pc', 'case (24)', 24, 480, 2, 0.5],
    ['water', 'Bottled water', 'Ready-to-sell', 'pc', 'case (24)', 24, 240, 2, 0.5],
    ['cup_s', 'Cup + lid, small', 'Packaging', 'pc', 'sleeve (50)', 50, 150, 6, 2],
    ['cup_m', 'Cup + lid, medium', 'Packaging', 'pc', 'sleeve (50)', 50, 175, 8, 2],
    ['cup_l', 'Cup + lid, large', 'Packaging', 'pc', 'sleeve (50)', 50, 200, 6, 2],
    ['box_dosirak', 'Dosirak box', 'Packaging', 'pc', 'pack (50)', 50, 250, 4, 1.2],
    ['box_chicken', 'Chicken box', 'Packaging', 'pc', 'pack (25)', 25, 300, 2.4, 0.8],
    ['cup_snack', 'Snack cup (fries, col-pop)', 'Packaging', 'pc', 'pack (50)', 50, 200, 3, 1],
    ['tub', 'Sides tub, 500 ml', 'Packaging', 'pc', 'pack (25)', 25, 200, 3.2, 1],
    ['bilao', 'Bilao tray + cover', 'Packaging', 'pc', 'pc', 1, 45, 15, 5],
  ];

  /* Shelf life in days once received, sealed and stored right (chill 5°C or colder, frozen
   * -18°C or colder). Aparri runs hot, so these sit at the low end of safe ranges. A shorter
   * label date always wins: change it on receiving. 0 means no expiry tracking. */
  const SHELF = {
    chicken: 2, pork: 3, fishcake: 180, ham: 14, egg: 21, rice: 180, breading: 180, oil: 365, tteok: 5, ramyeon: 180,
    bihon: 365, seaweed: 180, fries: 365, veg: 3, mixveg: 3, kimchi: 90, cukimchi: 5, danmuji: 90, gochujang: 7,
    honeybutter: 5, spicyglaze: 7, cheesepowder: 180, mozzarella: 21, milk: 7, condensed: 180, teabase: 1, creamer: 180,
    pearls: 180, espresso: 90, matchapw: 90, okinawa: 3, taro: 180, choco: 180, cookies: 180, redvelvet: 180,
    s_wintermelon: 90, s_strawberry: 90, s_lychee: 90, s_mango: 90, s_blueberry: 90, s_greenapple: 90, s_lemon: 90,
    s_passion: 90, s_watermelon: 90, soda: 180, coke: 180, water: 365,
  };

  function ingredients(stocked) {
    return ING.map(([id, name, group, unit, buyUnit, buyFactor, buyPrice, par, reorder], i) => ({
      id,
      name,
      group,
      unit,
      buyUnit,
      buyFactor,
      cost: per(buyPrice, buyFactor),
      par: par * buyFactor,
      reorder: reorder * buyFactor,
      onHand: stocked ? par * buyFactor : 0,
      lots: [],
      shelfLife: SHELF[id] || 0,
      supplier: '',
      active: true,
      sort: i,
      updatedAt: Date.now(),
    }));
  }

  const CATS = [
    ['dosirak', 'Dosirak', '도시락', 'red'],
    ['chicken', 'Chicken', '치킨', 'gold'],
    ['street', 'Street food', '분식', 'yellow'],
    ['sides', 'Sides', '반찬', 'green'],
    ['addons', 'Add-ons', '추가', 'gold'],
    ['bilao', 'Bilao trays', '파티', 'red'],
    ['milktea', 'Milk tea', '밀크티', 'gold'],
    ['fruittea', 'Fruit tea', '과일차', 'green'],
    ['matcha', 'Matcha', '말차', 'green'],
    ['soda', 'Fruit soda', '에이드', 'yellow'],
    ['coffee', 'Iced coffee', '커피', 'gold'],
    ['softdrinks', 'Soft drinks', '음료', 'red'],
  ].map(([id, name, ko, tone], i) => ({ id, name, ko, tone, kind: i >= 6 ? 'drink' : 'food', sort: i, updatedAt: Date.now() }));

  const r = (ing, qty) => ({ ing, qty });
  const MODS = [
    {
      id: 'addon',
      name: 'Add-ons',
      options: [
        { id: 'rice', name: 'Rice', price: P(20), recipe: [r('rice', 150)] },
        { id: 'kimchi', name: 'Kimchi', price: P(20), recipe: [r('kimchi', 50)] },
        { id: 'radish', name: 'Pickled radish', price: P(20), recipe: [r('danmuji', 50)] },
        { id: 'fishcake', name: 'Fishcake', price: P(20), recipe: [r('fishcake', 50)] },
        { id: 'mozz', name: 'Mozzarella cheese', price: P(20), recipe: [r('mozzarella', 30)] },
      ],
    },
  ];

  const FLAVOURS = [
    ['classic', 'Classic', []],
    ['honey', 'Honey Butter', [['honeybutter', 1]]],
    ['spicy', 'Spicy', [['spicyglaze', 1]]],
    ['prinkle', 'Prinkle', [['cheesepowder', 1 / 3]]],
  ];
  const flav = (prices, sauceAmt) =>
    FLAVOURS.map(([id, name, sauce], i) => ({ id, name, price: P(prices[i]), recipe: sauce.map(([ing, k]) => r(ing, Math.round(sauceAmt * k))) }));

  const SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];
  const CUP = ['cup_s', 'cup_m', 'cup_l'];
  /* drink(prices[3], perSize(i) -> recipe rows) */
  const sized = (prices, rows) => SIZES.map(([id, name], i) => ({ id, name, price: P(prices[i]), recipe: [r(CUP[i], 1)].concat(rows(i)) }));
  const S = (a, b, c) => (i) => [a, b, c][i];

  const items = [];
  let sort = 0;
  const add = (o) => items.push(Object.assign({ variants: null, addons: [], recipe: [], img: '', ko: '', active: true, sort: sort++, updatedAt: Date.now() }, o));

  // Dosirak
  add({ id: 'chicken-dosirak', cat: 'dosirak', name: 'Chicken Dosirak', ko: '치킨 도시락', img: 'honeybutter', price: P(120), variantLabel: 'Flavour', variants: flav([120, 120, 120, 120], 25), addons: ['addon'], recipe: [r('chicken', 110), r('breading', 20), r('oil', 15), r('rice', 180), r('danmuji', 15), r('box_dosirak', 1)] });
  add({ id: 'pork-dosirak', cat: 'dosirak', name: 'Pork Dosirak', ko: '돼지 도시락', img: 'dosirak', price: P(120), addons: ['addon'], recipe: [r('pork', 100), r('gochujang', 20), r('oil', 10), r('rice', 180), r('kimchi', 30), r('box_dosirak', 1)] });
  add({ id: 'gimbap-dosirak', cat: 'dosirak', name: 'Gimbap Dosirak', ko: '김밥 도시락', img: 'gimbap-dosirak', price: P(205), badge: 'Best seller', addons: ['addon'], recipe: [r('seaweed', 2), r('rice', 300), r('egg', 1), r('veg', 60), r('ham', 40), r('danmuji', 25), r('kimchi', 30), r('box_dosirak', 1)] });
  // Chicken
  add({ id: 'chicken-box', cat: 'chicken', name: 'Chicken in a Box', ko: '치킨', img: 'classic', price: P(490), variantLabel: 'Flavour', variants: flav([490, 500, 500, 500], 100), addons: ['addon'], recipe: [r('chicken', 800), r('breading', 100), r('oil', 100), r('box_chicken', 1)] });
  // Street food
  add({ id: 'fries', cat: 'street', name: 'Fries', ko: '감자튀김', price: P(70), recipe: [r('fries', 150), r('oil', 30), r('cup_snack', 1)] });
  add({ id: 'chicken-fries', cat: 'street', name: 'Chicken and Fries', ko: '치킨 감자튀김', price: P(120), recipe: [r('chicken', 100), r('breading', 20), r('fries', 100), r('oil', 35), r('cup_snack', 1)] });
  add({ id: 'chicken-pops', cat: 'street', name: 'Chicken Pops', ko: '치킨팝', img: 'prinkle', price: P(120), recipe: [r('chicken', 140), r('breading', 25), r('oil', 25), r('cup_snack', 1)] });
  add({ id: 'col-pop', cat: 'street', name: 'Col-Pop', ko: '콜팝', price: P(120), recipe: [r('chicken', 110), r('breading', 20), r('oil', 20), r('cup_snack', 1)] });
  add({ id: 'ramyeon', cat: 'street', name: 'Ramyeon', ko: '라면', img: 'ramyeon', price: P(120), addons: ['addon'], recipe: [r('ramyeon', 1), r('egg', 1), r('kimchi', 30)] });
  add({ id: 'gimbap', cat: 'street', name: 'Gimbap', ko: '김밥', img: 'gimbap', price: P(130), addons: ['addon'], recipe: [r('seaweed', 1), r('rice', 160), r('egg', 1), r('veg', 40), r('ham', 30), r('danmuji', 20)] });
  add({ id: 'tteokbokki', cat: 'street', name: 'Tteokbokki', ko: '떡볶이', img: 'tteokbokki', price: P(150), addons: ['addon'], recipe: [r('tteok', 220), r('fishcake', 50), r('gochujang', 80)] });
  // Sides (tubs)
  add({ id: 'kimchi-tub', cat: 'sides', name: 'Kimchi', ko: '김치', img: 'kimchi', price: P(190), unitNote: 'tub', recipe: [r('kimchi', 500), r('tub', 1)] });
  add({ id: 'cucumber-kimchi', cat: 'sides', name: 'Cucumber Kimchi', ko: '오이김치', price: P(150), unitNote: 'tub', recipe: [r('cukimchi', 450), r('tub', 1)] });
  add({ id: 'pickled-radish', cat: 'sides', name: 'Pickled Radish', ko: '단무지', price: P(150), unitNote: 'tub', recipe: [r('danmuji', 450), r('tub', 1)] });
  add({ id: 'fishcake-tub', cat: 'sides', name: 'Stir-fried Fishcake', ko: '어묵볶음', img: 'fishcake', price: P(150), unitNote: 'tub', recipe: [r('fishcake', 350), r('gochujang', 30), r('oil', 20), r('tub', 1)] });
  // Add-ons sold on their own
  add({ id: 'extra-rice', cat: 'addons', name: 'Rice', ko: '밥', price: P(20), recipe: [r('rice', 150)] });
  add({ id: 'extra-kimchi', cat: 'addons', name: 'Kimchi or Radish', ko: '김치', price: P(20), variantLabel: 'Choose', variants: [{ id: 'kimchi', name: 'Kimchi', price: P(20), recipe: [r('kimchi', 50)] }, { id: 'radish', name: 'Pickled radish', price: P(20), recipe: [r('danmuji', 50)] }] });
  add({ id: 'extra-fishcake', cat: 'addons', name: 'Fishcake', ko: '어묵', price: P(20), recipe: [r('fishcake', 50)] });
  add({ id: 'extra-mozz', cat: 'addons', name: 'Mozzarella Cheese', ko: '모짜렐라', price: P(20), recipe: [r('mozzarella', 30)] });
  // Bilao
  const gimbapRolls = (n) => [r('seaweed', n), r('rice', 160 * n), r('egg', n), r('veg', 40 * n), r('ham', 30 * n), r('danmuji', 20 * n), r('bilao', 1)];
  add({ id: 'bilao-bihon', cat: 'bilao', name: 'Bihon Bilao', ko: '', img: 'bihon', price: P(750), recipe: [r('bihon', 1000), r('pork', 300), r('mixveg', 600), r('oil', 60), r('bilao', 1)] });
  add({ id: 'bilao-gimbap-s', cat: 'bilao', name: 'Gimbap Bilao, small', ko: '김밥', img: 'gimbap', price: P(600), recipe: gimbapRolls(5) });
  add({ id: 'bilao-gimbap-m', cat: 'bilao', name: 'Gimbap Bilao, medium', ko: '김밥', img: 'gimbap-dosirak', price: P(800), recipe: gimbapRolls(7) });
  add({ id: 'bilao-suyuk', cat: 'bilao', name: 'Suyuk Bilao', ko: '수육', img: 'suyuk', price: P(800), unitNote: 'boiled pork', recipe: [r('pork', 900), r('kimchi', 300), r('bilao', 1)] });
  add({ id: 'bilao-chicken', cat: 'bilao', name: 'Chicken Bilao', ko: '치킨', img: 'yangnyeom', price: P(1000), recipe: [r('chicken', 1600), r('breading', 200), r('oil', 200), r('spicyglaze', 120), r('bilao', 1)] });
  // Drinks
  const milkBase = (i) => [r('teabase', S(150, 200, 250)(i)), r('creamer', S(15, 20, 25)(i)), r('pearls', S(30, 40, 50)(i))];
  const MT = [
    ['wintermelon', 'Wintermelon', 's_wintermelon', [20, 25, 30]],
    ['okinawa', 'Okinawa', 'okinawa', [20, 25, 30]],
    ['matcha', 'Matcha', 'matchapw', [4, 5, 6]],
    ['taro', 'Taro', 'taro', [15, 20, 25]],
    ['chocolate', 'Chocolate', 'choco', [15, 20, 25]],
    ['cookies', 'Cookies and Cream', 'cookies', [15, 20, 25]],
    ['redvelvet', 'Red Velvet', 'redvelvet', [15, 20, 25]],
  ];
  for (const [id, name, ing, q] of MT) add({ id: 'mt-' + id, cat: 'milktea', name, ko: '밀크티', img: 'milktea', price: P(40), variantLabel: 'Size', variants: sized([40, 50, 60], (i) => milkBase(i).concat([r(ing, q[i])])) });
  const FT = [['wintermelon', 'Wintermelon', 's_wintermelon'], ['strawberry', 'Strawberry', 's_strawberry'], ['lychee', 'Lychee', 's_lychee'], ['mango', 'Mango', 's_mango']];
  for (const [id, name, ing] of FT) add({ id: 'ft-' + id, cat: 'fruittea', name, ko: '과일차', price: P(40), variantLabel: 'Size', variants: sized([40, 50, 60], (i) => [r('teabase', S(180, 240, 300)(i)), r(ing, S(20, 25, 30)(i))]) });
  const milk = (i) => r('milk', S(120, 150, 180)(i));
  const mat = (i) => r('matchapw', S(4, 5, 6)(i));
  add({ id: 'mc-dirty', cat: 'matcha', name: 'Dirty Matcha', ko: '말차', price: P(60), variantLabel: 'Size', variants: sized([60, 70, 80], (i) => [mat(i), milk(i), r('espresso', S(7, 7, 14)(i))]) });
  add({ id: 'mc-latte', cat: 'matcha', name: 'Matcha Latte', ko: '말차', price: P(60), variantLabel: 'Size', variants: sized([60, 70, 80], (i) => [mat(i), milk(i)]) });
  add({ id: 'mc-strawberry', cat: 'matcha', name: 'Strawberry Matcha', ko: '말차', price: P(60), variantLabel: 'Size', variants: sized([60, 70, 80], (i) => [mat(i), milk(i), r('s_strawberry', S(20, 25, 30)(i))]) });
  const FS = [['blueberry', 'Blueberry', 's_blueberry'], ['greenapple', 'Green Apple', 's_greenapple'], ['lemon', 'Lemon', 's_lemon'], ['passion', 'Passion Fruit', 's_passion'], ['watermelon', 'Watermelon', 's_watermelon']];
  for (const [id, name, ing] of FS) add({ id: 'fs-' + id, cat: 'soda', name, ko: '에이드', price: P(50), variantLabel: 'Size', variants: sized([50, 60, 70], (i) => [r('soda', S(180, 240, 300)(i)), r(ing, S(20, 25, 30)(i))]) });
  const shot = (i) => r('espresso', S(14, 14, 20)(i));
  add({ id: 'cf-americano', cat: 'coffee', name: 'Americano', ko: '커피', price: P(40), variantLabel: 'Size', variants: sized([40, 50, 60], (i) => [shot(i)]) });
  add({ id: 'cf-latte', cat: 'coffee', name: 'Café Latte', ko: '커피', price: P(50), variantLabel: 'Size', variants: sized([50, 60, 70], (i) => [shot(i), milk(i)]) });
  add({ id: 'cf-macchiato', cat: 'coffee', name: 'Café Macchiato', ko: '커피', price: P(50), variantLabel: 'Size', variants: sized([50, 60, 70], (i) => [shot(i), milk(i)]) });
  add({ id: 'cf-cappuccino', cat: 'coffee', name: 'Cappuccino', ko: '커피', price: P(50), variantLabel: 'Size', variants: sized([50, 60, 70], (i) => [shot(i), milk(i)]) });
  add({ id: 'cf-spanish', cat: 'coffee', name: 'Spanish Latte', ko: '커피', price: P(50), variantLabel: 'Size', variants: sized([50, 60, 70], (i) => [shot(i), milk(i), r('condensed', S(20, 25, 30)(i))]) });
  add({ id: 'sd-coke', cat: 'softdrinks', name: 'Coke or Sprite', ko: '음료', price: P(35), unitNote: 'Price not on the menu board', variantLabel: 'Choose', variants: [{ id: 'coke', name: 'Coke', price: P(35), recipe: [r('coke', 1)] }, { id: 'sprite', name: 'Sprite', price: P(35), recipe: [r('coke', 1)] }] });
  add({ id: 'sd-water', cat: 'softdrinks', name: 'Bottled Water', ko: '물', price: P(20), unitNote: 'Price not on the menu board', recipe: [r('water', 1)] });

  /* Price shown on a tile: single price or a range across variants. */
  function priceRange(item) {
    if (!item.variants || !item.variants.length) return [item.price, item.price];
    const ps = item.variants.map((v) => v.price);
    return [Math.min(...ps), Math.max(...ps)];
  }

  const NOTES = {
    food: ['Extra spicy', 'Not spicy', 'Sauce on the side', 'No kimchi', 'Cut in half'],
    drink: ['Less sugar', 'No sugar', 'Less ice', 'No ice', 'No pearls'],
  };

  const SETTINGS = () => ({
    business: {
      name: 'Mogoba Korean Food House',
      address: 'Rizal St, Aparri, Cagayan',
      phone: '0936 575 7278',
      tin: '',
      vat: false,
      receiptTitle: 'ORDER SLIP',
      footer: 'This is not an official receipt or invoice.\nGamsahamnida! Come back soon.',
    },
    device: { name: 'Counter 1', prefix: 'A' },
    sales: { blockOutOfStock: false, autoLockMin: 10, tableForDineIn: false, dailyTarget: 1500000, foodCostTarget: 40 },
    print: { paper: 58, autoReceipt: false, kitchenTicket: false },
    ui: { theme: 'dark', glass: 'full' },
    sync: { url: '', key: '', enabled: false },
    online: {
      enabled: false,
      mode: 'demo',
      url: '',
      key: '',
      accepting: true,
      prepMinutes: 20,
      hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '20:00' })),
      pickup: true,
      delivery: { enabled: true, fee: 5000, minOrder: 30000, area: 'Aparri town proper' },
      payments: {
        gcash: { enabled: true, accountName: '', number: '', qr: '' },
        maya: { enabled: true, accountName: '', number: '', qr: '' },
        cash: { enabled: true, maxTotal: 100000 },
      },
      pausedUntil: 0,
    },
  });

  M.seed = { ingredients, CATS, MODS, items, priceRange, NOTES, SETTINGS, P };
})((window.M = window.M || {}));
