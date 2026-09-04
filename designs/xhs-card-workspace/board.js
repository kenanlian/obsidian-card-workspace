/* Card Workspace · 小红书图文卡片 — 工作台逻辑
   图位替换/平移/缩放、Tweaks、按 1242×1656 原尺寸导出 PNG。
   图位与设置存在 localStorage，刷新不丢。 */

const STORE = "xhs-cw/v1";
const CARD_W = 1242;
const CARD_H = 1656;

const state = loadState();

/* ---------------- 存档 ---------------- */

function loadState() {
  const fallback = { slots: {}, settings: {} };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { slots: parsed.slots || {}, settings: parsed.settings || {} };
  } catch (err) {
    console.warn("读取本地存档失败，使用默认值", err);
    return fallback;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch (err) {
    toast("本地存储已满，图片没能保存");
    console.warn(err);
  }
}

/* ---------------- 图位 ---------------- */

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*";
fileInput.style.display = "none";
document.body.appendChild(fileInput);
let pendingSlot = null;

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file && pendingSlot) readImage(file, pendingSlot);
  fileInput.value = "";
});

document.querySelectorAll(".slot").forEach(setupSlot);

function setupSlot(slot) {
  const id = slot.dataset.slot;
  const saved = state.slots[id] || {};

  const img = document.createElement("img");
  img.className = "slot-img";
  img.alt = "";
  img.draggable = false;
  slot.prepend(img);

  const tools = document.createElement("div");
  tools.className = "slot-tools chrome";
  tools.innerHTML =
    '<button type="button" data-act="replace">替换</button>' +
    '<button type="button" data-act="clear">清除</button>';
  slot.appendChild(tools);

  const view = {
    src: saved.src || slot.dataset.src || "",
    zoom: num(saved.zoom, slot.dataset.zoom, 1),
    tx: num(saved.tx, slot.dataset.tx, 0),
    ty: num(saved.ty, slot.dataset.ty, 0),
  };

  slot._view = view;
  slot._img = img;
  render(slot);

  tools.addEventListener("click", (event) => {
    const act = event.target.dataset.act;
    if (!act) return;
    event.stopPropagation();
    if (act === "replace") {
      pendingSlot = slot;
      fileInput.click();
    } else {
      view.src = "";
      view.zoom = 1;
      view.tx = 0;
      view.ty = 0;
      delete state.slots[id];
      saveState();
      render(slot);
    }
  });

  slot.addEventListener("click", () => {
    if (view.src) return;
    pendingSlot = slot;
    fileInput.click();
  });

  slot.addEventListener("dragover", (event) => {
    event.preventDefault();
    slot.classList.add("dragover");
  });

  slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));

  slot.addEventListener("drop", (event) => {
    event.preventDefault();
    slot.classList.remove("dragover");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) readImage(file, slot);
  });

  slot.addEventListener("wheel", (event) => {
    if (!view.src) return;
    event.preventDefault();
    view.zoom = clamp(view.zoom + (event.deltaY < 0 ? 0.06 : -0.06), 1, 3.5);
    clampPan(view);
    render(slot);
    persist(slot);
  }, { passive: false });

  let dragging = false;
  let last = null;

  slot.addEventListener("pointerdown", (event) => {
    if (!view.src || event.target.closest(".slot-tools")) return;
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    slot.setPointerCapture(event.pointerId);
  });

  slot.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = slot.getBoundingClientRect();
    view.tx += ((event.clientX - last.x) / rect.width) * 100;
    view.ty += ((event.clientY - last.y) / rect.height) * 100;
    last = { x: event.clientX, y: event.clientY };
    clampPan(view);
    render(slot);
  });

  slot.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    slot.releasePointerCapture(event.pointerId);
    persist(slot);
  });
}

function render(slot) {
  const view = slot._view;
  const img = slot._img;
  if (view.src) {
    img.src = view.src;
    img.style.transform =
      "scale(" + view.zoom + ") translate(" + view.tx + "%, " + view.ty + "%)";
    slot.classList.add("filled");
  } else {
    img.removeAttribute("src");
    slot.classList.remove("filled");
  }
}

function persist(slot) {
  const view = slot._view;
  state.slots[slot.dataset.slot] = {
    src: view.src,
    zoom: view.zoom,
    tx: view.tx,
    ty: view.ty,
  };
  saveState();
}

