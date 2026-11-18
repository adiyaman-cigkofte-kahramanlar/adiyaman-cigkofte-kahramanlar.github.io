(function () {
  "use strict";

  const logic = window.KadirUstaLogic;
  if (!logic) {
    throw new Error("KadirUstaLogic modülü yüklenemedi.");
  }

  const STORAGE_ADDRESS_KEY = "kadir_usta_last_address_v1";
  const STORAGE_ADDR_CACHE_KEY = "kadir_usta_addr_geo_cache_v1";
  const DEFAULT_WA_BTN_LABEL = "💬 WHATSAPP İLE SİPARİŞİ GÖNDER";
  const CATEGORY_ICONS = {
    "Kampanyalar": "🎯",
    "Çiğ Köfte Dürümler": "🌯",
    "Çiğ Köfte Porsiyonlar": "🍱",
    "Tatlılar & Yan Lezzetler": "🍮",
    "Koz Ağaç Ürünleri": "🍪",
    "İçecekler": "🥤",
  };

  const state = {
    menuData: null,
    activeCategory: "ALL",
    cart: [],
    selectedPaymentCode: null,
    address: "",
    note: "",
    gpsCoords: null,
    gpsCheck: null,
    addressCheck: null,
    addressVerifyPending: false,
    fulfillmentType: "DELIVERY",
    durumDraft: null,
    portionDraft: null,
    toastTimer: null,
  };

  const $ = (id) => document.getElementById(id);

  function readSavedAddress() {
    try {
      return window.localStorage.getItem(STORAGE_ADDRESS_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveAddressToStorage(value) {
    try {
      window.localStorage.setItem(STORAGE_ADDRESS_KEY, value);
    } catch {
      // Gizli sekme veya devre dışı depolama sessizce geçilir.
    }
  }

  function showToast(message) {
    const banner = $("toastBanner");
    if (!banner) return;
    banner.textContent = message;
    banner.classList.remove("hidden");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      banner.classList.add("hidden");
    }, 2600);
  }

  function getActiveRules() {
    return state.menuData?.shop?.rules || {
      walkSpeedMetersPerMin: 40,
      maxWalkMetersGreen: 400,
      maxWalkMetersYellow: 480,
      minOrderAmountTl: 75,
      maxGarnishCount: 6,
      doritosExtraPriceTl: 20,
    };
  }

  function getActiveProducts() {
    const list = state.menuData?.products;
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p.isActive !== false);
  }

  function getActiveCategories() {
    const products = getActiveProducts();
    const present = new Set(products.map((p) => p.category));
    const configured = state.menuData?.categories;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.filter((c) => present.has(c));
    }
    return [...present];
  }

  function buildCartLineKey(product, garnishes, sauces, hasDoritos) {
    const g = [...(garnishes || [])].sort().join("|");
    const s = [...(sauces || [])].sort().join("|");
    return `${product.code}::g=${g}::s=${s}::d=${hasDoritos ? 1 : 0}`;
  }

  function addItemToCart({ product, quantity, garnishes, sauces, hasDoritos }) {
    const openStatus = logic.isShopCurrentlyOpen(state.menuData);
    if (!openStatus.open) {
      showToast(openStatus.message || "Şubemiz şu anda paket servise kapalıdır.");
      return;
    }
    const rules = getActiveRules();
    const unitPriceTl = logic.computeItemUnitPrice(
      product,
      Boolean(hasDoritos),
      rules.doritosExtraPriceTl
    );
    const key = buildCartLineKey(product, garnishes, sauces, hasDoritos);
    const existing = state.cart.find((c) => c.key === key);

    if (existing) {
      existing.quantity = Math.min(50, existing.quantity + quantity);
    } else {
      state.cart.push({
        key,
        code: product.code,
        name: product.name,
        category: product.category,
        weightInfo: product.weightInfo || "",
        unitPriceTl,
        quantity,
        garnishes: [...(garnishes || [])],
        sauces: [...(sauces || [])],
        hasDoritos: Boolean(product.requiresGarnish && hasDoritos),
        requiresGarnish: Boolean(product.requiresGarnish),
        isMainFood: product.isMainFood !== false,
      });
    }

    renderAllMenuSections();
    renderFloatingCartBar();
    showToast(`${product.name} sepete eklendi`);
  }

  function updateSimpleProductDelta(productCode, delta) {
    const matchingLines = state.cart.filter((item) => item.code === productCode);
    if (matchingLines.length === 0 && delta > 0) {
      const product = getActiveProducts().find((p) => p.code === productCode);
      if (product) {
        addItemToCart({
          product,
          quantity: 1,
          garnishes: [],
          sauces: [],
          hasDoritos: false,
        });
      }
      return;
    }

    if (matchingLines.length > 0) {
      const target = matchingLines[matchingLines.length - 1];
      target.quantity += delta;
      if (target.quantity <= 0) {
        state.cart = state.cart.filter((item) => item.key !== target.key);
      }
      renderAllMenuSections();
      renderFloatingCartBar();
    }
  }

  function renderHeader() {
    const shop = state.menuData.shop;
    const rules = getActiveRules();

    $("shopShortName").textContent =
      shop.shortName || "Meşhur Adıyaman Çiğ Köftecisi Kadir Usta";
    $("shopBranchName").textContent = shop.branchName || "Kahramanlar Şubesi";
    const operatorEl = $("shopOperatorText");
    if (operatorEl) {
      operatorEl.textContent = `İşletmeci: ${shop.operatorName || "Sedat Evcin"}`;
    }
    $("shopAddressText").querySelector("span").textContent = shop.address;
    $("minOrderBadge").textContent = `Min. Paket: ${rules.minOrderAmountTl} TL`;

    const openStatus = logic.isShopCurrentlyOpen(state.menuData);
    const hoursBadge = $("businessHoursBadge");
    if (hoursBadge) {
      hoursBadge.textContent = `🕒 ${openStatus.scheduleLabel}`;
    }

    const badge = $("shopStatusBadge");
    const closedBanner = $("shopClosedBanner");
    const closedBannerText = $("shopClosedBannerText");
    if (!openStatus.open) {
      badge.className =
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-950/70 border border-red-300/50 px-3 py-1 text-xs font-bold text-red-100";
      badge.innerHTML = `<span class="h-2 w-2 rounded-full bg-red-300"></span>${openStatus.reason === "OUTSIDE_HOURS" ? "Mesai Dışı" : "Şu An Kapalı"}`;
      if (closedBannerText && openStatus.message) {
        closedBannerText.textContent = `🌙 ${openStatus.message}`;
      }
      closedBanner.classList.remove("hidden");
    } else {
      badge.className =
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-300/40 px-3 py-1 text-xs font-bold text-emerald-50";
      badge.innerHTML = `<span class="h-2 w-2 rounded-full bg-emerald-300 animate-pulse"></span>Paket Açık`;
      closedBanner.classList.add("hidden");
    }
  }

  function renderCategoryTabs() {
    const container = $("categoryTabs");
    container.innerHTML = "";
    const categories = getActiveCategories();
    const tabs = [{ key: "ALL", label: "🍽️ Tümü" }].concat(
      categories.map((cat) => ({
        key: cat,
        label: `${CATEGORY_ICONS[cat] || "📦"} ${cat}`,
      }))
    );

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      const isActive = state.activeCategory === tab.key;
      const isCampaign = tab.key === "Kampanyalar";

      if (isActive) {
        btn.className =
          "shrink-0 rounded-full bg-rose-800 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs cursor-pointer transition";
      } else if (isCampaign) {
        btn.className =
          "shrink-0 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3.5 py-2 text-xs font-extrabold text-amber-950 cursor-pointer transition";
      } else {
        btn.className =
          "shrink-0 rounded-full border border-stone-300 bg-white hover:bg-stone-100 px-3.5 py-2 text-xs font-bold text-gray-800 cursor-pointer transition";
      }

      btn.textContent = tab.label;
      btn.addEventListener("click", () => {
        state.activeCategory = tab.key;
        renderCategoryTabs();
        renderAllMenuSections();
      });
      container.appendChild(btn);
    }
  }

  function renderProductCard(product) {
    const card = document.createElement("article");
    card.className =
      "rounded-2xl border border-stone-200 bg-white p-4 shadow-xs transition hover:border-rose-200 flex items-center justify-between gap-3";

    const infoCol = document.createElement("div");
    infoCol.className = "min-w-0 flex-1";

    const titleRow = document.createElement("div");
    titleRow.className = "flex flex-wrap items-center gap-2";

    const title = document.createElement("h3");
    title.className = "text-base font-extrabold text-gray-900 leading-snug";
    title.textContent = product.name;
    titleRow.appendChild(title);

    if (product.weightInfo) {
      const weightPill = document.createElement("span");
      weightPill.className =
        "rounded-lg bg-stone-100 border border-stone-200 px-2 py-0.5 text-[11px] font-bold text-gray-700";
      weightPill.textContent = product.weightInfo;
      titleRow.appendChild(weightPill);
    }

    if (product.isCampaign) {
      const campPill = document.createElement("span");
      campPill.className =
        "rounded-lg bg-amber-100 border border-amber-200 px-2 py-0.5 text-[11px] font-extrabold text-amber-950";
      campPill.textContent = "Kampanya";
      titleRow.appendChild(campPill);
    }

    infoCol.appendChild(titleRow);

    if (product.defaultContents) {
      const desc = document.createElement("p");
      desc.className = "mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2";
      desc.textContent = product.requiresGarnish
        ? product.defaultContents
        : `📦 İçerik: ${product.defaultContents}`;
      infoCol.appendChild(desc);
    }

    const priceEl = document.createElement("p");
    priceEl.className = "mt-2 text-base font-extrabold text-rose-800";
    priceEl.textContent = `${product.priceTl} TL`;
    infoCol.appendChild(priceEl);

    card.appendChild(infoCol);

    const actionCol = document.createElement("div");
    actionCol.className = "shrink-0 flex flex-col items-end gap-1.5";

    const isShopClosed = !logic.isShopCurrentlyOpen(state.menuData).open;

    if (product.requiresGarnish) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.disabled = isShopClosed;
      btn.className =
        "rounded-xl bg-rose-800 hover:bg-rose-900 disabled:bg-stone-300 px-3.5 py-2.5 text-xs font-extrabold text-white shadow-xs transition cursor-pointer disabled:cursor-not-allowed";
      btn.textContent = "Seç & Hazırla";
      btn.addEventListener("click", () => openDurumModal(product));
      actionCol.appendChild(btn);
    } else if (product.defaultContents) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.disabled = isShopClosed;
      btn.className =
        "rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:bg-stone-200 px-3.5 py-2.5 text-xs font-extrabold text-amber-950 transition cursor-pointer disabled:cursor-not-allowed";
      btn.textContent = "İçeriği Gör";
      btn.addEventListener("click", () => openPortionModal(product));
      actionCol.appendChild(btn);
    } else {
      const currentQty = state.cart
        .filter((item) => item.code === product.code)
        .reduce((acc, item) => acc + item.quantity, 0);

      if (currentQty > 0) {
        const stepper = document.createElement("div");
        stepper.className =
          "inline-flex items-center rounded-xl border border-rose-200 bg-rose-50 p-0.5";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className =
          "h-8 w-8 rounded-lg font-extrabold text-rose-900 hover:bg-rose-100 cursor-pointer";
        minusBtn.textContent = "−";
        minusBtn.addEventListener("click", () => updateSimpleProductDelta(product.code, -1));

        const qtySpan = document.createElement("span");
        qtySpan.className = "w-7 text-center text-xs font-extrabold text-gray-900";
        qtySpan.textContent = String(currentQty);

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.disabled = isShopClosed;
        plusBtn.className =
          "h-8 w-8 rounded-lg font-extrabold text-rose-900 hover:bg-rose-100 disabled:opacity-40 cursor-pointer";
        plusBtn.textContent = "+";
        plusBtn.addEventListener("click", () => updateSimpleProductDelta(product.code, 1));

        stepper.append(minusBtn, qtySpan, plusBtn);
        actionCol.appendChild(stepper);
      } else {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.disabled = isShopClosed;
        addBtn.className =
          "rounded-xl border border-rose-300 bg-white hover:bg-rose-50 disabled:bg-stone-200 px-4 py-2 text-xs font-extrabold text-rose-800 transition cursor-pointer disabled:cursor-not-allowed";
        addBtn.textContent = "+ Ekle";
        addBtn.addEventListener("click", () => updateSimpleProductDelta(product.code, 1));
        actionCol.appendChild(addBtn);
      }
    }

    card.appendChild(actionCol);
    return card;
  }

  function renderAllMenuSections() {
    const container = $("menuSections");
    container.innerHTML = "";
    const products = getActiveProducts();
    const visibleCategories =
      state.activeCategory === "ALL" ? getActiveCategories() : [state.activeCategory];

    for (const catName of visibleCategories) {
      const catProducts = products.filter((p) => p.category === catName);
      if (catProducts.length === 0) continue;

      const section = document.createElement("section");
      const heading = document.createElement("div");
      heading.className = "mb-3 flex items-center justify-between";

      const title = document.createElement("h2");
      title.className = "text-lg font-extrabold text-gray-900 flex items-center gap-2";
      title.textContent = `${CATEGORY_ICONS[catName] || "📦"} ${catName}`;

      const countTag = document.createElement("span");
      countTag.className = "text-xs font-bold text-gray-500";
      countTag.textContent = `${catProducts.length} çeşit`;

      heading.append(title, countTag);
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "space-y-3";
      for (const product of catProducts) {
        grid.appendChild(renderProductCard(product));
      }
      section.appendChild(grid);
      container.appendChild(section);
    }
  }

  function renderFloatingCartBar() {
    const summary = logic.computeCartSummary(state.cart, getActiveRules());
    $("cartCountBadge").textContent = String(summary.totalCount);
    $("cartBarTotal").textContent = `${summary.totalTl} TL`;

    const hintEl = $("cartBarHint");
    const openBtn = $("openCartBtn");

    if (summary.totalCount === 0) {
      hintEl.textContent = "Sepetiniz boş • Menüden ürün ekleyin";
      hintEl.className = "truncate text-xs font-medium text-gray-600 mt-0.5";
      openBtn.disabled = true;
      openBtn.textContent = "Sepeti Gör →";
    } else if (!summary.hasMainFood) {
      hintEl.textContent = "Sadece içecek gönderilemez • Yiyecek ekleyin";
      hintEl.className = "truncate text-xs font-bold text-amber-800 mt-0.5";
      openBtn.disabled = false;
      openBtn.textContent = "Sepeti Gör →";
    } else if (summary.remainingToMinTl > 0) {
      hintEl.textContent = `Min. ${summary.minOrderTl} TL için ${summary.remainingToMinTl} TL kaldı`;
      hintEl.className = "truncate text-xs font-bold text-amber-800 mt-0.5";
      openBtn.disabled = false;
      openBtn.textContent = "Sepeti Gör →";
    } else {
      hintEl.textContent = "Paket tutarı hazır • Siparişi tamamlayın";
      hintEl.className = "truncate text-xs font-bold text-emerald-700 mt-0.5";
      openBtn.disabled = false;
      openBtn.textContent = "Siparişi Tamamla →";
    }
  }

  function openModal(modalId) {
    $(modalId).classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modalId) {
    $(modalId).classList.add("hidden");
    const anyOpen = ["durumModal", "portionModal", "cartModal"].some(
      (id) => !$(id).classList.contains("hidden")
    );
    if (!anyOpen) {
      document.body.style.overflow = "";
    }
  }

  // --- DÜRÜM 3 ADIMLI MODAL ---
  function openDurumModal(product) {
    const rules = getActiveRules();

    state.durumDraft = {
      product,
      garnishes: [],
      sauces: [],
      hasDoritos: false,
      quantity: 1,
      warningText: null,
      activePreset: null,
      prePresetGarnishes: null,
    };

    $("durumModalTitle").textContent = product.name;
    $("durumModalWeight").textContent = product.weightInfo || "";
    $("durumModalBasePrice").textContent = `${product.priceTl} TL`;
    $("garnishLimitSubtitle").textContent =
      `En fazla ${rules.maxGarnishCount} çeşit garnitür seçebilirsiniz`;
    $("doritosPriceTag").textContent = `+${rules.doritosExtraPriceTl} TL`;
    $("doritosCheckbox").checked = false;

    renderDurumModalState();
    openModal("durumModal");
  }

  function applyDurumPresetToggle(presetKey, presetList) {
    const draft = state.durumDraft;
    if (!draft) return;
    const rules = getActiveRules();
    const opts = state.menuData.options;
    const res = logic.toggleGarnishPreset({
      activePreset: draft.activePreset,
      presetKey,
      currentGarnishes: draft.garnishes,
      prePresetGarnishes: draft.prePresetGarnishes,
      presetList,
      allowedOptions: opts.garnishes || [],
      maxCount: rules.maxGarnishCount || 6,
    });
    draft.garnishes = res.next;
    draft.activePreset = res.activePreset;
    draft.prePresetGarnishes = res.prePresetGarnishes;
    draft.warningText = null;
    renderDurumModalState();
  }

  function renderDurumModalState() {
    const draft = state.durumDraft;
    if (!draft) return;

    const rules = getActiveRules();
    const maxGarnishes = rules.maxGarnishCount || 6;
    const options = state.menuData.options;
    const selectedCount = draft.garnishes.length;
    const isFull = selectedCount >= maxGarnishes;

    const classicBtn = $("presetClassicSixBtn");
    const greensBtn = $("presetGreensBtn");
    const sadeBtn = $("presetSadeBtn");
    if (classicBtn) {
      const isAct = draft.activePreset === "classic";
      classicBtn.textContent = isAct ? "✓ ⭐ Klasik 6'lı" : "⭐ Klasik 6'lı";
      classicBtn.className = isAct
        ? "rounded-xl border-2 border-rose-700 bg-amber-100 ring-2 ring-rose-300 px-3 py-1.5 text-xs font-extrabold text-rose-950 transition cursor-pointer"
        : "rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-950 transition cursor-pointer";
    }
    if (greensBtn) {
      const isAct = draft.activePreset === "greens";
      greensBtn.textContent = isAct ? "✓ 🌿 Yeşillik" : "🌿 Yeşillik";
      greensBtn.className = isAct
        ? "rounded-xl border-2 border-emerald-700 bg-emerald-100 ring-2 ring-emerald-300 px-3 py-1.5 text-xs font-extrabold text-emerald-950 transition cursor-pointer"
        : "rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900 transition cursor-pointer";
    }
    if (sadeBtn) {
      const isAct = draft.activePreset === "sade";
      sadeBtn.textContent = isAct ? "✓ 🚫 Garnitürsüz (Sade)" : "🚫 Garnitürsüz (Sade)";
      sadeBtn.className = isAct
        ? "rounded-xl border-2 border-gray-800 bg-stone-200 ring-2 ring-stone-400 px-3 py-1.5 text-xs font-extrabold text-gray-900 transition cursor-pointer"
        : "rounded-xl border border-stone-300 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 text-xs font-bold text-gray-800 transition cursor-pointer";
    }

    const counterBadge = $("garnishCounterBadge");
    counterBadge.textContent = isFull
      ? `${selectedCount} / ${maxGarnishes} Tamamlandı`
      : `${selectedCount} / ${maxGarnishes} Seçildi`;
    counterBadge.className = isFull
      ? "rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-xs font-extrabold text-emerald-900"
      : "rounded-full bg-stone-100 border border-stone-200 px-3 py-1 text-xs font-extrabold text-gray-800";

    const warnBox = $("garnishLimitWarning");
    if (draft.warningText) {
      warnBox.textContent = `⚠️ ${draft.warningText}`;
      warnBox.classList.remove("hidden");
    } else {
      warnBox.classList.add("hidden");
    }

    const garnishGrid = $("garnishGrid");
    garnishGrid.innerHTML = "";
    for (const garnish of options.garnishes || []) {
      const checked = draft.garnishes.includes(garnish);
      const locked = !checked && isFull;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = checked
        ? "flex items-center justify-between gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 py-2.5 text-left text-xs font-extrabold text-emerald-950 transition cursor-pointer"
        : locked
          ? "flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-100 px-3 py-2.5 text-left text-xs font-semibold text-gray-400 opacity-65 transition cursor-not-allowed"
          : "flex items-center justify-between gap-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 px-3 py-2.5 text-left text-xs font-bold text-gray-800 transition cursor-pointer";

      const labelSpan = document.createElement("span");
      labelSpan.textContent = garnish;
      const markSpan = document.createElement("span");
      markSpan.textContent = checked ? "✅" : locked ? "🔒" : "⬜";
      btn.append(labelSpan, markSpan);

      btn.addEventListener("click", () => {
        const res = logic.toggleGarnishSelection(draft.garnishes, garnish, maxGarnishes);
        draft.garnishes = res.next;
        if (!res.blocked) {
          draft.activePreset = null;
          draft.prePresetGarnishes = null;
        }
        draft.warningText = res.blocked ? res.message : null;
        renderDurumModalState();
      });

      garnishGrid.appendChild(btn);
    }

    const sauceGrid = $("sauceGrid");
    sauceGrid.innerHTML = "";
    const sauceChoices = [...(options.sauces || []), "Sossuz"];
    for (const sauce of sauceChoices) {
      const isSossuz = sauce === "Sossuz";
      const isSelected = isSossuz
        ? draft.sauces.length === 0
        : draft.sauces.includes(sauce);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = isSelected
        ? "rounded-xl border-2 border-rose-700 bg-rose-50 px-3 py-2.5 text-xs font-extrabold text-rose-950 transition cursor-pointer"
        : "rounded-xl border border-stone-300 bg-white hover:bg-stone-50 px-3 py-2.5 text-xs font-bold text-gray-800 transition cursor-pointer";
      btn.textContent = isSelected ? `✅ ${sauce}` : sauce;

      btn.addEventListener("click", () => {
        draft.sauces = logic.toggleSauceSelection(draft.sauces, sauce);
        renderDurumModalState();
      });

      sauceGrid.appendChild(btn);
    }

    const doritosCard = $("doritosOptionCard");
    doritosCard.className = draft.hasDoritos
      ? "mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-amber-500 bg-amber-50 p-3.5 cursor-pointer transition"
      : "mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-stone-200 bg-stone-50/70 p-3.5 cursor-pointer transition";

    const unitTotal = logic.computeItemUnitPrice(
      draft.product,
      draft.hasDoritos,
      rules.doritosExtraPriceTl
    );
    const lineTotal = unitTotal * draft.quantity;
    $("durumQtyValue").textContent = String(draft.quantity);
    $("durumAddToCartBtn").textContent = `Sepete Ekle — ${lineTotal} TL`;
  }

  // --- PORSİYON SABİT İÇERİK MODALI ---
  function openPortionModal(product) {
    state.portionDraft = {
      product,
      quantity: 1,
    };

    $("portionModalTitle").textContent = product.name;
    $("portionModalWeight").textContent = product.weightInfo || "";
    $("portionModalPrice").textContent = `${product.priceTl} TL`;

    const listEl = $("portionContentsList");
    listEl.innerHTML = "";
    const parts = (product.defaultContents || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const part of parts) {
      const li = document.createElement("li");
      li.className = "flex items-center gap-2 font-semibold";
      li.textContent = `• ${part}`;
      listEl.appendChild(li);
    }

    renderPortionModalTotal();
    openModal("portionModal");
  }

  function renderPortionModalTotal() {
    const draft = state.portionDraft;
    if (!draft) return;
    $("portionQtyValue").textContent = String(draft.quantity);
    const total = draft.product.priceTl * draft.quantity;
    $("portionAddToCartBtn").textContent = `Sepete Ekle — ${total} TL`;
  }

  // --- SEPET & TESLİMAT MODALI ---
  function openCartModal() {
    const enabledPayments = logic.getEnabledPaymentMethods(state.menuData, state.fulfillmentType);
    if (
      enabledPayments.length > 0 &&
      !enabledPayments.some((m) => m.code === state.selectedPaymentCode)
    ) {
      state.selectedPaymentCode = enabledPayments[0].code;
    }

    $("addressInput").value = state.address;
    $("noteInput").value = state.note;
    $("noteCharCounter").textContent = `${state.note.length} / ${logic.MAX_NOTE_CHARS}`;
    $("copyFeedback").classList.add("hidden");

    renderCartModalContent();
    openModal("cartModal");
  }

  function renderCartModalContent() {
    const rules = getActiveRules();
    const summary = logic.computeCartSummary(state.cart, rules);

    const listEl = $("cartItemsList");
    listEl.innerHTML = "";

    if (state.cart.length === 0) {
      const emptyEl = document.createElement("p");
      emptyEl.className =
        "rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4 text-center text-xs font-semibold text-gray-600";
      emptyEl.textContent = "Sepetiniz boş. Menüden ürün ekleyebilirsiniz.";
      listEl.appendChild(emptyEl);
    } else {
      for (const item of state.cart) {
        const row = document.createElement("div");
        row.className =
          "rounded-2xl border border-stone-200 bg-stone-50/70 p-3 flex items-start justify-between gap-3";

        const left = document.createElement("div");
        left.className = "min-w-0 flex-1";

        const title = document.createElement("p");
        title.className = "text-sm font-extrabold text-gray-900";
        title.textContent = item.weightInfo
          ? `${item.name} (${item.weightInfo})`
          : item.name;
        left.appendChild(title);

        if (item.requiresGarnish) {
          const garnishLine = document.createElement("p");
          garnishLine.className = "mt-1 text-[11px] text-gray-700 leading-snug";
          const gText =
            item.garnishes.length > 0 ? item.garnishes.join(", ") : "Sade (Garnitürsüz)";
          const sText = item.sauces.length > 0 ? item.sauces.join(", ") : "Sossuz";
          const dText = item.hasDoritos ? " • +Doritos" : "";
          garnishLine.textContent = `${gText} | ${sText}${dText}`;
          left.appendChild(garnishLine);
        }

        const priceLine = document.createElement("p");
        priceLine.className = "mt-1.5 text-xs font-extrabold text-rose-800";
        priceLine.textContent = `${item.unitPriceTl * item.quantity} TL`;
        left.appendChild(priceLine);

        const right = document.createElement("div");
        right.className = "flex items-center gap-1 rounded-xl border border-stone-300 bg-white p-0.5";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "h-7 w-7 rounded-lg font-extrabold text-gray-700 hover:bg-stone-100 cursor-pointer";
        minusBtn.textContent = "−";
        minusBtn.addEventListener("click", () => {
          item.quantity -= 1;
          if (item.quantity <= 0) {
            state.cart = state.cart.filter((c) => c.key !== item.key);
          }
          renderFloatingCartBar();
          renderAllMenuSections();
          renderCartModalContent();
        });

        const qtyVal = document.createElement("span");
        qtyVal.className = "w-6 text-center text-xs font-extrabold";
        qtyVal.textContent = String(item.quantity);

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "h-7 w-7 rounded-lg font-extrabold text-gray-700 hover:bg-stone-100 cursor-pointer";
        plusBtn.textContent = "+";
        plusBtn.addEventListener("click", () => {
          item.quantity = Math.min(50, item.quantity + 1);
          renderFloatingCartBar();
          renderAllMenuSections();
          renderCartModalContent();
        });

        right.append(minusBtn, qtyVal, plusBtn);
        row.append(left, right);
        listEl.appendChild(row);
      }
    }

    const ruleAlert = $("cartRuleAlert");
    if (!summary.ok && summary.blockingReason) {
      ruleAlert.textContent = `⚠️ ${summary.blockingReason}`;
      ruleAlert.classList.remove("hidden");
    } else {
      ruleAlert.classList.add("hidden");
    }

    renderFulfillmentControls();
    renderPaymentMethods();
    renderGpsFeedbackBoxes();
    renderAddressDeliveryStatus();
    renderCheckoutValidationAndPreview();
  }

  function resetSendButtonUi() {
    const btn = $("sendWhatsAppBtn");
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = DEFAULT_WA_BTN_LABEL;
  }

  function setFulfillmentType(nextType, { openCartIfNeeded = false } = {}) {
    state.fulfillmentType = nextType === "PICKUP" ? "PICKUP" : "DELIVERY";
    renderFulfillmentControls();
    renderPaymentMethods();
    renderGpsFeedbackBoxes();
    renderAddressDeliveryStatus();
    renderCheckoutValidationAndPreview();
    resetSendButtonUi();
    if (openCartIfNeeded) {
      openCartModal();
    }
  }

  function renderFulfillmentControls() {
    const isPickup = state.fulfillmentType === "PICKUP";
    const delBtn = $("fulfillDeliveryBtn");
    const pickBtn = $("fulfillPickupBtn");
    const notice = $("pickupShopNotice");
    const gpsSec = $("deliveryGpsSection");
    const addrSec = $("deliveryAddressSection");

    if (delBtn) {
      delBtn.className = !isPickup
        ? "rounded-2xl border-2 border-rose-800 bg-rose-50 px-3 py-2.5 text-xs font-extrabold text-rose-950 transition cursor-pointer"
        : "rounded-2xl border border-stone-300 bg-white hover:bg-stone-50 px-3 py-2.5 text-xs font-bold text-gray-800 transition cursor-pointer";
    }
    if (pickBtn) {
      pickBtn.className = isPickup
        ? "rounded-2xl border-2 border-emerald-700 bg-emerald-50 px-3 py-2.5 text-xs font-extrabold text-emerald-950 transition cursor-pointer"
        : "rounded-2xl border border-stone-300 bg-white hover:bg-stone-50 px-3 py-2.5 text-xs font-bold text-gray-800 transition cursor-pointer";
    }
    if (notice) {
      if (isPickup) {
        const shopAddr = state.menuData?.shop?.address || "Kahramanlar Şubesi";
        notice.textContent = `🏪 Siparişiniz "${shopAddr}" şubemizden teslim alınmak üzere hazırlanacaktır (Kasa onayı sonrası hemen hazırlanır).`;
        notice.classList.remove("hidden");
      } else {
        notice.classList.add("hidden");
      }
    }
    if (gpsSec) gpsSec.classList.toggle("hidden", isPickup);
    if (addrSec) addrSec.classList.toggle("hidden", isPickup);
  }

  function renderPaymentMethods() {
    const container = $("paymentMethodsContainer");
    container.innerHTML = "";
    const enabled = logic.getEnabledPaymentMethods(state.menuData, state.fulfillmentType);
    if (enabled.length > 0 && !enabled.some((m) => m.code === state.selectedPaymentCode)) {
      state.selectedPaymentCode = enabled[0].code;
    }

    if (enabled.length === 0) {
      const noPay = document.createElement("p");
      noPay.className = "text-xs font-bold text-red-700";
      noPay.textContent = "Şu an aktif ödeme yöntemi bulunmamaktadır.";
      container.appendChild(noPay);
      return;
    }

    for (const method of enabled) {
      const selected = state.selectedPaymentCode === method.code;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = selected
        ? "flex items-center justify-between rounded-2xl border-2 border-rose-800 bg-rose-50 px-4 py-3 text-left text-sm font-extrabold text-rose-950 transition cursor-pointer"
        : "flex items-center justify-between rounded-2xl border border-stone-300 bg-white hover:bg-stone-50 px-4 py-3 text-left text-sm font-bold text-gray-800 transition cursor-pointer";

      const leftSpan = document.createElement("span");
      const icon =
        method.code === "CASH" ? "💵" : method.code === "CARD_POS" ? "💳" : "🏦";
      leftSpan.textContent = `${icon} ${method.label}`;

      const rightSpan = document.createElement("span");
      rightSpan.textContent = selected ? "✅ Seçili" : "Seç";
      rightSpan.className = selected
        ? "text-xs font-extrabold text-rose-800"
        : "text-xs text-gray-500";

      btn.append(leftSpan, rightSpan);
      btn.addEventListener("click", () => {
        state.selectedPaymentCode = method.code;
        renderPaymentMethods();
        renderCheckoutValidationAndPreview();
      });
      container.appendChild(btn);
    }

    const ibanNotice = $("ibanInfoNotice");
    if (state.selectedPaymentCode === "IBAN") {
      const ibanInfo = state.menuData?.shop?.payment?.ibanInfo || {};
      const bankText = ibanInfo.bank ? ` (${ibanInfo.bank} — ${ibanInfo.holder || "İşletme Hesabı"})` : "";
      ibanNotice.textContent = `🏦 Siparişiniz kasa tarafından onaylandığı anda resmi IBAN numaramız${bankText} WhatsApp üzerinden size otomatik gönderilecektir.`;
      ibanNotice.classList.remove("hidden");
    } else {
      ibanNotice.classList.add("hidden");
    }
  }

  function renderCheckoutValidationAndPreview() {
    const check = logic.validateCheckout({
      menuData: state.menuData,
      cartItems: state.cart,
      address: state.address,
      paymentMethodCode: state.selectedPaymentCode,
      gpsCheck: state.gpsCheck,
      fulfillmentType: state.fulfillmentType,
    });

    $("checkoutTotalLabel").textContent = `${check.summary.totalTl} TL`;

    const errorsBox = $("checkoutErrorsBox");
    errorsBox.innerHTML = "";
    const shouldShowErrors =
      !check.valid &&
      (state.fulfillmentType === "PICKUP" ||
        state.address.trim().length > 0 ||
        (state.gpsCheck && state.gpsCheck.zone === "RED"));

    if (shouldShowErrors) {
      for (const err of check.errors) {
        const p = document.createElement("p");
        p.textContent = `• ${err}`;
        errorsBox.appendChild(p);
      }
      errorsBox.classList.remove("hidden");
    } else {
      errorsBox.classList.add("hidden");
    }

    const previewText = logic.formatWhatsAppPreviewMessage({
      cartItems: state.cart,
      paymentLabel: check.chosenPayment ? check.chosenPayment.label : "Kapıda Nakit",
      address: state.address || "Kahramanlar Mah.",
      note: state.note,
      gpsCoords: state.gpsCoords,
      totalTl: check.summary.totalTl,
      fulfillmentType: state.fulfillmentType,
    });
    $("whatsAppPreviewText").textContent = previewText;
  }

  // --- GPS ÖN MESAFE KONTROLÜ ---
  function requestBrowserLocation() {
    if (!navigator.geolocation) {
      showToast("Tarayıcınız konum özelliğini desteklemiyor.");
      return;
    }

    showToast("Konumunuz doğrulanıyor...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const shop = state.menuData.shop;
        const rules = getActiveRules();
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const directMeters = logic.haversineMeters(shop.lat, shop.lon, lat, lon);
        const result = logic.classifyWalkDistance(directMeters, rules);

        state.gpsCoords = { lat, lon };
        state.gpsCheck = result;
        renderGpsFeedbackBoxes();
        renderCheckoutValidationAndPreview();
      },
      () => {
        showToast("Konum izni alınamadı. Açık adresinizi yazarak devam edebilirsiniz.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function clearGpsLocation() {
    state.gpsCoords = null;
    state.gpsCheck = null;
    renderGpsFeedbackBoxes();
    renderAddressDeliveryStatus();
    renderCheckoutValidationAndPreview();
  }

  function renderDistanceStatusBanner(box, check, { sourceLabel, onClear, openCartOnPickup } = {}) {
    if (!box) return;
    if (!check) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }

    box.classList.remove("hidden");
    box.innerHTML = "";

    const msgSpan = document.createElement("span");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "flex shrink-0 items-center gap-1.5";

    if (state.fulfillmentType === "PICKUP") {
      box.className =
        "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950";
      msgSpan.textContent = `🏪 Sipariş şekli "Dükkandan Gel-Al" seçildi — Mesafe sınırı olmadan devam edebilirsiniz.`;
    } else if (check.zone === "GREEN") {
      box.className =
        "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950";
      msgSpan.textContent = `🟢 ${sourceLabel} teslimat bölgesi içinde (~${check.walkMeters}m • ~${check.minutes} dk yürüyüş) — Teslimat mümkün!`;
    } else if (check.zone === "YELLOW") {
      box.className =
        "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950";
      msgSpan.textContent = `🟡 ${sourceLabel} sınır bölgede (~${check.walkMeters}m • ~${check.minutes} dk yürüyüş) — Kasa onayına bağlı veya Gel-Al seçebilirsiniz.`;
    } else if (check.zone === "RED") {
      box.className =
        "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950";
      msgSpan.textContent = `🟠 ${sourceLabel} kurye teslimat alanı (~${check.walkMeters}m) dışında görünüyor. Siparişinize Gel-Al ile devam etmek istiyor musunuz?`;
    } else {
      box.className =
        "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-bold text-gray-800";
      msgSpan.textContent =
        "ℹ️ Adresiniz haritada netleştirilemedi; siparişiniz kasaya iletilip kontrol edilecektir.";
    }

    if ((check.zone === "RED" || check.zone === "YELLOW") && state.fulfillmentType !== "PICKUP") {
      const pickupBtn = document.createElement("button");
      pickupBtn.type = "button";
      pickupBtn.className =
        "rounded-lg bg-emerald-700 hover:bg-emerald-800 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-xs transition cursor-pointer";
      pickupBtn.textContent = "🏪 Gel-Al ile Devam Et";
      pickupBtn.addEventListener("click", () => {
        setFulfillmentType("PICKUP", {
          openCartIfNeeded: Boolean(openCartOnPickup && state.cart.length > 0),
        });
        showToast("🏪 Sipariş şekli Dükkandan Gel-Al olarak seçildi!");
      });
      actionsWrap.appendChild(pickupBtn);
    }

    if (typeof onClear === "function") {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className =
        "rounded-lg bg-white/80 hover:bg-white px-2 py-1 text-[11px] font-extrabold underline cursor-pointer";
      clearBtn.textContent = "Temizle";
      clearBtn.addEventListener("click", onClear);
      actionsWrap.appendChild(clearBtn);
    }

    box.append(msgSpan, actionsWrap);
  }

  function renderGpsFeedbackBoxes() {
    const targets = [$("headerGpsResult"), $("checkoutGpsStatus")];
    for (const box of targets) {
      renderDistanceStatusBanner(box, state.gpsCheck, {
        sourceLabel: "Konumunuz",
        onClear: clearGpsLocation,
        openCartOnPickup: box?.id === "headerGpsResult",
      });
    }
  }

  function renderAddressDeliveryStatus() {
    const box = $("addressDeliveryStatus");
    if (!box) return;
    if (state.fulfillmentType === "PICKUP" || state.gpsCoords || !state.addressCheck) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    renderDistanceStatusBanner(box, state.addressCheck.result, {
      sourceLabel: "Girdiğiniz adres",
      onClear: null,
      openCartOnPickup: false,
    });
  }

  function readAddressGeoCache(normalizedKey) {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_ADDR_CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      return cache && cache[normalizedKey] ? cache[normalizedKey] : null;
    } catch {
      return null;
    }
  }

  function writeAddressGeoCache(normalizedKey, entry) {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_ADDR_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[normalizedKey] = entry;
      window.sessionStorage.setItem(STORAGE_ADDR_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Depolama dolu veya gizli modda sessizce geçilir.
    }
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function geocodeAddressPoint(normalizedQuery, shop) {
    const viewbox = `${(shop.lon - 0.1).toFixed(3)},${(shop.lat + 0.06).toFixed(3)},${(shop.lon + 0.1).toFixed(3)},${(shop.lat - 0.06).toFixed(3)}`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=tr&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(normalizedQuery)}`;
    const nomData = await fetchJsonWithTimeout(nominatimUrl, 2200);
    if (Array.isArray(nomData) && nomData.length > 0) {
      const lat = Number(nomData[0].lat);
      const lon = Number(nomData[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }

    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(normalizedQuery)}&lat=${shop.lat}&lon=${shop.lon}&limit=1`;
    const photonData = await fetchJsonWithTimeout(photonUrl, 2000);
    const feat = photonData?.features?.[0];
    const coords = feat?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }
    return null;
  }

  async function verifyTypedAddressInBrowser(rawAddress) {
    const normalized = logic.normalizeAddressForGeocoding(rawAddress);
    const normalizedKey = normalized.toLowerCase();
    const shop = state.menuData.shop;
    const rules = getActiveRules();

    const cached = readAddressGeoCache(normalizedKey);
    if (cached) {
      return {
        normalizedKey,
        coords: cached.coords || null,
        result: cached.result,
        yellowConfirmed: false,
      };
    }

    const point = normalized ? await geocodeAddressPoint(normalized, shop) : null;
    if (!point) {
      return {
        normalizedKey,
        coords: null,
        result: { zone: "UNKNOWN", walkMeters: null, minutes: null },
        yellowConfirmed: false,
      };
    }

    const directMeters = logic.haversineMeters(shop.lat, shop.lon, point.lat, point.lon);
    // Farklı şehir eşleşmesi (>= 50 km) yanlış uyarı üretmesin diye UNKNOWN bırakılır.
    if (directMeters > 50000) {
      return {
        normalizedKey,
        coords: null,
        result: { zone: "UNKNOWN", walkMeters: null, minutes: null },
        yellowConfirmed: false,
      };
    }

    let result;
    const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${shop.lon},${shop.lat};${point.lon},${point.lat}?overview=false`;
    const osrmData = await fetchJsonWithTimeout(osrmUrl, 1800);
    const routeMeters = osrmData?.routes?.[0]?.distance;
    if (typeof routeMeters === "number" && Number.isFinite(routeMeters) && routeMeters > 0) {
      result = logic.classifyWalkDistance(routeMeters, rules, 1.0);
    } else {
      result = logic.classifyWalkDistance(directMeters, rules);
    }

    const entry = { normalizedKey, coords: point, result, yellowConfirmed: false };
    writeAddressGeoCache(normalizedKey, { coords: point, result });
    return entry;
  }

  async function handleSendWhatsApp(copyOnly) {
    const check = logic.validateCheckout({
      menuData: state.menuData,
      cartItems: state.cart,
      address: state.address,
      paymentMethodCode: state.selectedPaymentCode,
      gpsCheck: state.gpsCheck,
      fulfillmentType: state.fulfillmentType,
    });

    if (!check.valid) {
      const errorsBox = $("checkoutErrorsBox");
      errorsBox.innerHTML = "";
      for (const err of check.errors) {
        const p = document.createElement("p");
        p.textContent = `• ${err}`;
        errorsBox.appendChild(p);
      }
      errorsBox.classList.remove("hidden");
      errorsBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast(check.errors[0]);
      return;
    }

    const messageText = logic.formatFastPathWhatsAppMessage({
      cartItems: state.cart,
      paymentLabel: check.chosenPayment.label,
      address: check.cleanAddress,
      note: state.note,
      gpsCoords: state.gpsCoords,
      totalTl: check.summary.totalTl,
      fulfillmentType: state.fulfillmentType,
    });

    if (copyOnly) {
      copyTextToClipboard(messageText);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const url = logic.buildWhatsAppUrl(
      state.menuData.shop.whatsappPhone,
      messageText,
      params.get("wa")
    );

    const needsTypedAddressCheck = state.fulfillmentType === "DELIVERY" && !state.gpsCoords;
    if (!needsTypedAddressCheck) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const btn = $("sendWhatsAppBtn");
    const normKey = logic.normalizeAddressForGeocoding(check.cleanAddress).toLowerCase();
    const hadCachedCheck = Boolean(state.addressCheck && state.addressCheck.normalizedKey === normKey);

    if (!hadCachedCheck) {
      if (state.addressVerifyPending) return;
      state.addressVerifyPending = true;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ Adres teslimat alanı kontrol ediliyor...";
      }
      try {
        state.addressCheck = await verifyTypedAddressInBrowser(check.cleanAddress);
      } finally {
        state.addressVerifyPending = false;
        if (btn) btn.disabled = false;
      }
      renderAddressDeliveryStatus();
    }

    const addrResult = state.addressCheck?.result;
    if (addrResult?.zone === "RED") {
      resetSendButtonUi();
      $("addressDeliveryStatus")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast("🟠 Adres teslimat alanı dışında — Gel-Al ile devam edebilirsiniz.");
      return;
    }

    if (addrResult?.zone === "YELLOW" && !state.addressCheck.yellowConfirmed) {
      state.addressCheck.yellowConfirmed = true;
      if (btn) {
        btn.textContent = "💬 Sınır Mesafe — Yine de WhatsApp ile Gönder";
      }
      $("addressDeliveryStatus")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast("🟡 Adres sınır bölgede — Gel-Al seçebilir veya tekrar basarak gönderebilirsiniz.");
      return;
    }

    const openedWin = window.open(url, "_blank", "noopener,noreferrer");
    if (!openedWin && btn) {
      btn.textContent =
        addrResult?.zone === "GREEN"
          ? "✅ Teslimat Uygun — WhatsApp'ı Aç →"
          : "💬 WhatsApp'ı Açmak İçin Tekrar Dokunun →";
      showToast(
        addrResult?.zone === "GREEN"
          ? "🟢 Teslimat mümkün! WhatsApp'ı açmak için butona dokunun."
          : "ℹ️ WhatsApp'ı açmak için butona tekrar dokunun."
      );
      return;
    }
    if (addrResult?.zone === "GREEN") {
      showToast("🟢 Adresiniz teslimat bölgesinde — WhatsApp açıldı!");
    }
    resetSendButtonUi();
  }

  async function copyTextToClipboard(text) {
    const feedback = $("copyFeedback");
    try {
      await navigator.clipboard.writeText(text);
      feedback.textContent = "✅ Sipariş metni kopyalandı! WhatsApp sohbetine yapıştırabilirsiniz.";
      feedback.classList.remove("hidden");
      showToast("✅ Sipariş metni kopyalandı!");
    } catch {
      feedback.textContent =
        "ℹ️ Metin önizleme kutusundan metni seçip kopyalayabilirsiniz.";
      feedback.classList.remove("hidden");
    }
  }

  function bindStaticEvents() {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close-modal")));
    });

    ["durumModal", "portionModal", "cartModal"].forEach((modalId) => {
      $(modalId).addEventListener("click", (event) => {
        if (event.target === $(modalId)) {
          closeModal(modalId);
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        ["cartModal", "durumModal", "portionModal"].forEach(closeModal);
      }
    });

    $("headerGpsBtn").addEventListener("click", requestBrowserLocation);
    $("checkoutGpsBtn").addEventListener("click", requestBrowserLocation);
    $("openCartBtn").addEventListener("click", openCartModal);

    // Dürüm Modal Kontrolleri (Aynı hızlı seçim tuşuna tekrar basınca öncekine döner)
    $("presetClassicSixBtn").addEventListener("click", () => {
      const opts = state.menuData?.options || {};
      applyDurumPresetToggle("classic", opts.classicSixPreset || []);
    });

    $("presetGreensBtn").addEventListener("click", () => {
      const opts = state.menuData?.options || {};
      applyDurumPresetToggle("greens", opts.greensPreset || []);
    });

    $("presetSadeBtn").addEventListener("click", () => {
      applyDurumPresetToggle("sade", []);
    });

    $("doritosCheckbox").addEventListener("change", (e) => {
      if (!state.durumDraft) return;
      state.durumDraft.hasDoritos = Boolean(e.target.checked);
      renderDurumModalState();
    });

    $("durumQtyMinus").addEventListener("click", () => {
      if (!state.durumDraft) return;
      state.durumDraft.quantity = Math.max(1, state.durumDraft.quantity - 1);
      renderDurumModalState();
    });

    $("durumQtyPlus").addEventListener("click", () => {
      if (!state.durumDraft) return;
      state.durumDraft.quantity = Math.min(50, state.durumDraft.quantity + 1);
      renderDurumModalState();
    });

    $("durumAddToCartBtn").addEventListener("click", () => {
      const draft = state.durumDraft;
      if (!draft) return;
      addItemToCart({
        product: draft.product,
        quantity: draft.quantity,
        garnishes: draft.garnishes,
        sauces: draft.sauces,
        hasDoritos: draft.hasDoritos,
      });
      closeModal("durumModal");
    });

    // Porsiyon Modal Kontrolleri
    $("portionQtyMinus").addEventListener("click", () => {
      if (!state.portionDraft) return;
      state.portionDraft.quantity = Math.max(1, state.portionDraft.quantity - 1);
      renderPortionModalTotal();
    });

    $("portionQtyPlus").addEventListener("click", () => {
      if (!state.portionDraft) return;
      state.portionDraft.quantity = Math.min(50, state.portionDraft.quantity + 1);
      renderPortionModalTotal();
    });

    $("portionAddToCartBtn").addEventListener("click", () => {
      const draft = state.portionDraft;
      if (!draft) return;
      addItemToCart({
        product: draft.product,
        quantity: draft.quantity,
        garnishes: [],
        sauces: [],
        hasDoritos: false,
      });
      closeModal("portionModal");
    });

    // Sepet & Gönderim Kontrolleri
    $("fulfillDeliveryBtn").addEventListener("click", () => setFulfillmentType("DELIVERY"));
    $("fulfillPickupBtn").addEventListener("click", () => setFulfillmentType("PICKUP"));

    $("clearCartBtn").addEventListener("click", () => {
      state.cart = [];
      renderFloatingCartBar();
      renderAllMenuSections();
      renderCartModalContent();
    });

    $("addressInput").addEventListener("input", (e) => {
      state.address = e.target.value;
      state.addressCheck = null;
      saveAddressToStorage(state.address);
      renderAddressDeliveryStatus();
      renderCheckoutValidationAndPreview();
      resetSendButtonUi();
    });

    $("noteInput").addEventListener("input", (e) => {
      state.note = e.target.value;
      $("noteCharCounter").textContent = `${state.note.length} / ${logic.MAX_NOTE_CHARS}`;
      renderCheckoutValidationAndPreview();
    });

    $("sendWhatsAppBtn").addEventListener("click", () => handleSendWhatsApp(false));
    $("whatsAppPreviewText").addEventListener("click", () => handleSendWhatsApp(true));
  }

  async function loadMenuData() {
    try {
      const response = await fetch(`./menu.json?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Yerel file:// açılımlarında menu-fallback.js devreye girer.
    }

    if (window.KADIR_USTA_MENU_FALLBACK) {
      return window.KADIR_USTA_MENU_FALLBACK;
    }
    throw new Error("Menü verisi (menu.json) yüklenemedi.");
  }

  async function init() {
    state.address = readSavedAddress();
    bindStaticEvents();

    try {
      state.menuData = await loadMenuData();
      renderHeader();
      renderCategoryTabs();
      renderAllMenuSections();
      renderFloatingCartBar();
    } catch (error) {
      $("menuSections").innerHTML =
        `<div class="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-bold text-red-900">Menü yüklenirken bir hata oluştu. Lütfen sayfayı yenileyiniz.</div>`;
      console.error(error);
    }
  }

  init();
})();
