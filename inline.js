"use strict";

// ── State ─────────────────────────────────────────────────────────────────────

var allImages    = [];   // { e: url, t: tag, type: string, card: Element }
var activeTypes  = new Set();  // active type filters (empty = show all)
var lightboxUrl  = null;
var currentSort = "resolution";
var sortAsc     = false;  // false = descending (biggest first)

var maxArea   = 1;
var maxWidth  = 1;
var maxHeight = 1;
var loadedCount   = 0;
var totalExpected = 0;

var GAP      = 16;
var MAX_CARD = 560;
var WRAP_RATIO = 0.75;  // wrapH = cardW * ratio

function computeCardWidth(cols) {
    var mainEl    = document.getElementById("main");
    var available = mainEl ? mainEl.clientWidth : window.innerWidth - 80;
    var w = Math.floor((available - (cols - 1) * GAP) / cols);
    return Math.min(w, MAX_CARD);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function isDataUrl(url) {
    return url.startsWith("data:");
}

function getDataMime(url) {
    // data:[mime];base64,... or data:[mime],... (no charset)
    var withoutPrefix = url.slice(5); // remove "data:"
    var mime = withoutPrefix.split(";")[0].split(",")[0];
    return mime;
}

function getFileType(url) {
    if (isDataUrl(url)) {
        var mime = getDataMime(url);
        var map  = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP",
                     "image/gif": "GIF", "image/svg+xml": "SVG", "image/avif": "AVIF" };
        return map[mime] || "IMG";
    }
    try {
        var path = new URL(url).pathname.toLowerCase().split("?")[0].split("#")[0];
        var ext  = path.split(".").pop();
        var map  = {
            jpg: "JPG", jpeg: "JPG", png: "PNG", webp: "WEBP",
            gif: "GIF", svg: "SVG", avif: "AVIF", bmp: "BMP", ico: "ICO"
        };
        return map[ext] || "IMG";
    } catch (e) { return "IMG"; }
}

function getFileName(url) {
    if (isDataUrl(url)) {
        var mime = getDataMime(url);
        var ext  = mime.split("/")[1] || "img";
        if (ext === "svg+xml") ext = "svg";
        return "image." + ext;
    }
    try {
        return decodeURIComponent(
            new URL(url).pathname.split("/").pop().split("?")[0]
        ) || "image";
    } catch (e) { return "image"; }
}

function downloadImage(url, filename) {
    var name = filename || getFileName(url);

    if (isDataUrl(url)) {
        try {
            var mime     = getDataMime(url);
            var commaIdx = url.indexOf(",");
            var content  = url.slice(commaIdx + 1);
            var isBase64 = url.slice(5, commaIdx).indexOf("base64") !== -1;
            var blob;
            if (isBase64) {
                var binary = atob(content);
                var bytes  = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                blob = new Blob([bytes], { type: mime });
            } else {
                blob = new Blob([decodeURIComponent(content)], { type: mime });
            }
            var burl = URL.createObjectURL(blob);
            browser.downloads.download({ url: burl, filename: name, saveAs: false })
                .then(function () { setTimeout(function () { URL.revokeObjectURL(burl); }, 10000); })
                .catch(function () { window.open(url, "_blank"); });
        } catch(e) {
            window.open(url, "_blank");
        }
        return;
    }

    browser.downloads.download({
        url:      url,
        filename: name,
        saveAs:   false
    }).catch(function () {
        window.open(url, "_blank");
    });
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024)             return bytes + " B";
    if (bytes < 1024 * 1024)      return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ── File size ──────────────────────────────────────────────────────────────────
// Routed through bg.js which has <all_urls> host permission, bypassing CORS.

