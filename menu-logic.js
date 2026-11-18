(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KadirUstaLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EARTH_RADIUS_METERS = 6371000.0;
  const URBAN_WALK_DETOUR_FACTOR = 1.3;
  const MAX_ADDRESS_CHARS = 200;
  const MAX_NOTE_CHARS = 120;

  function sanitizeSingleLine(raw, maxLength) {
    if (typeof raw !== "string") {
      return "";
    }
    const cleaned = raw
      .replace(/[\r\n\x00-\x1f\x7f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!maxLength || cleaned.length <= maxLength) {
      return cleaned;
    }
    return cleaned.slice(0, maxLength).trim();
  }

  function normalizeAddressForGeocoding(rawAddress) {
    if (typeof rawAddress !== "string") {
      return "";
    }
    let cleaned = rawAddress
      .replace(
        /(?:\(.*?\)|kat\s*[:.]?\s*\w+|daire\s*[:.]?\s*\w+|d\s*[:.]\s*\d+|kapı\s*[:.]?\s*\w+|zil\s*[:.]?\s*\w+)/gi,
        " "
      )
      .replace(/\bMah\.?/gi, "Mahallesi")
      .replace(/\b(?:Sk\.?|Sok\.?)/gi, "Sokak")
      .replace(/\bCad\.?/gi, "Caddesi")
      .replace(/\bBulv?\.?/gi, "Bulvarı")
      .replace(/[,;\s]+/g, " ")
      .trim();
    if (!cleaned) {
      return "";
    }
    if (!cleaned.toLocaleLowerCase("tr-TR").includes("izmir")) {
      cleaned = `${cleaned}, Konak, İzmir, Türkiye`;
    }
    return cleaned;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180.0;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const rLat1 = toRad(lat1);
    const rLat2 = toRad(lat2);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
  }

  function classifyWalkDistance(haversineDistMeters, rules, detourFactor) {
    const factor =
      typeof detourFactor === "number" && detourFactor > 0
        ? detourFactor
        : URBAN_WALK_DETOUR_FACTOR;
    const walkMeters = Math.round(haversineDistMeters * factor);
    const speed = Math.max(1, Number(rules?.walkSpeedMetersPerMin) || 40);
    const minutes = Number((walkMeters / speed).toFixed(1));
    const maxGreen = Number(rules?.maxWalkMetersGreen) || 400;
    const maxYellow = Number(rules?.maxWalkMetersYellow) || 480;

    let zone = "RED";
    if (walkMeters <= maxGreen) {
      zone = "GREEN";
    } else if (walkMeters <= maxYellow) {
      zone = "YELLOW";
    }

    return {
      haversineMeters: Math.round(haversineDistMeters),
      walkMeters,
      minutes,
      zone,
    };
  }

  function toggleGarnishSelection(selectedList, candidate, maxCount = 6) {
    const current = Array.isArray(selectedList) ? [...selectedList] : [];
    const index = current.indexOf(candidate);
    if (index !== -1) {
      current.splice(index, 1);
      return { next: current, blocked: false, message: null };
    }
    if (current.length >= maxCount) {
      return {
        next: current,
        blocked: true,
        message: `En fazla ${maxCount} çeşit garnitür seçebilirsiniz.`,
      };
    }
    current.push(candidate);
    return { next: current, blocked: false, message: null };
  }

  function applyGarnishPreset(presetList, allowedOptions, maxCount = 6) {
    const allowedSet = new Set(Array.isArray(allowedOptions) ? allowedOptions : []);
    const picked = [];
    for (const item of presetList || []) {
      if ((allowedSet.size === 0 || allowedSet.has(item)) && !picked.includes(item)) {
        picked.push(item);
      }
      if (picked.length >= maxCount) {
        break;
      }
    }
    return picked;
  }

  function toggleGarnishPreset({
    activePreset,
    presetKey,
    currentGarnishes,
    prePresetGarnishes,
    presetList,
    allowedOptions,
    maxCount = 6,
  }) {
    if (activePreset === presetKey) {
      return {
        next: Array.isArray(prePresetGarnishes) ? [...prePresetGarnishes] : [],
        activePreset: null,
        prePresetGarnishes: null,
      };
    }
    const nextPreset =
      Array.isArray(presetList) && presetList.length > 0
        ? applyGarnishPreset(presetList, allowedOptions, maxCount)
        : [];
    return {
      next: nextPreset,
      activePreset: presetKey,
      prePresetGarnishes: Array.isArray(currentGarnishes) ? [...currentGarnishes] : [],
    };
  }

  function toggleSauceSelection(selectedSauces, candidate) {
    if (candidate === "Sossuz") {
      return [];
    }
    const current = Array.isArray(selectedSauces) ? [...selectedSauces] : [];
    const index = current.indexOf(candidate);
    if (index !== -1) {
      current.splice(index, 1);
    } else {
      current.push(candidate);
    }
    return current;
  }

  function computeItemUnitPrice(product, hasDoritos, doritosExtraPriceTl = 20) {
    const base = Math.max(0, Number(product?.priceTl) || 0);
    const applyDoritos = Boolean(product?.requiresGarnish && hasDoritos);
    const extra = applyDoritos ? Math.max(0, Number(doritosExtraPriceTl) || 0) : 0;
    return base + extra;
  }

  function computeCartSummary(cartItems, rules) {
    const items = Array.isArray(cartItems) ? cartItems : [];
    const minOrderTl = Math.max(0, Number(rules?.minOrderAmountTl) || 75);
    let totalTl = 0;
    let totalCount = 0;
    let hasMainFood = false;

    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.max(0, Number(item.unitPriceTl) || 0);
      totalTl += unitPrice * qty;
      totalCount += qty;
      if (item.isMainFood !== false) {
        hasMainFood = true;
      }
    }

    const remainingToMinTl = Math.max(0, minOrderTl - totalTl);
    let ok = true;
    let blockingReason = null;

    if (items.length === 0) {
      ok = false;
      blockingReason = "Sepetiniz şu an boş. Menüden ürün ekleyebilirsiniz.";
    } else if (!hasMainFood) {
      ok = false;
      blockingReason =
        "Yalnızca içecek siparişi için paket servis çıkarılamaz. Lütfen en az bir yiyecek ürünü ekleyiniz.";
    } else if (totalTl < minOrderTl) {
      ok = false;
      blockingReason = `Paket servis için en az ${minOrderTl} TL tutarında ürün seçmelisiniz (Kalan: ${remainingToMinTl} TL).`;
    }

    return {
      totalTl,
      totalCount,
      hasMainFood,
      minOrderTl,
      remainingToMinTl,
      ok,
      blockingReason,
    };
  }

  function getEnabledPaymentMethods(menuData, fulfillmentType = "DELIVERY") {
    const payment = menuData?.shop?.payment || {};
    const methods = payment.methods;
    const list = Array.isArray(methods) ? methods : [];
    if (fulfillmentType === "PICKUP") {
      const pickupLabels = {
        CASH: "Nakit (Dükkanda)",
        CARD_POS: "Kredi Kartı (Dükkanda POS)",
        IBAN: "IBAN / FAST ile Ödeme",
      };
      const byCode = new Map(list.map((m) => [m.code, m]));
      const ibanReady =
        payment.ibanEnabled !== false &&
        payment.ibanInfo?.configured !== false &&
        byCode.get("IBAN")?.enabled !== false;
      const pickupCodes = ibanReady ? ["CASH", "CARD_POS", "IBAN"] : ["CASH", "CARD_POS"];
      return pickupCodes.map((code) => ({
        code,
        label: pickupLabels[code] || byCode.get(code)?.label || code,
        enabled: true,
      }));
    }
    return list.filter((m) => Boolean(m?.enabled));
  }

  function isShopCurrentlyOpen(menuData, nowDate) {
    const shop = menuData?.shop || {};
    const schedule = shop.schedule || {};
    const scheduleLabel = schedule.label || "Pzt–Cmt 11:00–21:00 (Pazar Kapalı)";

    if (shop.isOpen === false) {
      return {
        open: false,
        reason: "MANUAL_CLOSED",
        scheduleLabel,
        message: `Şubemiz şu anda paket servise kapalıdır. Çalışma saatlerimiz: ${scheduleLabel}.`,
      };
    }

    if (schedule.enforce) {
      const refDate = nowDate instanceof Date ? nowDate : new Date();
      const offsetMinutes =
        typeof schedule.utcOffsetMinutes === "number" ? schedule.utcOffsetMinutes : 180;
      const localMs = refDate.getTime() + offsetMinutes * 60_000;
      const local = new Date(localMs);
      const jsDay = local.getUTCDay(); // 0=Pazar, 1=Pzt..6=Cmt
      const isoWeekday = jsDay === 0 ? 7 : jsDay;
      const hour = local.getUTCHours();
      const openHour = typeof schedule.openHour === "number" ? schedule.openHour : 11;
      const closeHour = typeof schedule.closeHour === "number" ? schedule.closeHour : 21;
      const closedDays = Array.isArray(schedule.closedIsoWeekdays)
        ? schedule.closedIsoWeekdays
        : [7];

      if (closedDays.includes(isoWeekday) || hour < openHour || hour >= closeHour) {
        return {
          open: false,
          reason: "OUTSIDE_HOURS",
          scheduleLabel,
          message: `Şubemiz şu anda mesai saatleri dışındadır. Çalışma saatlerimiz: ${scheduleLabel}.`,
        };
      }
    }

    return { open: true, reason: null, scheduleLabel, message: null };
  }

  function validateCheckout({
    menuData,
    cartItems,
    address,
    paymentMethodCode,
    gpsCheck,
    fulfillmentType = "DELIVERY",
    nowDate,
  }) {
    const errors = [];
    const shop = menuData?.shop;
    const rules = shop?.rules || {};
    const isPickup = fulfillmentType === "PICKUP";

    const openStatus = isShopCurrentlyOpen(menuData, nowDate);
    if (!openStatus.open && openStatus.message) {
      errors.push(openStatus.message);
    }

    const summary = computeCartSummary(cartItems, rules);
    if (!summary.ok && summary.blockingReason) {
      errors.push(summary.blockingReason);
    }

    if (!isPickup && gpsCheck && gpsCheck.zone === "RED") {
      const maxGreen = Number(rules.maxWalkMetersGreen) || 400;
      errors.push(
        `Mevcut GPS konumunuz (~${gpsCheck.walkMeters}m) ~${maxGreen}m yaya teslimat alanımız dışında görünüyor. Yukarıdan "Dükkandan Gel-Al" seçeneğiyle siparişinize devam edebilir veya farklı bir adres için GPS konumunu temizleyebilirsiniz.`
      );
    }

    const cleanAddress = sanitizeSingleLine(address, MAX_ADDRESS_CHARS);
    if (!isPickup && cleanAddress.length < 8) {
      errors.push(
        "Lütfen mahalle, sokak ve kapı numaranızı içeren açık adresinizi eksiksiz yazınız."
      );
    }

    const enabledPayments = getEnabledPaymentMethods(menuData, fulfillmentType);
    const chosenPayment = enabledPayments.find((m) => m.code === paymentMethodCode);
    if (!chosenPayment) {
      errors.push("Lütfen aktif ödeme yöntemlerinden birini seçiniz.");
    }

    return {
      valid: errors.length === 0,
      errors,
      summary,
      chosenPayment: chosenPayment || null,
      cleanAddress: isPickup ? "Dükkandan Gel-Al" : cleanAddress,
      fulfillmentType: isPickup ? "PICKUP" : "DELIVERY",
    };
  }

  function formatFastPathWhatsAppMessage({
    cartItems,
    paymentLabel,
    address,
    note,
    gpsCoords,
    totalTl,
    fulfillmentType = "DELIVERY",
  }) {
    const isPickup = fulfillmentType === "PICKUP";
    const lines = ["[#CK-WEB-v1]", "ÜRÜNLER:"];

    for (const item of cartItems || []) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const weightSuffix = item.weightInfo ? ` (${item.weightInfo})` : "";
      lines.push(`- ${qty}x [${item.code}] ${item.name}${weightSuffix}`);

      if (item.requiresGarnish) {
        const garnishText =
          Array.isArray(item.garnishes) && item.garnishes.length > 0
            ? item.garnishes.join(", ")
            : "Sade (Garnitürsüz)";
        lines.push(`  Garnitür: ${garnishText}`);

        const sauceText =
          Array.isArray(item.sauces) && item.sauces.length > 0
            ? item.sauces.join(", ")
            : "Sossuz";
        lines.push(`  Sos: ${sauceText}`);

        if (item.hasDoritos) {
          lines.push("  Ekstra: Doritos Farkı");
        }
      }
    }

    lines.push(`ÖDEME: ${sanitizeSingleLine(paymentLabel, 60)}`);

    if (isPickup) {
      lines.push("TESLİMAT: Dükkandan Gel-Al");
      lines.push("ADRES: Dükkandan Gel-Al (Müşteri şubeden teslim alacak)");
    } else {
      if (
        gpsCoords &&
        typeof gpsCoords.lat === "number" &&
        typeof gpsCoords.lon === "number" &&
        Number.isFinite(gpsCoords.lat) &&
        Number.isFinite(gpsCoords.lon)
      ) {
        lines.push(`KONUM: ${gpsCoords.lat.toFixed(6)},${gpsCoords.lon.toFixed(6)}`);
      }
      lines.push(`ADRES: ${sanitizeSingleLine(address, MAX_ADDRESS_CHARS)}`);
    }

    const cleanNote = sanitizeSingleLine(note || "", MAX_NOTE_CHARS);
    if (cleanNote) {
      lines.push(`NOT: ${cleanNote}`);
    }

    if (typeof totalTl === "number" && totalTl > 0) {
      lines.push(`TOPLAM: ${Math.round(totalTl)} TL`);
    }

    return lines.join("\n");
  }

  function formatWhatsAppPreviewMessage(params) {
    return formatFastPathWhatsAppMessage(params).replace(/^\[#CK-WEB-v1\]\s*\n?/, "");
  }

  function buildWhatsAppUrl(whatsappPhone, messageText, queryOverridePhone) {
    const candidate = String(queryOverridePhone || whatsappPhone || "").replace(/\D+/g, "");
    let digits = candidate;
    if (digits.startsWith("0090") && digits.length === 14) {
      digits = digits.slice(2);
    } else if (digits.startsWith("0") && digits.length === 11) {
      digits = `9${digits}`;
    } else if (digits.length === 10 && digits.startsWith("5")) {
      digits = `90${digits}`;
    }
    const encoded = encodeURIComponent(messageText);
    if (digits.length >= 10) {
      return `https://wa.me/${digits}?text=${encoded}`;
    }
    return `https://api.whatsapp.com/send?text=${encoded}`;
  }

  return {
    EARTH_RADIUS_METERS,
    URBAN_WALK_DETOUR_FACTOR,
    MAX_ADDRESS_CHARS,
    MAX_NOTE_CHARS,
    sanitizeSingleLine,
    normalizeAddressForGeocoding,
    haversineMeters,
    classifyWalkDistance,
    toggleGarnishSelection,
    applyGarnishPreset,
    toggleGarnishPreset,
    toggleSauceSelection,
    computeItemUnitPrice,
    computeCartSummary,
    getEnabledPaymentMethods,
    isShopCurrentlyOpen,
    validateCheckout,
    formatFastPathWhatsAppMessage,
    formatWhatsAppPreviewMessage,
    buildWhatsAppUrl,
  };
});