/* 拖入的图先降到 1800px 宽再存，避免 localStorage 溢出 */
function readImage(file, slot) {
  const reader = new FileReader();
  reader.onload = () => {
    const probe = new Image();
    probe.onload = () => {
      const maxW = 1800;
      const ratio = Math.min(1, maxW / probe.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(probe.naturalWidth * ratio);
      canvas.height = Math.round(probe.naturalHeight * ratio);
      canvas.getContext("2d").drawImage(probe, 0, 0, canvas.width, canvas.height);
      slot._view.src = canvas.toDataURL("image/jpeg", 0.94);
      slot._view.zoom = 1;
      slot._view.tx = 0;
      slot._view.ty = 0;
      render(slot);
      persist(slot);
    };
    probe.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clampPan(view) {
  const limit = ((view.zoom - 1) / view.zoom) * 50;
  view.tx = clamp(view.tx, -limit, limit);
  view.ty = clamp(view.ty, -limit, limit);
}

/* ---------------- Tweaks ---------------- */

const HOOKS = [
  "文件名里<br>看不出<br>笔记写了什么",
  "存了一堆笔记<br>从来<br>没再打开过",
  "相关的笔记<br>散在<br>五个文件夹里",
  "找一篇笔记<br>要切回<br>文件浏览器",
];

const CTAS = {
  store: "插件市场<br>搜 Card Workspace",
  github: "GitHub Release<br>下载即用",
};

const els = {
  hook: document.getElementById("hookSelect"),
  palette: document.getElementById("paletteSelect"),
  cta: document.getElementById("ctaSelect"),
  grain: document.getElementById("grainToggle"),
  brand: document.getElementById("brandToggle"),
  scale: document.getElementById("scaleRange"),
  scaleVal: document.getElementById("scaleVal"),
};

const settings = Object.assign(
  { hook: "0", palette: "mist", cta: "store", grain: true, brand: true, scale: 34 },
  state.settings
);

function applySettings() {
  document.getElementById("coverHook").innerHTML = HOOKS[Number(settings.hook)];
  document.getElementById("ctaTitle").innerHTML = CTAS[settings.cta];
  document.body.dataset.palette = settings.palette;
  document.body.classList.toggle("no-grain", !settings.grain);
  document.body.classList.toggle("no-brand", !settings.brand);
  document.documentElement.style.setProperty("--s", settings.scale / 100);
  els.scaleVal.textContent = settings.scale + "%";

  els.hook.value = settings.hook;
  els.palette.value = settings.palette;
  els.cta.value = settings.cta;
  els.grain.checked = settings.grain;
  els.brand.checked = settings.brand;
  els.scale.value = settings.scale;

  state.settings = settings;
  saveState();
}

els.hook.addEventListener("change", () => set("hook", els.hook.value));
els.palette.addEventListener("change", () => set("palette", els.palette.value));
els.cta.addEventListener("change", () => set("cta", els.cta.value));
els.grain.addEventListener("change", () => set("grain", els.grain.checked));
els.brand.addEventListener("change", () => set("brand", els.brand.checked));
els.scale.addEventListener("input", () => set("scale", Number(els.scale.value)));

function set(key, value) {
  settings[key] = value;
  applySettings();
}

applySettings();

/* ?only=cover|compare|features|cta 单卡查看，?s=100 指定预览百分比 */
const params = new URLSearchParams(location.search);
const only = params.get("only");
if (only) {
  document.querySelectorAll(".unit").forEach((unit) => {
    if (!unit.querySelector('[data-card="' + only + '"]')) unit.hidden = true;
  });
}
if (params.get("s")) {
  document.documentElement.style.setProperty(
    "--s",
    clamp(Number(params.get("s")), 5, 100) / 100
  );
}

document.getElementById("clearSlots").addEventListener("click", () => {
  state.slots = {};
  saveState();
  location.href = location.href;
});

/* ---------------- 面板开合 ---------------- */

function togglePanel(id) {
  const panel = document.getElementById(id);
  const other = document.getElementById(id === "tweaks" ? "deck" : "tweaks");
  other.hidden = true;
  panel.hidden = !panel.hidden;
}

document.getElementById("toggleTweaks").addEventListener("click", () => togglePanel("tweaks"));
document.getElementById("copyDeck").addEventListener("click", () => togglePanel("deck"));

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.close).hidden = true;
  });
});

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = document.getElementById("copy-" + btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch (err) {
      toast("复制失败，请手动选中");
      console.warn(err);
    }
  });
});

/* ---------------- 导出 ---------------- */

const FILENAMES = {
  cover: "01-封面",
  compare: "02-对比",
  features: "03-功能",
  cta: "04-结尾",
};

document.querySelectorAll("[data-download]").forEach((btn) => {
  btn.addEventListener("click", () => exportCard(btn.dataset.download));
});

document.getElementById("downloadAll").addEventListener("click", async () => {
  for (const key of Object.keys(FILENAMES)) {
    await exportCard(key);
    await wait(450);
  }
});

async function exportCard(key) {
  const card = document.querySelector('[data-card="' + key + '"]');
  if (!card || typeof htmlToImage === "undefined") {
    toast("导出组件没加载成功（需要联网）");
    return;
  }
  document.body.classList.add("exporting");
  try {
    const url = await htmlToImage.toPng(card, {
      width: CARD_W,
      height: CARD_H,
      pixelRatio: 1,
      backgroundColor: "#faf7f1",
      style: { transform: "none", transformOrigin: "top left" },
      filter: (node) => !(node.classList && node.classList.contains("slot-tools")),
    });
    const link = document.createElement("a");
    link.download = "card-workspace-xhs-" + FILENAMES[key] + ".png";
    link.href = url;
    link.click();
  } catch (err) {
    toast("导出失败，见 console");
    console.error(err);
  } finally {
    document.body.classList.remove("exporting");
  }
}

/* ---------------- 小工具 ---------------- */

function num(saved, attr, fallback) {
  const value = saved !== undefined ? saved : attr;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer = null;
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}