function fetchFileSizeViaContentScript(url) {
    return browser.runtime.sendMessage({ nm: "fetchImageSize", url: url })
        .then(function (r) { return r && r.size ? formatSize(r.size) : null; })
        .catch(function () { return null; });
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(url, filename, meta) {
    lightboxUrl = url;
    document.getElementById("lb-img").src      = url;
    document.getElementById("lb-filename").textContent = filename;
    document.getElementById("lb-meta").textContent     = meta || "";
    document.getElementById("lightbox").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeLightbox() {
    document.getElementById("lightbox").classList.add("hidden");
    document.getElementById("lb-img").src = "";
    document.body.style.overflow = "";
    lightboxUrl = null;
}

function initLightbox() {
    document.getElementById("lb-close").addEventListener("click", closeLightbox);

    // click outside image closes
    document.getElementById("lb-img-wrap").addEventListener("click", function (e) {
        if (e.target !== document.getElementById("lb-img")) closeLightbox();
    });

    document.getElementById("lb-download").addEventListener("click", function () {
        if (lightboxUrl) downloadImage(lightboxUrl, getFileName(lightboxUrl));
    });

    document.getElementById("lb-copy").addEventListener("click", function () {
        if (!lightboxUrl) return;
        navigator.clipboard.writeText(lightboxUrl).then(function () {
            flashBtn(document.getElementById("lb-copy"), "[COPIED!]", "[COPY LINK]");
        });
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeLightbox();
    });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

var ordFns = {
    width:      function (a, b) { return (a.naturalW || 0) - (b.naturalW || 0); },
    height:     function (a, b) { return (a.naturalH || 0) - (b.naturalH || 0); },
    resolution: function (a, b) { return (a.naturalW * a.naturalH || 0) - (b.naturalW * b.naturalH || 0); }
};

function sortGallery() {
    var gallery = document.getElementById("gallery");
    if (!gallery || gallery.children.length < 2) return;
    var fn  = ordFns[currentSort];
    var dir = sortAsc ? 1 : -1;
    Array.from(gallery.children).sort(function (a, b) {
        return fn(a, b) * dir;
    }).forEach(function (c) { gallery.appendChild(c); });
}

function setupOrderSelector() {
    var dropdown = document.getElementById("sortDropdown");
    var label    = document.getElementById("sortLabel");
    var btn      = document.getElementById("sortDir");
    var trigger  = document.querySelector(".custom-select-btn");
    if (!dropdown) return;

    var options = [["resolution", "Resolution"], ["width", "Width"], ["height", "Height"]];

    options.forEach(function (pair) {
        var opt = document.createElement("button");
        opt.className        = "custom-select-option";
        opt.dataset.value    = pair[0];
        opt.textContent      = pair[1];
        if (pair[0] === currentSort) {
            opt.classList.add("selected");
            if (label) label.textContent = pair[1];
        }
        opt.addEventListener("click", function () {
            currentSort = pair[0];
            if (label) label.textContent = pair[1];
            dropdown.querySelectorAll(".custom-select-option").forEach(function (o) {
                o.classList.toggle("selected", o.dataset.value === currentSort);
            });
            dropdown.classList.remove("open");
            sortGallery();
        });
        dropdown.appendChild(opt);
    });

    if (trigger) {
        trigger.addEventListener("click", function (e) {
            e.stopPropagation();
            dropdown.classList.toggle("open");
        });
    }

    document.addEventListener("click", function () {
        dropdown.classList.remove("open");
    });

    if (btn) {
        btn.textContent = "↓";
        btn.addEventListener("click", function () {
            sortAsc = !sortAsc;
            btn.textContent = sortAsc ? "↑" : "↓";
            sortGallery();
        });
    }
}

// ── Type filters ──────────────────────────────────────────────────────────────

function rebuildTypeFilters() {
    var types     = new Set(allImages.map(function (i) { return i.type; }));
    var container = document.getElementById("type-filters");
    if (!container) return;
    container.innerHTML = "";
    if (types.size <= 1) return;  // no point showing one-type filter

    Array.from(types).sort().forEach(function (t) {
        var btn       = document.createElement("button");
        btn.className = "type-filter-btn";
        btn.textContent = "[" + t + "]";
        btn.dataset.type = t;
        btn.addEventListener("click", function () {
            if (activeTypes.has(t)) {
                activeTypes.delete(t);
                btn.classList.remove("active");
            } else {
                activeTypes.add(t);
                btn.classList.add("active");
            }
            applyFilters();
        });
        container.appendChild(btn);
    });
}

function applyFilters() {
    document.querySelectorAll(".imCt").forEach(function (card) {
        var show = activeTypes.size === 0 || activeTypes.has(card.dataset.type);
        card.classList.toggle("hidden", !show);
    });
    updateResultCount();
}

// ── Result count ──────────────────────────────────────────────────────────────

function updateResultCount() {
    var total   = allImages.length;
    var visible = document.querySelectorAll(".imCt:not(.hidden)").length;
    var el      = document.getElementById("result-count");
    if (!el) return;
    if (activeTypes.size > 0) {
        el.textContent = visible + "/" + total + " Image" + (total !== 1 ? "s" : "");
    } else {
        el.textContent = total + " Image" + (total !== 1 ? "s" : "") + " Found";
    }
}

// ── Bypass auto-open ──────────────────────────────────────────────────────────
// Replaces the old redirect to img.html.
// After all images finish loading, if bypass mode is big/wide/tall and there's
// exactly one winner, auto-open the lightbox for it.

function checkBypassAutoOpen() {
    browser.storage.local.get("bypass").then(function (r) {
        var mode = r.bypass;
        if (!mode || mode === "off" || mode === "one") return;

        var selector = {
            big:  ".imCt.largest",
            wide: ".imCt.widest",
            tall: ".imCt.tallest"
        }[mode];
        if (!selector) return;

        var matches = document.querySelectorAll(selector);
        if (matches.length !== 1) return;

        var img = matches[0].querySelector(".img-wrap img");
        if (!img) return;

        var filename = matches[0].querySelector(".titlebar-title");
        var meta     = matches[0].querySelector(".info-value.res-val");
        openLightbox(
            img.src,
            filename ? filename.textContent : getFileName(img.src),
            meta ? meta.textContent + " · " + (matches[0].dataset.type || "") : ""
        );
    });
}

// ── replaceClass helper ───────────────────────────────────────────────────────

function replaceClass(ct, onto, tag) {
    ct.classList.add(onto);
    document.querySelectorAll("." + tag).forEach(function (e)  { e.classList.remove(tag); });
    document.querySelectorAll("." + onto).forEach(function (e) { e.classList.add(tag); });
}

// ── Button flash helper ───────────────────────────────────────────────────────

function flashBtn(btn, tempText, origText) {
    btn.textContent = tempText;
    btn.classList.add("flash");
    setTimeout(function () {
        btn.textContent = origText;
        btn.classList.remove("flash");
    }, 1500);
}

// ── Card creation ─────────────────────────────────────────────────────────────

function makeLiElem(gallery, el, idx) {
    if (!el || !el.e || !el.e.trim().length) {
        onLoadSettled();
        return;
    }

    var ht       = el.e;
    var fileType = getFileType(ht);
    var fileName = getFileName(ht);

    // card
    var ct         = document.createElement("div");
    ct.className   = "imCt";
    ct.idx         = idx;
    ct.naturalW    = 0;
    ct.naturalH    = 0;
    ct.dataset.type = fileType;
    gallery.appendChild(ct);
    allImages.push({ e: ht, t: el.t, type: fileType, card: ct });

    // titlebar
    var tb  = document.createElement("div");
    tb.className = "titlebar";

    var tbt = document.createElement("span");
    tbt.className   = "titlebar-title";
    tbt.textContent = fileName;

    var badge = document.createElement("span");
    badge.className   = "type-badge";
    badge.textContent = fileType;

    tb.appendChild(tbt);
    tb.appendChild(badge);
    ct.appendChild(tb);

    if (el.t === "VIDEO") {
        var vid     = document.createElement("video");
        vid.src     = ht;
        vid.controls = true;
        ct.appendChild(vid);
        onLoadSettled();
        return;
    }

    // image wrap — height computed from card width
    var wrap = document.createElement("div");
    wrap.className = "img-wrap";
    var wrapH = parseInt(gallery.dataset.wrapH) || 280;
    wrap.style.height = wrapH + "px";

    var im = document.createElement("img");
    im.alt = fileName;

    var overlay = document.createElement("div");
    overlay.className = "img-overlay";
    var overlayLabel = document.createElement("i");
    overlayLabel.className   = "ph-light ph-eye img-overlay-label";
    overlay.appendChild(overlayLabel);

    wrap.appendChild(im);
    wrap.appendChild(overlay);
    ct.appendChild(wrap);

    // info row: meta on left, icon actions on right
    var infoRow = document.createElement("div");
    infoRow.className = "info-row";

    var infoMeta = document.createElement("div");
    infoMeta.className = "info-meta";

    var resCell  = makeInfoCell("RES ",  "—", "res-val");
    var sizeCell = makeInfoCell("SIZE ", "—", "size-val");

    infoMeta.appendChild(resCell);
    infoMeta.appendChild(makeInfoSep());
    infoMeta.appendChild(sizeCell);

    var infoActions = document.createElement("div");
    infoActions.className = "info-actions";

    var dlBtn = document.createElement("button");
    dlBtn.className = "icon-btn";
    dlBtn.title     = "Download";
    dlBtn.innerHTML = '<i class="ph-light ph-download-simple"></i>';
    dlBtn.addEventListener("click", function () { downloadImage(ht, fileName); });

    var copyBtn = document.createElement("button");
    copyBtn.className = "icon-btn";
    copyBtn.title     = "Copy link";
    copyBtn.innerHTML = '<i class="ph-light ph-link"></i>';
    copyBtn.addEventListener("click", function () {
        navigator.clipboard.writeText(ht).then(function () {
            copyBtn.innerHTML = '<i class="ph-light ph-check"></i>';
            copyBtn.classList.add("flash");
            setTimeout(function () {
                copyBtn.innerHTML = '<i class="ph-light ph-link"></i>';
                copyBtn.classList.remove("flash");
            }, 1500);
        });
    });

    infoActions.appendChild(dlBtn);
    infoActions.appendChild(copyBtn);

    infoRow.appendChild(infoMeta);
    infoRow.appendChild(infoActions);
    ct.appendChild(infoRow);

    // image load
    im.onload = function () {
        var w = im.naturalWidth;
        var h = im.naturalHeight;

        if (w && h) {
            ct.naturalW = w;
            ct.naturalH = h;
            resCell.querySelector(".res-val").textContent = w + "×" + h + "px";

            var area = w * h;
            if (w >= maxWidth)  { maxWidth  = w;    replaceClass(ct, "width_"  + w,    "widest");  }
            if (area >= maxArea){ maxArea   = area;  replaceClass(ct, "size_"   + area, "largest"); }
            if (h >= maxHeight) { maxHeight = h;     replaceClass(ct, "height_" + h,    "tallest"); }
        }

        onLoadSettled();
    };

    im.onerror = function () {
        var errMsg       = document.createElement("div");
        errMsg.className = "load-error";
        errMsg.textContent = "LOAD_ERROR";
        wrap.innerHTML   = "";
        wrap.appendChild(errMsg);
        onLoadSettled();
    };

    // open lightbox on click
    wrap.addEventListener("click", function () {
        var meta = (ct.naturalW ? ct.naturalW + "×" + ct.naturalH + "px · " : "") + fileType;
        openLightbox(ht, fileName, meta);
    });

    im.src = ht;

    // file size via content script fetch (page-origin, no CORS issue)
    var sizeValEl = sizeCell.querySelector(".size-val");
    fetchFileSizeViaContentScript(ht).then(function (sz) {
        if (sz && sizeValEl) sizeValEl.textContent = sz;
    });
}

function makeInfoCell(labelText, valueText, valueClass) {
    var cell = document.createElement("div");
    cell.className = "info-cell";

    var lbl = document.createElement("span");
    lbl.className   = "info-label";
    lbl.textContent = labelText;

    var val = document.createElement("span");
    val.className   = "info-value " + valueClass;
    val.textContent = valueText;

    cell.appendChild(lbl);
    cell.appendChild(val);
    return cell;
}

function makeInfoSep() {
    var s = document.createElement("span");
    s.className   = "info-sep";
    s.textContent = "/";
    return s;
}

// Called when each image settles (load or error).
// When all are settled, normalize sizes, sort, then run bypass check.
function onLoadSettled() {
    if (++loadedCount >= totalExpected) {
        normalizeImageSizes();
        sortGallery();
        checkBypassAutoOpen();
    }
}

// Scale each image within its fixed card proportional to sqrt(area / maxArea).
// Both width and height in px so scaling is consistent regardless of parent size.
function normalizeImageSizes() {
    if (maxArea <= 1) return;
    var gallery = document.getElementById("gallery");
    var cardW   = parseInt(gallery.dataset.cardW) || MAX_CARD;
    var wrapH   = parseInt(gallery.dataset.wrapH) || Math.round(MAX_CARD * WRAP_RATIO);
    var maxSide = Math.sqrt(maxArea);
    allImages.forEach(function (entry) {
        var card = entry.card;
        if (!card || !card.naturalW || !card.naturalH) return;
        var scale = Math.sqrt(card.naturalW * card.naturalH) / maxSide;
        var el    = card.querySelector(".img-wrap img");
        if (!el) return;
        el.style.width  = Math.round(scale * cardW) + "px";
        el.style.height = Math.round(scale * wrapH) + "px";
    });
}

// ── Download All ──────────────────────────────────────────────────────────────

function downloadAll() {
    var imgs = Array.from(document.querySelectorAll(".imCt:not(.hidden) .img-wrap img"));
    imgs.forEach(function (img, i) {
        setTimeout(function () {
            downloadImage(img.src, getFileName(img.src));
        }, i * 400);
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener("load", function () {
    document.title = browser.i18n.getMessage("resultsPageTitle") || "USHIRO // TERMINAL";

    setupOrderSelector();
    initLightbox();

    document.getElementById("download-all").addEventListener("click", downloadAll);

    // pull images from the originating tab
    browser.tabs.getCurrent().then(function (self) {
        var oti = self.openerTabId;
        if (!oti) return;

        browser.tabs.get(oti).then(function (tab) {
            document.title += " [" + tab.title + "]";
        });

        browser.tabs.sendMessage(oti, { nm: "fetchClickedElements" }).then(function (v) {
            var gallery = document.getElementById("gallery");

            if (v && v.el && v.el.length) {
                totalExpected = v.el.length;
                var cols  = Math.min(v.el.length, 4);
                var cardW = computeCardWidth(cols);
                var wrapH = Math.round(cardW * WRAP_RATIO);
                if (cols <= 2) {
                    gallery.style.width = (cols * cardW + (cols - 1) * GAP) + "px";
                    gallery.style.margin = "0 auto";
                    gallery.style.gridTemplateColumns = "repeat(" + cols + ", " + cardW + "px)";
                } else {
                    gallery.style.width  = "";
                    gallery.style.margin = "";
                    gallery.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
                }
                gallery.dataset.cardW = cardW;
                gallery.dataset.wrapH = wrapH;
                v.el.forEach(function (x, i) { makeLiElem(gallery, x, i); });
                rebuildTypeFilters();
                updateResultCount();
            } else {
                totalExpected = 0;
                var msg       = document.createElement("div");
                msg.id        = "empty-msg";
                msg.textContent = browser.i18n.getMessage("errorNoImages") || "NO_IMAGES_FOUND";
                gallery.appendChild(msg);
                updateResultCount();
            }
        });
    });

    browser.permissions.contains({ permissions: ["history"] }).then(function (allowed) {
        if (allowed) browser.history.deleteUrl({ url: window.location.href });
    });
});
