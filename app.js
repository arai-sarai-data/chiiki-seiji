/* 住所から見る 地域の政治とお金 — 外部ライブラリなし（グラフは自前のHTML/SVG）
   ルール：数字は元データからそのまま計算。全政党・全議員に同じ計算と同じ見せ方。断定や評価の言葉は使わない。 */
(function () {
  "use strict";

  var DATA = "data/";
  var S = { prefs: null, districts: null, members: null, meta: null, pc: null, ptags: null, pref: {}, votesHr: null, votesHc: null, finance: {}, finIndex: null };
  var SEIJISHIKIN_TOP = "https://www.soumu.go.jp/senkyo/seiji_s/seijishikin/";
  var SEIJISHIKIN_SG = "https://www.soumu.go.jp/senkyo/seiji_s/seijishikin/reports/SS20251128/SG/index.html";
  var KESSAN_URL = "https://www.soumu.go.jp/iken/kessan_jokyo_2.html";
  var FIN_REPO = "https://github.com/arai-sarai-data/zenkoku-jichitai-db";
  var SMRI_HR = "https://github.com/smartnews-smri/house-of-representatives";
  var SMRI_HC = "https://github.com/smartnews-smri/house-of-councillors";
  var ELEC_SRC = "https://github.com/ryomakom/lower_election_district2026";
  var KINDS = { budget: "当初予算", bids: "入札・契約の結果", grants: "自治体独自の補助金" };
  var KIND_SUB = { budget: "予算書・予算の概要など", bids: "入札結果・契約の公表", grants: "補助金・助成金の案内" };
  var BLOCKS = ["北海道", "東北", "北関東", "南関東", "東京", "北陸信越", "東海", "近畿", "中国", "四国", "九州"];
  var TERM_BUCKETS = [{ id: "t1", label: "当選1回", lo: 1, hi: 1 }, { id: "t2", label: "当選2〜3回", lo: 2, hi: 3 }, { id: "t4", label: "当選4〜6回", lo: 4, hi: 6 }, { id: "t7", label: "当選7回以上", lo: 7, hi: 99 }];
  var SLUG = { "自民": "jimin", "立憲": "rikken", "維新": "ishin", "公明": "komei", "国民": "kokumin", "共産": "kyosan", "参政": "sansei", "中道": "chudo", "みらい": "mirai", "社民": "shamin", "保守": "hoshu", "いのち": "inochi", "沖縄の風": "okinawa", "その他": "other", "無所属": "mushozoku" };
  var FAM_YOMI = { "自民": "じみん じゆうみんしゅとう", "立憲": "りっけん りっけんみんしゅ", "維新": "いしん にっぽんいしんのかい", "公明": "こうめい こうめいとう", "国民": "こくみん こくみんみんしゅとう", "共産": "きょうさん にほんきょうさんとう", "参政": "さんせい さんせいとう", "中道": "ちゅうどう", "みらい": "みらい ちーむみらい", "社民": "しゃみん しゃかいみんしゅとう", "保守": "ほしゅ にほんほしゅとう", "いのち": "いのち いのちのとう", "沖縄の風": "おきなわのかぜ", "無所属": "むしょぞく" };
  var HASHTAG = "地域の政治とお金";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function fmt(n) { return Number(n).toLocaleString("ja-JP"); }
  function pct(a, b, d) { return b ? (a / b * 100).toFixed(d == null ? 0 : d) : "—"; }
  function link(url, text, cls) {
    if (!url) return esc(text || "");
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener"' + (cls ? ' class="' + cls + '"' : "") + ">" + esc(text || url) + "</a>";
  }
  function src(url, text) { return '<a class="src" href="' + esc(url) + '" target="_blank" rel="noopener">出典：' + esc(text) + "</a>"; }
  function shortUrl(u) { return String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); }
  function pending(what, srcText, plan) {
    return '<details class="pending"><summary><span class="muted-pill">未取得</span> ' + esc(what) + "</summary><p>データ源: " + srcText + "。" + esc(plan || "GitHub Actionsで取得予定") + "。</p></details>";
  }
  function getJSON(path) {
    return fetch(DATA + path).then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
  }
  function each(sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); }
  function store(k, v) { try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { return null; } return null; }

  // ---------- 住所用の正規化
  function norm(s) {
    s = (s || "").normalize ? (s || "").normalize("NFKC") : s || "";
    return s.replace(/[\s　]/g, "").replace(/[‐‑‒–—―−ｰー－]/g, "-").replace(/ヶ/g, "ケ").replace(/ヵ/g, "カ");
  }
  function kanji(n) {
    var d = "〇一二三四五六七八九";
    n = parseInt(n, 10);
    if (isNaN(n) || n <= 0 || n >= 100) return null;
    if (n < 10) return d[n];
    var t = Math.floor(n / 10), o = n % 10;
    return (t === 1 ? "" : d[t]) + "十" + (o ? d[o] : "");
  }
  function digitsToKanji(s) { return s.replace(/(\d+)(?=丁目|条|線|番町|区|号)/g, function (m, n) { return kanji(n) || m; }); }
  function townKey(t) { return norm(t).replace(/^大字/, "").replace(/^字/, ""); }

  // ---------- 検索用の正規化（表記ゆれ・カタカナ→ひらがな・旧字体）
  var VARIANT = { "髙": "高", "﨑": "崎", "嵜": "崎", "邊": "辺", "邉": "辺", "齋": "斎", "齊": "斎", "澤": "沢", "濱": "浜", "廣": "広", "櫻": "桜", "眞": "真", "國": "国", "德": "徳", "惠": "恵", "壽": "寿", "藏": "蔵", "龍": "竜", "瀨": "瀬", "條": "条", "淵": "渕", "冨": "富", "槇": "槙", "ヶ": "ケ", "ヵ": "カ" };
  function snorm(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFKC");
    s = s.toLowerCase().replace(/[\s　・,，、。．.「」『』（）()〈〉【】\-‐－ー―]/g, function (c) { return c === "ー" ? "ー" : ""; });
    s = s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    return s.replace(/[髙﨑嵜邊邉齋齊澤濱廣櫻眞國德惠壽藏龍瀨條淵冨槇ヶヵ]/g, function (c) { return VARIANT[c] || c; });
  }
  function hash36(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  // ---------- 政党カラー（全サイト共通ファイル。match を上から順に部分一致）
  var famCache = {};
  function fam(name) {
    name = name || "";
    if (famCache[name]) return famCache[name];
    var F = S.pc.families, hit = null;
    for (var i = 0; i < F.length && !hit; i++) {
      for (var j = 0; j < F[i].match.length; j++) if (name.indexOf(F[i].match[j]) >= 0) { hit = F[i]; break; }
    }
    if (!hit) hit = F.filter(function (f) { return f.family === "その他"; })[0] || F[F.length - 1];
    famCache[name] = hit;
    return hit;
  }
  function lum(hex) {
    var c = hex.replace("#", ""), v = [0, 2, 4].map(function (i) { var x = parseInt(c.substr(i, 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function onColor(hex) { var L = lum(hex); return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#000000"; }
  function famSlug(f) { return SLUG[f.family] || "f" + S.pc.families.indexOf(f); }
  function famBySlug(slug) { return S.pc.families.filter(function (f) { return famSlug(f) === slug; })[0]; }
  // 短い表示名：政党の略称。「その他」に入る会派は会派名そのもの
  function shortName(kaiha) { var f = fam(kaiha); return f.family === "その他" ? kaiha : f.family; }
  // 政党バッジ（色＋名前。色だけに頼らない）
  function badge(kaiha, opt) {
    opt = opt || {};
    var f = fam(kaiha), label = opt.full ? kaiha : shortName(kaiha);
    var st = "--pc:" + f.color + ";--pt:" + onColor(f.color);
    var cls = "pb" + (opt.big ? " pb-big" : "") + (opt.sm ? " pb-sm" : "");
    var t = opt.full || label === kaiha ? "" : ' title="' + esc(kaiha) + '"';
    if (opt.link === false) return '<span class="' + cls + '" style="' + st + '"' + t + ">" + esc(label) + "</span>";
    return '<a class="' + cls + '" style="' + st + '" href="#party-' + famSlug(f) + '"' + t + ">" + esc(label) + "</a>";
  }
  function famBadge(f, label, opt) {
    opt = opt || {};
    var st = "--pc:" + f.color + ";--pt:" + onColor(f.color);
    return '<a class="pb' + (opt.big ? " pb-big" : "") + '" style="' + st + '" href="#party-' + famSlug(f) + '">' + esc(label || f.family) + "</a>";
  }
  // 選挙データの党派略称で、意味が明らかなものだけ読み替える（それ以外は元データの表記のまま）
  // 色表の match は正式名で書かれているため、選挙データの略称を正式名に戻してから照合する
  var EP = { "無所": "無所属", "参政": "参政党", "国民": "国民民主党", "保守": "日本保守党", "みらい": "チームみらい" };
  function ep(p) { return EP[p] || p; }
  function dot(color) { return '<i class="sw" style="background:' + color + '"></i>'; }

  // ---------- ツールチップ
  var tip = $("tip");
  function tipShow(ev, build) { tip.innerHTML = ""; build(tip); tip.hidden = false; tipMove(ev); }
  function tipMove(ev) {
    if (tip.hidden) return;
    var x, y;
    if (ev && ev.clientX != null && ev.type.indexOf("focus") < 0) { x = ev.clientX; y = ev.clientY; }
    else { var r = ev.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth;
    var left = Math.min(Math.max(8, x + 14), vw - w - 8);
    var top = y - h - 12; if (top < 8) top = y + 18;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function tipHide() { tip.hidden = true; }
  function tEl(parent, tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; parent.appendChild(e); return e; }
  function tRow(parent, color, value, label) {
    var r = tEl(parent, "div", "tr");
    if (color) { var i = tEl(r, "i"); i.style.background = color; }
    tEl(r, "span", "tv", value); tEl(r, "span", "tl", label);
  }
  function bindTip(root, sel, build) {
    each(sel, function (el) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      el.addEventListener("pointerenter", function (ev) { tipShow(ev, function (t) { build(el, t); }); });
      el.addEventListener("pointermove", tipMove);
      el.addEventListener("pointerleave", tipHide);
      el.addEventListener("focus", function (ev) { tipShow(ev, function (t) { build(el, t); }); });
      el.addEventListener("blur", tipHide);
    }, root);
  }
  window.addEventListener("scroll", tipHide, { passive: true });

  // ---------- コピーとシェア（window.open は使わず、普通の a タグで新規タブ）
  var COPY = {}, copySeq = 0;
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove("on"); }, 1800); }
  function copyText(text, btn) {
    var orig = btn ? btn.textContent : "";
    function done(ok) {
      if (btn) { btn.textContent = ok ? "コピーしました" : "コピーできませんでした"; setTimeout(function () { btn.textContent = orig; }, 1800); }
      toast(ok ? "コピーしました" : "コピーできませんでした。文字を選んでコピーしてください");
    }
    function fallback() {
      try {
        var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); document.body.removeChild(ta); done(ok);
      } catch (e) { done(false); }
    }
    try {
      var pp = document.permissionsPolicy || document.featurePolicy;
      var allowed = !(pp && pp.allowsFeature) || pp.allowsFeature("clipboard-write");
      if (allowed && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  function shareBase() {
    var m = document.querySelector('meta[name="share-base"]'), b = m && m.getAttribute("content");
    if (b) return b;
    if (/^https?:$/.test(location.protocol)) return location.href.split("#")[0];
    return "";
  }
  function shareUrl(hash) { var b = shareBase(); return b ? b + (hash || "") : ""; }
  // text: シェアする文（事実だけ）。hash: このページの場所
  function shareBar(text, hash, opt) {
    opt = opt || {};
    var url = shareUrl(hash == null ? location.hash : hash);
    var t = text + "\n#" + HASHTAG;
    var x = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(t) + (url ? "&url=" + encodeURIComponent(url) : "");
    var id = "c" + (++copySeq); COPY[id] = t + (url ? "\n" + url : "");
    return '<div class="share' + (opt.cls ? " " + opt.cls : "") + '"><a class="btn-x" href="' + esc(x) + '" target="_blank" rel="noopener" aria-label="この内容をXでシェア（新しいタブ）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>Xでシェア</a><button type="button" class="btn-copy" data-copy="' + id + '">文をコピー</button></div>';
  }
  document.addEventListener("click", function (ev) {
    var c = ev.target.closest && ev.target.closest("[data-copy]");
    if (c) { copyText(COPY[c.getAttribute("data-copy")] || "", c); return; }
    var g = ev.target.closest && ev.target.closest("[data-go]");
    if (g) { var t = $(g.getAttribute("data-go")); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    var sk = ev.target.closest && ev.target.closest("[data-skip]");
    if (sk) { ev.preventDefault(); $("view").focus(); }
  });

  // ---------- 起動
  function loading(on) { $("loading").hidden = !on; }
  loading(true);
  Promise.all([getJSON("prefs.json"), getJSON("districts.json"), getJSON("members.json"), getJSON("meta.json"), getJSON("party-colors.json"), getJSON("policy_tags.json"), getJSON("proposals.json").catch(function () { return null; }), getJSON("life_tags.json").catch(function () { return { rules: [] }; })])
    .then(function (a) {
      S.prefs = a[0]; S.districts = a[1]; S.members = a[2]; S.meta = a[3]; S.pc = a[4]; S.ptags = a[5]; S.prop = a[6]; S.ltags = a[7]; S.ltags.rules.forEach(function (r) { LTAG[r.id] = r; });
      loading(false);
      prepMembers();
      computeBadges();
      renderSources();
      initSearch();
      route();
      window.addEventListener("hashchange", route);
    })
    .catch(function (e) { loading(false); $("view").innerHTML = '<div class="wrap"><div class="empty"><b>データを読み込めませんでした</b>' + esc(e.message) + "。パソコンで直接開いた場合は、site/ フォルダで python3 -m http.server を実行してから開いてください。</div></div>"; });

  function getVotes() {
    if (S.votesHr && S.votesHc) return Promise.resolve();
    if (!S._vp) S._vp = Promise.all([getJSON("votes_hr.json"), getJSON("votes_hc.json")]).then(function (a) { S.votesHr = a[0]; S.votesHc = a[1]; prepVotes(); });
    return S._vp;
  }

  // ---------- 議員の下ごしらえ（ID・都道府県・タグ）
  var MEM = [], MEM_BY_ID = {}, PTAG = {}, LTAG = {};
  // 「2（参2）」→「当選2回（参議院2回）」
  function termsTxt(t) { t = String(t || ""); var m = t.match(/^(\d+)（参(\d+)）$/); return m ? "当選" + m[1] + "回（参議院" + m[2] + "回）" : t ? "当選" + t + "回" : ""; }
  function termsN(t) { var m = String(t || "").match(/\d+/); return m ? +m[0] : 0; }
  function prepMembers() {
    var M = S.members;
    S.ptags.rules.forEach(function (r) { PTAG[r.id] = r; });
    [["hr", M.hr], ["hc", M.hc]].forEach(function (p) {
      p[1].forEach(function (m) {
        var id = hash36(p[0] + m.name).slice(0, 6);
        while (MEM_BY_ID[id]) id += "x";
        var o = { id: id, house: p[0], m: m, name: m.name, y: m.y || "", kaiha: m.kaiha, f: fam(m.kaiha), terms: termsN(m.terms) };
        if (p[0] === "hr") {
          if (m.district) { var pn = +m.district.slice(0, 2); o.pi = pn; o.pref = S.prefs[pn - 1] ? S.prefs[pn - 1].name : ""; o.where = dname(m.district); o.sel = "小選挙区"; }
          else { o.block = m.block; o.where = "比例 " + m.block + "ブロック"; o.sel = "比例代表"; }
        } else {
          if (m.prefs && m.prefs.length) { o.pref = m.prefs[0]; o.pi = prefIndex(m.prefs[0]); o.where = (m.senkyoku || m.prefs.join("・")) + "選挙区"; o.sel = "選挙区"; }
          else { o.where = "比例代表（全国）"; o.sel = "比例代表"; }
        }
        o.key = snorm(m.name) + "|" + snorm(o.y);
        MEM.push(o); MEM_BY_ID[id] = o;
      });
    });
  }
  function prefIndex(name) { for (var i = 0; i < S.prefs.length; i++) if (S.prefs[i].name === name) return i + 1; return 0; }
  function dname(code) { return (S.districts[code] && S.districts[code].name) || code; }
  function houseName(h) { return h === "hr" ? "衆議院" : "参議院"; }
  function memTags(o) {
    var t = [{ id: "house-" + o.house, label: houseName(o.house) }];
    if (o.pi) t.push({ id: "pref-" + o.pi, label: o.pref });
    if (o.block) t.push({ id: "block-" + (BLOCKS.indexOf(o.block) + 1), label: "比例 " + o.block });
    if (o.house === "hc" && !o.pi) t.push({ id: "hcpr", label: "参議院 比例代表" });
    var b = TERM_BUCKETS.filter(function (x) { return o.terms >= x.lo && o.terms <= x.hi; })[0];
    if (b) t.push({ id: "terms-" + b.id, label: b.label });
    return t;
  }
  function tagLinks(tags) { return '<span class="tags">' + tags.map(function (t) { return '<a class="tag" href="#tag-' + t.id + '">' + esc(t.label) + "</a>"; }).join("") + "</span>"; }

  // ---------- 議案の下ごしらえ
  var BILL_BY = { hr: {}, hc: {} };
  function billId(b) { var m = String(b.u || "").match(/([A-Za-z0-9]+)\.htm/); return m ? m[1] : hash36(b.t + b.s + b.dt); }
  function prepVotes() {
    ["hr", "hc"].forEach(function (h) {
      var V = h === "hr" ? S.votesHr : S.votesHc;
      V.bills.forEach(function (b, i) {
        var id = billId(b);
        while (BILL_BY[h][id]) id += "x";
        b.id = id; b.h = h; b.key = snorm(b.t); b.g = b.g || ["none"]; b.lt = b.lt || []; b.ord = i;
        BILL_BY[h][id] = b;
      });
    });
    var V = S.votesHr;
    var maxS = Math.max.apply(null, V.bills.map(function (b) { return b.s; })), cur = {};
    V.bills.forEach(function (b) { if (b.s === maxS) b.y.concat(b.n).forEach(function (i) { cur[i] = 1; }); });
    S.maxS = maxS;
    S.curKaiha = Object.keys(cur).map(Number).sort(function (a, b) { return a - b; });
  }
  function billTags(b) { return '<span class="tags">' + (b.lt || []).map(function (l) { return '<a class="tag tag-life" href="#life-' + l + '">' + esc(LTAG[l] ? LTAG[l].label : l) + "</a>"; }).join("") + b.g.map(function (g) { return '<a class="tag tag-p" href="#tag-p-' + g + '">' + esc(PTAG[g] ? PTAG[g].label : g) + "</a>"; }).join("") + '<span class="auto">自動分類</span></span>'; }
  function stance(b, ki) { return b.y.indexOf(ki) >= 0 ? "y" : b.n.indexOf(ki) >= 0 ? "n" : "u"; }
  var ST_LABEL = { y: "賛成", n: "反対", u: "記録なし" };
  function stPill(s) { return '<span class="st ' + s + '">' + ST_LABEL[s] + "</span>"; }
  function kaihaStats(ki, bills) {
    var y = 0, n = 0, per = {};
    bills.forEach(function (b) {
      var s = stance(b, ki); if (s === "u") return;
      if (!per[b.s]) per[b.s] = [0, 0];
      if (s === "y") { y++; per[b.s][0]++; } else { n++; per[b.s][1]++; }
    });
    return { y: y, n: n, per: per };
  }

  // ---------- 画面の切り替え（ハッシュは #英数字とハイフンだけ）
  var CUR = null;
  function setView(html, title) {
    tipHide();
    $("view").innerHTML = html;
    document.title = (title ? title + "｜" : "") + "住所から見る 地域の政治とお金";
    var key = (location.hash.match(/^#([a-z]+)/) || [])[1] || "top";
    var map = { vs: "vs", vsd: "vs", m: "members", members: "members", party: "parties", parties: "parties", bill: "bills", bills: "bills", life: "bills", rank: "rank", rankings: "rank", tags: "tags", tag: "tags" };
    each(".nav a", function (a) { a.classList.toggle("on", a.getAttribute("data-nav") === map[key]); if (a.getAttribute("data-nav") === map[key]) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function top0() { window.scrollTo(0, 0); }
  function route() {
    var h = location.hash, m;
    closeSuggest();
    if (h === "" || h === "#" || h === "#top") { CUR = null; pageTop(); top0(); return; }
    if ((m = h.match(/^#p(\d{1,2})-c(\d+)(?:-t(\d+))?$/))) { routeAddress(+m[1], +m[2], m[3] != null ? +m[3] : -1); return; }
    CUR = null;
    if (h === "#members") pageMembers();
    else if ((m = h.match(/^#m-([a-z0-9]+)$/))) pageMember(m[1]);
    else if (h === "#parties") pageParties();
    else if ((m = h.match(/^#party-([a-z0-9]+)$/))) pageParty(m[1]);
    else if (h === "#bills") pageBills();
    else if ((m = h.match(/^#bills-l-([a-z]+)$/))) pageBills("", m[1]);
    else if ((m = h.match(/^#bills-p-([a-z]+)$/))) pageBills(m[1], "");
    else if ((m = h.match(/^#life-([a-z]+)$/))) pageLife(m[1]);
    else if (h === "#life") pageLife("");
    else if ((m = h.match(/^#bill-(hr|hc)-([A-Za-z0-9]+)$/))) pageBill(m[1], m[2]);
    else if (h === "#rank") pageRank();
    else if ((m = h.match(/^#rankings(?:-(shitteta|kurashi|senkyo|giin|seito|gian|chiiki))?$/))) { if (RK_SKIP && $("rk-grid")) { RK_SKIP = false; return; } RK_SKIP = false; pageRankings(m[1] || ""); }
    else if ((m = h.match(/^#rank-([a-z0-9]+)$/))) pageRankOne(m[1]);
    else if (h === "#vs") pageVs();
    else if ((m = h.match(/^#vs-([a-z0-9]+)-([a-z0-9]+)$/))) pageVs(m[1], m[2]);
    else if ((m = h.match(/^#vsd-(\d{4})-(\d{4})$/))) pageVsd(m[1], m[2]);
    else if (h === "#tags") pageTags();
    else if ((m = h.match(/^#tag-([a-z0-9-]+)$/))) pageTag(m[1]);
    else if (h === "#search") pageSearch();
    else pageTop();
    top0();
  }

  // ====================================================================== トップ
  function addrPlate(compact) {
    return '<div class="plate' + (compact ? " plate-c" : "") + '" id="addr-form" role="search">' +
      '<label for="addr" class="plate-label">' + (compact ? "別の住所で調べる" : "住所を入れると、あなたの地域の議員が出ます") + "</label>" +
      '<div class="plate-row"><input id="addr" type="search" inputmode="text" autocomplete="off" enterkeyhint="search" placeholder="例：東京都千代田区永田町一丁目" aria-describedby="addr-help"><button type="button" class="go" id="go">調べる</button></div>' +
      '<p id="addr-help" class="plate-help">都道府県から町丁目まで（番地は不要）。住所はこのブラウザの中だけで処理し、どこにも送りません。</p>' +
      (compact ? "" : '<div class="examples" id="examples"><span>試す</span><button type="button" data-ex="東京都千代田区永田町一丁目">千代田区永田町</button><button type="button" data-ex="北海道札幌市北区北十条西">札幌市北区</button><button type="button" data-ex="大阪府大阪市北区梅田">大阪市北区</button><button type="button" data-ex="福井県福井市">福井県福井市</button></div>' +
        '<details class="pickers" id="pickers"><summary>一覧から選ぶ（都道府県 → 市区町村 → 町丁目）</summary><div class="selects"><label>都道府県<select id="sel-pref"><option value="">選んでください</option></select></label><label>市区町村<select id="sel-city" disabled><option value="">—</option></select></label><label>町丁目<select id="sel-town" disabled><option value="">（指定しない）</option></select></label></div></details>') +
      '<div id="msg" class="msg" role="status" aria-live="polite"></div></div>';
  }

  function pageTop() {
    var M = S.members, nAll = M.hr.length + M.hc.length;
    var h = '<section class="hero"><div class="wrap hero-in"><div class="hero-copy">' +
      '<h1 class="hero-h"><span class="hh-1">国会議員 <b>' + fmt(nAll) + '</b>人。</span><span class="hh-2">あなたの地域は、誰？</span></h1>' +
      '<p class="hero-sub">衆議院 ' + fmt(M.hr.length) + "人・参議院 " + fmt(M.hc.length) + "人の名前と政党、会派ごとの議案への賛否、総選挙の得票。すべて公開データから。</p></div>" +
      addrPlate(false) + "</div></section>";
    h += '<div class="wrap">';
    h += '<section class="sec" aria-labelledby="db-h"><div class="sec-head"><h2 id="db-h">データベースで探す</h2><p class="sec-note">全件を検索・絞り込み・並べ替えできます。各ページから原本（衆議院・参議院・総務省など）へリンクしています。</p></div><div class="db-grid">' +
      '<a class="db-tile" href="#members"><b>国会議員</b><span class="db-n">' + fmt(nAll) + '人</span><span>政党・議院・都道府県・当選回数で絞り込み、並べ替え</span></a>' +
      '<a class="db-tile" href="#bills"><b>議案</b><span class="db-n" id="db-bills">衆参の議案</span><span>暮らしテーマ・分野・キーワードで絞り込み、並べ替え。会派ごとの賛否</span></a>' +
      '<a class="db-tile" href="#life"><b>暮らしテーマ</b><span class="db-n">' + (S.ltags ? S.ltags.rules.length : 0) + 'テーマ</span><span>お金・子育て・医療介護・働き方・住まい・議員自身のこと</span></a>' +
      '<a class="db-tile" href="#parties"><b>政党</b><span class="db-n">' + famsPresent().length + '区分</span><span>所属議員、賛成の割合の推移、対決比較</span></a>' +
      '<a class="db-tile" href="#vs"><b>小選挙区</b><span class="db-n">' + Object.keys(S.districts).length + '区</span><span>第51回総選挙の得票。2つの区を並べて比べる</span></a>' +
      '<a class="db-tile" href="#tags"><b>タグ</b><span class="db-n">都道府県・ブロック</span><span>地域ごとの議員と、分類の規則の全文</span></a></div></section>';
    h += '<section class="sec" aria-labelledby="facts-h"><div class="sec-head"><h2 id="facts-h">データから出した事実</h2><p class="sec-note">公開データを集計した結果だけを載せています。各カードの出典から元データを確認できます。</p></div><div class="facts" id="facts"><div class="skeleton"></div></div></section>';
    h += '<section class="sec" aria-labelledby="dyk-h"><div class="sec-head"><h2 id="dyk-h">知ってた？ データで見る国会と選挙</h2><p class="sec-note">公開データを同じ基準で計算した結果です。基準と出典は各ランキングに書いています。</p></div><div class="rk-grid" id="top-dyk"><div class="skeleton"></div></div><p class="more-link"><a href="#rankings-shitteta">「知ってた？」をすべて見る</a>　<a href="#rankings">ランキング集</a></p></section>';
    h += '<section class="sec" aria-labelledby="seat-h"><div class="sec-head"><h2 id="seat-h">衆議院 ' + fmt(M.hr.length) + '人の議席</h2><p class="sec-note">会派ごとの人数。1つの点が1人。並びは人数の多い順。</p></div><div id="top-seats"></div><p class="more-link"><a href="#members">全員の名前を見る</a>　<a href="#parties">政党ごとに見る</a>　<a href="#vs">政党の対決比較</a></p></section>';
    h += '<section class="sec" aria-labelledby="rank-h"><div class="sec-head"><h2 id="rank-h">全政党・全議員を同じ物差しでランキング</h2><p class="sec-note">基準と計算式は各表に書いています。議員個人は上位だけを載せます。</p></div><div class="rtabs" role="tablist" aria-label="ランキングの種類" id="rtabs"></div><div id="rank-one"><div class="skeleton"></div></div><p class="more-link"><a href="#rankings">ランキング集（選挙・議員・政党・議案・地域の切り口）を見る</a></p></section>';
    h += "</div>";
    setView(h, "");
    bindAddr();
    $("top-seats").innerHTML = seatBlock("hr");
    bindSeatTips($("top-seats"));
    getVotes().then(function () {
      if (!$("facts")) return;
      $("facts").innerHTML = factCards();
      if ($("db-bills")) $("db-bills").textContent = fmt(S.votesHr.bills.length + S.votesHc.bills.length) + "件";
      if ($("top-dyk")) $("top-dyk").innerHTML = buildRankings().filter(function (r) { return r.cat === "shitteta"; }).slice(0, 3).map(function (r) { return rkCard(r, { mini: true }); }).join("");
      var R = rankings(), cur = 0;
      $("rtabs").innerHTML = R.map(function (r, i) { return '<button type="button" role="tab" data-r="' + i + '" aria-selected="' + (i === 0) + '">' + esc(r.tab) + "</button>"; }).join("");
      function show(i) {
        cur = i;
        each("#rtabs button", function (b) { b.setAttribute("aria-selected", String(+b.getAttribute("data-r") === i)); });
        $("rank-one").innerHTML = rankHtml(R[i]);
      }
      each("#rtabs button", function (b) { b.addEventListener("click", function () { show(+b.getAttribute("data-r")); }); });
      show(0);
    }).catch(function (e) { if ($("facts")) $("facts").innerHTML = '<div class="empty"><b>議案データを読み込めませんでした</b>' + esc(e.message) + "</div>"; });
  }

  // 事実カード（データから自動で計算）
  function factCards() {
    var M = S.members, V = S.votesHr, D = S.districts, cards = [];
    // 1 最大会派
    var cnt = {}; M.hr.forEach(function (m) { cnt[m.kaiha] = (cnt[m.kaiha] || 0) + 1; });
    var big = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    cards.push({ v: fmt(cnt[big]), u: "人", h: "衆議院 " + fmt(M.hr.length) + "人のうち、" + big + "の人数", b: badge(big, { full: true }), s: (function () { var ks = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }); return "全体の " + pct(cnt[big], M.hr.length) + "%。2位の" + ks[1] + "（" + cnt[ks[1]] + "人）の " + times(cnt[big], cnt[ks[1]]) + "倍"; })(), src: src("https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm", "衆議院 議員一覧（" + (M.meta.hr_asof || "") + "）"), share: "衆議院 " + M.hr.length + "人のうち " + cnt[big] + "人（" + pct(cnt[big], M.hr.length) + "%）が「" + big + "」", hash: "#members" });
    // 2 全会一致の割合
    var un = V.bills.filter(function (b) { return b.how === "全会一致"; }).length;
    cards.push({ v: pct(un, V.bills.length), u: "%", h: "衆議院の議案 " + fmt(V.bills.length) + "件のうち、全会一致だった割合", s: "全会一致 " + fmt(un) + "件／賛否が分かれた " + fmt(V.bills.length - un) + "件（第196回国会以降）", src: src(SMRI_HR, "スマートニュース メディア研究所 国会議案データベース"), share: "衆議院本会議の議案 " + V.bills.length + "件（第196回国会以降）のうち、全会一致は " + un + "件（" + pct(un, V.bills.length) + "%）。残り " + (V.bills.length - un) + "件は会派の賛否が分かれた", hash: "#bills" });
    // 3 最も接戦の小選挙区
    var close = closeRaces()[0];
    if (close) cards.push({ v: fmt(close.diff), u: "票", h: "第51回総選挙で1位と2位の差が最も小さかった小選挙区：" + close.name, b: badge(ep(close.a.party)) + " " + esc(close.a.name) + '<span class="vs">対</span>' + badge(ep(close.b.party)) + " " + esc(close.b.name), s: fmt(close.a.votes) + "票 対 " + fmt(close.b.votes) + "票", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"), share: "2026年の総選挙で最も接戦だった小選挙区は" + close.name + "。" + close.a.name + "（" + close.a.party + "）" + close.a.votes + "票、" + close.b.name + "（" + close.b.party + "）" + close.b.votes + "票。差は " + close.diff + "票", hash: "#rank" });
    // 4 最多得票
    var top = topVotes()[0];
    if (top) cards.push({ v: fmt(top.votes), u: "票", h: "第51回総選挙の小選挙区で得票が最も多かった候補", b: badge(ep(top.party)) + ' <b class="nm-in">' + esc(top.name) + "</b>（" + esc(top.dn) + "）", s: "得票の割合 " + pct(top.votes, top.tot, 1) + "%", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"), share: "2026年の総選挙で、小選挙区の得票が最も多かったのは " + top.name + "（" + top.party + "・" + top.dn + "）の " + top.votes + "票", hash: "#rank" });
    // 5 直近の国会
    var last = V.bills.filter(function (b) { return b.s === S.maxS; });
    var split = last.filter(function (b) { return b.how !== "全会一致"; }).length, rej = last.filter(function (b) { return b.res === "否決"; }).length;
    cards.push({ v: fmt(split), u: "件", h: "第" + S.maxS + "回国会で、会派の賛否が分かれた衆議院の議案", s: "記録のある " + fmt(last.length) + "件のうち。否決は " + fmt(rej) + "件", src: src(SMRI_HR, "国会議案データベース（" + V.asof + "）"), share: "第" + S.maxS + "回国会の衆議院で賛否の記録がある議案 " + last.length + "件のうち、会派の賛否が分かれたのは " + split + "件、否決は " + rej + "件", hash: "#bills" });
    // 6 当選回数
    var vet = MEM.filter(function (o) { return o.house === "hr"; }).sort(function (a, b) { return b.terms - a.terms || a.y.localeCompare(b.y, "ja"); });
    var tv = vet[0], ties = vet.filter(function (o) { return o.terms === tv.terms; });
    cards.push({ v: String(tv.terms), u: "回", h: "衆議院で当選回数が最も多い議員" + (ties.length > 1 ? "（" + ties.length + "人）" : ""), b: ties.map(function (o) { return badge(o.kaiha) + ' <a class="nm-in" href="#m-' + o.id + '">' + esc(o.name) + "</a>"; }).join("　"), s: "衆議院の当選回数（名簿の表記どおり）", src: src("https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm", "衆議院 議員一覧"), share: "衆議院で当選回数が最も多いのは " + ties.map(function (o) { return o.name + "（" + shortName(o.kaiha) + "）"; }).join("・") + "の " + tv.terms + "回", hash: "#rank" });
    var wr = winRates();
    if (wr.length) {
      var wb = wr[0], ww = wr[wr.length - 1], wws = wr.filter(function (z) { return z.r === ww.r; });
      cards.push({ v: pct(wb.w, wb.n), u: "%", h: "小選挙区の1位率 ベスト：" + wb.p + "（ワースト" + (wws.length > 1 ? "は同率 " + wws.length + "党" : "は " + ww.p) + " " + pct(ww.w, ww.n) + "%）", b: '<span class="bw best">ベスト</span>' + badge(wb.p, { full: true }) + " " + tierBadge(wb.tier) + '<span class="vs">／</span><span class="bw worst">ワースト</span>' + wws.map(function (z) { return badge(z.p); }).join("") + " " + tierBadge(ww.tier), s: "1位の数÷候補者数（候補者5人以上の政党）。" + wb.p + "は " + wb.n + "人中 " + wb.w + "区で1位", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"), share: "2026年総選挙 小選挙区の1位率（1位の数÷候補者数）ベストは" + wb.p + " " + pct(wb.w, wb.n) + "%、ワーストは" + wws.map(function (z) { return z.p; }).join("・") + " " + pct(ww.w, ww.n) + "%", hash: "#rank" });
    }
    if (S.prop) {
      var pk = propKaiha()[0];
      cards.push({ v: fmt(pk.n), u: "件", h: "議員立法（衆法）の提出が最も多い会派（第" + S.prop.from + "回国会以降）", b: badge(pk.k, { full: true }), s: "全 " + fmt(S.prop.n_bills) + "件のうち（共同提出を含む）。与党は内閣提出の法律案が中心", src: src(SMRI_HR, "国会議案データベース：衆議院"), share: "議員立法（衆法）の提出が最も多い会派は「" + pk.k + "」の " + pk.n + "件（第" + S.prop.from + "回国会以降）", hash: "#rank" });
    }
    var P2 = famsPresent().filter(function (x) { return x.f.family !== "その他" && x.f.family !== "無所属"; });
    if (P2.length > 1) cards.push({ v: times(P2[0].n, P2[1].n), u: "倍", h: "国会議員の数：" + P2[0].f.family + " と " + P2[1].f.family + " の差", b: famBadge(P2[0].f) + " " + P2[0].n + "人" + '<span class="vs">対</span>' + famBadge(P2[1].f) + " " + P2[1].n + "人", s: "衆議院と参議院の合計。対決比較で、賛否が同じだった割合も見られます", src: src("https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm", "衆議院・参議院 議員名簿"), share: "国会議員の数は " + P2[0].f.family + " " + P2[0].n + "人、" + P2[1].f.family + " " + P2[1].n + "人。その差 " + times(P2[0].n, P2[1].n) + "倍", hash: "#vs-" + famSlug(P2[0].f) + "-" + famSlug(P2[1].f), more: '<a class="more-in" href="#vs-' + famSlug(P2[0].f) + "-" + famSlug(P2[1].f) + '">対決比較を見る</a>' });
    return cards.map(function (c) {
      return '<article class="fact"><p class="fact-h">' + esc(c.h) + '</p><p class="fact-v"><b>' + esc(c.v) + "</b><small>" + esc(c.u) + "</small></p>" + (c.b ? '<p class="fact-b">' + c.b + "</p>" : "") + '<p class="fact-s">' + esc(c.s) + "</p>" + (c.more || "") + c.src + shareBar(c.share, c.hash) + "</article>";
    }).join("");
  }

  // ---------- ランキング（すべて同じ計算を全会派・全議員に）
  function closeRaces() {
    var out = [];
    Object.keys(S.districts).forEach(function (k) {
      var r = (S.districts[k].result2026 || []).slice().sort(function (a, b) { return b.votes - a.votes; });
      if (r.length < 2) return;
      out.push({ code: k, name: S.districts[k].name, a: r[0], b: r[1], diff: r[0].votes - r[1].votes });
    });
    return out.sort(function (a, b) { return a.diff - b.diff || a.code.localeCompare(b.code); });
  }
  function topVotes() {
    var out = [];
    Object.keys(S.districts).forEach(function (k) {
      var r = S.districts[k].result2026 || [], tot = r.reduce(function (s, x) { return s + x.votes; }, 0);
      r.forEach(function (x) { out.push({ name: x.name, party: x.party, votes: x.votes, dn: S.districts[k].name, code: k, tot: tot }); });
    });
    return out.sort(function (a, b) { return b.votes - a.votes; });
  }
  function splitBills() {
    return S.votesHr.bills.filter(function (b) { return b.y.length && b.n.length; }).slice().sort(function (a, b) {
      return Math.min(b.y.length, b.n.length) - Math.min(a.y.length, a.n.length) || Math.abs(a.y.length - a.n.length) - Math.abs(b.y.length - b.n.length) || b.s - a.s;
    });
  }
  function kaihaRates() {
    var V = S.votesHr;
    return S.curKaiha.map(function (ki) { var st = kaihaStats(ki, V.bills); return { ki: ki, k: V.kaiha[ki], y: st.y, n: st.n, r: st.y / Math.max(1, st.y + st.n) }; })
      .sort(function (a, b) { return b.r - a.r || (b.y + b.n) - (a.y + a.n); });
  }
  function rankNo(list, val) { var r = [], prev = null, rank = 0; list.forEach(function (x, i) { var v = val(x); if (v !== prev) rank = i + 1; prev = v; r.push(rank); }); return r; }
  function rankings() {
    var V = S.votesHr, R = [];
    var sb = splitBills().slice(0, 10);
    R.push({ id: "split", tab: "賛否が割れた議案", title: "賛否が割れた衆議院の議案 TOP10", note: "賛成した会派の数と反対した会派の数の、少ないほうが多い順（同じなら差が小さい順、新しい順）。第196回国会以降 " + fmt(V.bills.length) + "件から。", src: src(SMRI_HR, "国会議案データベース：衆議院（" + V.asof + "）"),
      rows: sb.map(function (b, i) {
        return { no: i + 1, main: '<a class="r-t" href="#bill-hr-' + b.id + '">' + esc(b.t) + "</a>", sub: "第" + b.s + "回国会・" + esc(b.k) + "・" + esc(b.res), val: '<span class="yn"><b>賛成 ' + b.y.length + '</b><span>会派</span></span><span class="yn n"><b>反対 ' + b.n.length + "</b><span>会派</span></span>", extra: '<div class="r-badges"><span class="lab">賛成</span>' + b.y.map(function (k) { return badge(V.kaiha[k], { sm: true }); }).join("") + '</div><div class="r-badges"><span class="lab">反対</span>' + b.n.map(function (k) { return badge(V.kaiha[k], { sm: true }); }).join("") + "</div>" };
      }), share: "賛否が割れた衆議院の議案 1位：" + (sb[0] ? sb[0].t.slice(0, 40) + (sb[0].t.length > 40 ? "…" : "") + "（賛成" + sb[0].y.length + "会派・反対" + sb[0].n.length + "会派）" : "") });
    var kr = kaihaRates(), kn = rankNo(kr, function (x) { return x.r.toFixed(4); });
    R.push({ id: "rate", tab: "会派の賛成率", title: "賛成の割合が高い会派・低い会派（第" + S.maxS + "回国会に記録のある会派）", note: "計算式：賛成の件数 ÷（賛成＋反対の件数）。第196回国会以降、その会派名で記録された議案。高い・低いに良し悪しはありません。会派名が変わる前の記録は含みません。", src: src(SMRI_HR, "国会議案データベース：衆議院（" + V.asof + "）"),
      rows: kr.map(function (x, i) { return { no: kn[i], main: badge(x.k, { full: true }), sub: "賛成 " + fmt(x.y) + "件・反対 " + fmt(x.n) + "件", val: '<b class="big-n">' + pct(x.y, x.y + x.n) + "</b>%", bar: yesBar(x.y, x.n) }; }),
      share: "衆議院 会派ごとの賛成の割合（第196回国会以降）：" + kr.map(function (x) { return shortName(x.k) + " " + pct(x.y, x.y + x.n) + "%"; }).join("、") });
    var cr = closeRaces().slice(0, 10);
    R.push({ id: "close", tab: "接戦の選挙区", title: "1位と2位の差が小さかった小選挙区 TOP10（第51回総選挙）", note: "2026年2月8日の総選挙。小選挙区の得票で、1位と2位の差が小さい順。", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"),
      rows: cr.map(function (x, i) { return { no: i + 1, main: '<span class="r-t">' + esc(x.name) + "</span>", sub: badge(ep(x.a.party), { sm: true }) + " " + esc(x.a.name) + " " + fmt(x.a.votes) + "票　" + badge(ep(x.b.party), { sm: true }) + " " + esc(x.b.name) + " " + fmt(x.b.votes) + "票", val: '<b class="big-n">' + fmt(x.diff) + "</b>票差" }; }),
      share: "2026年総選挙 接戦だった小選挙区：" + cr.slice(0, 3).map(function (x) { return x.name + "（差" + x.diff + "票）"; }).join("、") });
    var tv = topVotes().slice(0, 10);
    R.push({ id: "votes", tab: "得票数", title: "小選挙区の得票が多かった候補 TOP10（第51回総選挙）", note: "候補者ごとの小選挙区の得票数の多い順。", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"),
      rows: tv.map(function (x, i) { var o = memByName(x.name, "hr"); return { no: i + 1, main: badge(ep(x.party)) + " " + (o ? '<a class="r-t nm-in" href="#m-' + o.id + '">' + esc(x.name) + "</a>" : '<span class="r-t nm-in">' + esc(x.name) + "</span>"), sub: esc(x.dn) + "・得票の割合 " + pct(x.votes, x.tot, 1) + "%", val: '<b class="big-n">' + fmt(x.votes) + "</b>票" }; }),
      share: "2026年総選挙 小選挙区の得票が多かった候補：" + tv.slice(0, 3).map(function (x) { return x.name + "（" + x.party + "）" + x.votes + "票"; }).join("、") });
    var vet = MEM.filter(function (o) { return o.house === "hr"; }).sort(function (a, b) { return b.terms - a.terms || a.y.localeCompare(b.y, "ja"); });
    var vn = rankNo(vet, function (o) { return o.terms; }), cut = vet.slice(0, 10), more = vet.filter(function (o, i) { return i >= 10 && vn[i] <= 10; }).length;
    R.push({ id: "terms", tab: "当選回数", title: "衆議院の当選回数が多い議員 TOP10", note: "衆議院の名簿の当選回数（「1（参2）」のような表記は衆議院の回数）。同じ回数は読みの順。" + (more ? "同じ回数の議員がほかに " + more + "人います。" : ""), src: src("https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm", "衆議院 議員一覧（" + (S.members.meta.hr_asof || "") + "）"),
      rows: cut.map(function (o, i) { return { no: vn[i], main: badge(o.kaiha) + ' <a class="r-t nm-in" href="#m-' + o.id + '">' + esc(o.name) + "</a>", sub: esc(o.where), val: '<b class="big-n">' + o.terms + "</b>回" }; }),
      share: "衆議院の当選回数が多い議員：" + cut.slice(0, 3).map(function (o) { return o.name + "（" + shortName(o.kaiha) + "）" + o.terms + "回"; }).join("、") });
    // 政党：小選挙区の1位率（ベスト／ワースト・段階）
    var wr = winRates(), wn = rankNo(wr, function (x) { return x.r.toFixed(5); }), nW = wr.length;
    R.splice(1, 0, { id: "win", tab: "政党の小選挙区1位率", title: "小選挙区の1位率 ベスト／ワースト（政党・第51回総選挙）", note: "計算式：小選挙区で1位になった数 ÷ 小選挙区の候補者数。候補者5人以上の政党が対象（無所属・諸派は政党ではないため除く）。段階：" + TIER_RULE + "。", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"),
      rows: wr.map(function (x, i) { return { no: wn[i], main: badge(x.p, { full: true }) + (wn[i] <= 3 && x.w ? '<span class="bw best">ベスト' + wn[i] + "</span>" : "") + (worstNo(wr, x) <= 3 && wn[i] > 3 ? '<span class="bw worst">ワースト' + worstNo(wr, x) + (wr.filter(function (z) { return z.r === x.r; }).length > 1 ? "（同率）" : "") + "</span>" : ""), sub: "候補者 " + x.n + "人のうち 1位 " + x.w + "区・2位 " + x.second + "区", val: tierBadge(x.tier) + ' <b class="big-n">' + pct(x.w, x.n, 1) + "</b>%", bar: yesBar(x.w, x.n - x.w) }; }),
      share: "2026年総選挙 小選挙区の1位率（1位の数÷候補者数）：" + wr.map(function (x) { return x.p + " " + pct(x.w, x.n) + "%（" + x.tier + "）"; }).join("、") });
    // 得票率（個人は上位のみ）
    var sr = shareRank().slice(0, 10);
    R.push({ id: "share", tab: "得票率", title: "小選挙区の得票率が高かった候補 TOP10（第51回総選挙）", note: "計算式：候補者の得票 ÷ その小選挙区の候補者の得票合計。上位10人だけを載せています。", src: src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）"),
      rows: sr.map(function (x, i) { var o = memByName(x.name, "hr"); return { no: i + 1, main: badge(ep(x.party)) + " " + (o ? '<a class="r-t nm-in" href="#m-' + o.id + '">' + esc(x.name) + "</a>" : '<span class="r-t nm-in">' + esc(x.name) + "</span>"), sub: esc(x.dn) + "・" + fmt(x.votes) + "票", val: '<b class="big-n">' + (x.share * 100).toFixed(1) + "</b>%" }; }),
      share: "2026年総選挙 小選挙区の得票率が高かった候補：" + sr.slice(0, 3).map(function (x) { return x.name + "（" + ep(x.party) + "）" + (x.share * 100).toFixed(1) + "%"; }).join("、") });
    if (S.prop) {
      var pk = propKaiha().slice(0, 10), pkn = rankNo(pk, function (x) { return x.n; });
      R.push({ id: "propk", tab: "議員立法の提出（会派）", title: "議員立法（衆法）の提出が多い会派 TOP10", note: "第" + S.prop.from + "〜" + S.prop.to + "回国会に衆議院議員が提出した法律案 " + fmt(S.prop.n_bills) + "件（委員長提出を除く）。共同提出は各会派に1件ずつ数えます。会派名が変わる前の記録は別の会派です。与党は内閣提出の法律案（閣法）が中心のため、件数が少なくなる仕組みがあります。", src: src(SMRI_HR, "国会議案データベース：衆議院（議案提出会派）"),
        rows: pk.map(function (x, i) { return { no: pkn[i], main: badge(x.k, { full: true }), sub: "", val: '<b class="big-n">' + fmt(x.n) + "</b>件" }; }),
        share: "議員立法（衆法）の提出が多い会派（第" + S.prop.from + "回国会以降）：" + pk.slice(0, 3).map(function (x) { return x.k + " " + x.n + "件"; }).join("、") });
      var pm = propMembers(), pmn = rankNo(pm, function (x) { return x.n; }), pmc = pm.slice(0, 10), pmore = pm.filter(function (x, i) { return i >= 10 && pmn[i] <= 10; }).length;
      R.push({ id: "propm", tab: "議員立法の提出（議員）", title: "議員立法（衆法）の提出者になった回数 TOP10（現在の衆議院議員）", note: "第" + S.prop.from + "回国会以降の衆法で「議案提出者一覧」に名前がある件数（委員長提出を除く）。上位10人だけを載せています。大臣・副大臣などの在任中は議員立法を提出できないため、少ないことに意味はありません。" + (pmore ? "同じ件数の議員がほかに " + pmore + "人います。" : ""), src: src(SMRI_HR, "国会議案データベース：衆議院（議案提出者一覧）"),
        rows: pmc.map(function (x, i) { return { no: pmn[i], main: badge(x.o.kaiha) + ' <a class="r-t nm-in" href="#m-' + x.o.id + '">' + esc(x.o.name) + "</a>", sub: esc(x.o.where), val: '<b class="big-n">' + fmt(x.n) + "</b>件" }; }),
        share: "議員立法（衆法）の提出者になった回数 TOP3（第" + S.prop.from + "回国会以降）：" + pmc.slice(0, 3).map(function (x) { return x.o.name + "（" + shortName(x.o.kaiha) + "）" + x.n + "件"; }).join("、") });
    }
    return R;
  }
  function memByName(name, house) { var k = snorm(name); var c = MEM.filter(function (o) { return (!house || o.house === house) && snorm(o.name) === k; }); return c.length === 1 ? c[0] : null; }
  function yesBar(y, n) {
    var t = y + n || 1;
    return '<span class="ynbar" aria-hidden="true"><i class="y" style="width:' + (y / t * 100).toFixed(1) + '%"></i><i class="n" style="width:' + (n / t * 100).toFixed(1) + '%"></i></span>';
  }
  function rankHtml(r) {
    var h = '<div class="rank" id="rank-' + r.id + '"><h3 class="rank-h">' + esc(r.title) + '</h3><p class="cap">' + esc(r.note) + "</p><ol class=\"rlist\">";
    r.rows.forEach(function (x) {
      h += '<li class="rrow' + (x.no <= 3 ? " top3" : "") + '"><span class="rno">' + x.no + '</span><div class="rmain"><div>' + x.main + '</div><div class="rsub">' + x.sub + "</div>" + (x.extra || "") + (x.bar ? '<div class="rbar">' + x.bar + "</div>" : "") + '</div><div class="rval">' + x.val + "</div></li>";
    });
    return h + "</ol>" + r.src + shareBar("【" + r.title + "】" + r.share, "#rank") + "</div>";
  }
  function pageRank() {
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">ランキング</h1><p class="ph-sub">議案・会派・選挙・議員を、数値の順に並べたものです。並べる基準は各表の下に書いています。切り口ごとのランキングとシェア用のカードは<a href="#rankings">ランキング集</a>にあります。</p></header><div id="rank-all"><div class="skeleton"></div></div></div>';
    setView(h, "ランキング");
    getVotes().then(function () { if ($("rank-all")) $("rank-all").innerHTML = rankings().map(rankHtml).join(""); });
  }

  // ====================================================================== ランキング集（#rankings・#rank-英数字）
  // 1つのランキング＝{ id, cat, title（○○ランキング）, unit, rows[{ no, h（表示HTML）, s（短い文字・シェア用）, v（数値の文字）, u, sub, c（色） }], basis（基準）, src（出典HTML）, tag }
  // 議員個人のランキングは上位だけ。低い順の名指しは政党・組織までで、このページでは「ワースト」の見出しは付けない。
  var RK_CATS = [{ id: "shitteta", label: "知ってた？" }, { id: "kurashi", label: "暮らし" }, { id: "senkyo", label: "選挙" }, { id: "giin", label: "議員" }, { id: "seito", label: "政党" }, { id: "gian", label: "議案" }, { id: "chiiki", label: "地域" }];
  var SITE_NAME = "住所から見る 地域の政治とお金";
  var KOKKAI_GIAN = "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/kokkai/kokkai_gian.htm";
  var HR_LIST = "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm";
  var RK = null, RK_BY = {};
  function catLabel(id) { return (RK_CATS.filter(function (c) { return c.id === id; })[0] || {}).label || ""; }
  function pctN(a, b, d) { return b ? +(a / b * 100).toFixed(d == null ? 1 : d) : 0; }
  // 同じ値は同じ順位
  function numberRows(rows, key) { var no = rankNo(rows, key); rows.forEach(function (r, i) { r.no = no[i]; }); return rows; }
  function famOfParty(p) { return fam(ep(p)); }
  function famLabelBadge(f, label, sm) { return '<span class="pb' + (sm ? " pb-sm" : "") + '" style="--pc:' + f.color + ";--pt:" + onColor(f.color) + '">' + esc(label || f.family) + "</span>"; }
  // 政党キー（proposals.json）→ バッジ。family が決まる政党は family、それ以外は最も多い会派名
  function famByName(n) { return S.pc.families.filter(function (f) { return f.family === n; })[0]; }
  function partyKeyFam(x) { return (x.fam && famByName(x.fam)) || fam(Object.keys(x.kaiha || {})[0] || x.p); }
  function partyKeyBadge(x) { return x.fam && famByName(x.fam) ? famBadge(famByName(x.fam), x.p) : badge(Object.keys(x.kaiha || {})[0] || x.p, { full: true }); }
  function partyKeyColor(x) { return partyKeyFam(x).color; }
  function memLink(o, name) { return o ? '<a class="nm-in" href="#m-' + o.id + '">' + esc(name || o.name) + "</a>" : '<span class="nm-in">' + esc(name) + "</span>"; }
  var ELEC = function () { return src(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙・2026年2月8日）"); };
  var HRSRC = function () { return src(SMRI_HR, "スマートニュース メディア研究所 国会議案データベース：衆議院（" + S.votesHr.asof + "）"); };

  function districtRows() {
    return Object.keys(S.districts).map(function (k) {
      var r = (S.districts[k].result2026 || []).slice().sort(function (a, b) { return b.votes - a.votes; });
      var tot = r.reduce(function (s, x) { return s + x.votes; }, 0);
      return { k: k, d: S.districts[k], r: r, tot: tot, diff: r.length > 1 ? r[0].votes - r[1].votes : r.length ? r[0].votes : 0 };
    });
  }
  function prefMembers() {
    // 都道府県から選ばれた議員：衆議院の小選挙区＋参議院の選挙区（合区は両方の県に数える）
    var P = {};
    MEM.forEach(function (o) {
      var ps = [];
      if (o.house === "hr" && o.m.district) ps = [o.pi];
      if (o.house === "hc" && o.m.prefs) ps = o.m.prefs.map(prefIndex);
      ps.forEach(function (pi) { if (!pi) return; (P[pi] = P[pi] || []).push(o); });
    });
    return P;
  }
  function famCount(list) {
    var c = {};
    list.forEach(function (o) { var f = o.f.family; if (!c[f]) c[f] = { f: o.f, n: 0 }; c[f].n++; });
    return Object.keys(c).map(function (k) { return c[k]; }).sort(function (a, b) { return b.n - a.n || S.pc.families.indexOf(a.f) - S.pc.families.indexOf(b.f); });
  }

  function buildRankings() {
    if (RK) return RK;
    var R = [], V = S.votesHr, D = districtRows(), PR = S.prop;
    function add(r) { r.rows = r.rows || []; R.push(r); RK_BY[r.id] = r; }

    // ---------------- 選挙
    var cl = D.filter(function (x) { return x.r.length > 1; }).sort(function (a, b) { return a.diff - b.diff || a.k.localeCompare(b.k); }).slice(0, 10);
    add({ id: "close", cat: "senkyo", title: "接戦の小選挙区ランキング", unit: "票差", tag: "衆院選",
      basis: "第51回総選挙（2026年2月8日）の小選挙区 " + D.length + " 区を、1位と2位の得票の差が小さい順に並べました。",
      src: ELEC(), rows: numberRows(cl.map(function (x) {
        return { h: '<span class="r-t">' + esc(x.d.name) + "</span>", s: x.d.name + " " + fmt(x.diff) + "票差", v: fmt(x.diff), u: "票差", c: famOfParty(x.r[0].party).color,
          sub: badge(ep(x.r[0].party), { sm: true }) + " " + esc(x.r[0].name) + " " + fmt(x.r[0].votes) + "票／" + badge(ep(x.r[1].party), { sm: true }) + " " + esc(x.r[1].name) + " " + fmt(x.r[1].votes) + "票", diff: x.diff };
      }), function (r) { return r.diff; }) });

    var sr = shareRank().slice(0, 10);
    add({ id: "share", cat: "senkyo", title: "小選挙区の得票率ランキング", unit: "%", tag: "衆院選",
      basis: "第51回総選挙の小選挙区の候補者全員を、得票率（候補者の得票 ÷ その小選挙区の候補者の得票合計）の高い順に並べました。上位10人だけを載せています。",
      src: ELEC(), rows: numberRows(sr.map(function (x) {
        var o = memByName(x.name, "hr"), sh = (x.share * 100).toFixed(1);
        return { h: badge(ep(x.party)) + " " + memLink(o, x.name), s: x.name + "（" + ep(x.party) + "）" + sh + "%", v: sh, u: "%", c: famOfParty(x.party).color, sub: esc(x.dn) + "・" + fmt(x.votes) + "票", k: sh };
      }), function (r) { return r.k; }) });

    var tv = topVotes().slice(0, 10);
    add({ id: "votes", cat: "senkyo", title: "小選挙区の得票数ランキング", unit: "票", tag: "衆院選",
      basis: "第51回総選挙の小選挙区の候補者全員を、得票数の多い順に並べました。上位10人だけを載せています。",
      src: ELEC(), rows: numberRows(tv.map(function (x) {
        var o = memByName(x.name, "hr");
        return { h: badge(ep(x.party)) + " " + memLink(o, x.name), s: x.name + "（" + ep(x.party) + "）" + fmt(x.votes) + "票", v: fmt(x.votes), u: "票", c: famOfParty(x.party).color, sub: esc(x.dn) + "・得票率 " + pct(x.votes, x.tot, 1) + "%", k: x.votes };
      }), function (r) { return r.k; }) });

    var cd = D.slice().sort(function (a, b) { return b.r.length - a.r.length || b.tot - a.tot || a.k.localeCompare(b.k); }).slice(0, 10);
    add({ id: "cands", cat: "senkyo", title: "候補者が多かった小選挙区ランキング", unit: "人", tag: "衆院選",
      basis: "第51回総選挙の小選挙区を、候補者の人数の多い順に並べました（同じ人数は有効票の合計が多い順）。順位は人数だけで決めています。",
      src: ELEC(), rows: numberRows(cd.map(function (x) {
        return { h: '<span class="r-t">' + esc(x.d.name) + "</span>", s: x.d.name + " " + x.r.length + "人", v: String(x.r.length), u: "人", c: "", sub: x.r.map(function (c) { return badge(ep(c.party), { sm: true }); }).join("") + " 有効票 " + fmt(x.tot) + "票", k: x.r.length };
      }), function (r) { return r.k; }) });

    var mu = {};
    D.forEach(function (x) { if (x.r.length < 2) return; var a = famOfParty(x.r[0].party), b = famOfParty(x.r[1].party), la = ep(x.r[0].party), lb = ep(x.r[1].party), key = la + "|" + lb; if (!mu[key]) mu[key] = { a: a, b: b, la: la, lb: lb, n: 0 }; mu[key].n++; });
    var mul = Object.keys(mu).map(function (k) { return mu[k]; }).sort(function (a, b) { return b.n - a.n || a.la.localeCompare(b.la, "ja"); }).slice(0, 10);
    add({ id: "matchup", cat: "senkyo", title: "1位と2位の政党の組み合わせランキング", unit: "区", tag: "衆院選",
      basis: "第51回総選挙の小選挙区ごとに「1位の政党 対 2位の政党」の組み合わせを数え、区の数の多い順に並べました。順番は1位→2位です。",
      src: ELEC(), rows: numberRows(mul.map(function (x) {
        return { h: badge(x.la) + '<span class="vs-x">対</span>' + badge(x.lb), s: shortName(x.la) + "対" + shortName(x.lb) + " " + x.n + "区", v: String(x.n), u: "区", c: x.a.color, c2: x.b.color, sub: "1位 " + esc(x.la) + "・2位 " + esc(x.lb), k: x.n };
      }), function (r) { return r.k; }) });

    // ---------------- 議員
    var vet = hrVeterans(), vn = rankNo(vet, function (o) { return o.terms; });
    var vc = vet.filter(function (o, i) { return vn[i] <= 10; });
    add({ id: "terms", cat: "giin", title: "衆議院の当選回数ランキング", unit: "回", tag: "国会議員",
      basis: "衆議院の名簿の当選回数（「1（参2）」のような表記は衆議院の回数）の多い順。同じ回数は読みの順。10位までに入る人をすべて載せています。",
      src: src(HR_LIST, "衆議院 議員一覧（" + (S.members.meta.hr_asof || "") + "）"), rows: vc.map(function (o, i) {
        return { no: vn[i], h: badge(o.kaiha) + " " + memLink(o), s: o.name + "（" + shortName(o.kaiha) + "）" + o.terms + "回", v: String(o.terms), u: "回", c: o.f.color, sub: esc(o.where) };
      }) });
    var hv = MEM.filter(function (o) { return o.house === "hc"; }).sort(function (a, b) { return b.terms - a.terms || a.y.localeCompare(b.y, "ja"); }), hn = rankNo(hv, function (o) { return o.terms; });
    var hc = hv.filter(function (o, i) { return hn[i] <= 5; });
    add({ id: "hcterms", cat: "giin", title: "参議院の当選回数ランキング", unit: "回", tag: "国会議員",
      basis: "参議院の名簿の当選回数の多い順。同じ回数は読みの順。5位までに入る人をすべて載せています。",
      src: src(SMRI_HC, "スマートニュース メディア研究所 house-of-councillors（" + (S.members.meta.hc_asof || "") + "）"), rows: hc.map(function (o, i) {
        return { no: hn[i], h: badge(o.kaiha) + " " + memLink(o), s: o.name + "（" + shortName(o.kaiha) + "）" + o.terms + "回", v: String(o.terms), u: "回", c: o.f.color, sub: esc(o.where) };
      }) });
    if (PR) {
      var pm = propMembers(), pmn = rankNo(pm, function (x) { return x.n; }), pmc = pm.filter(function (x, i) { return pmn[i] <= 10; });
      add({ id: "propm", cat: "giin", title: "議員立法の提出者ランキング", unit: "件", tag: "議員立法",
        basis: "第" + PR.from + "〜" + PR.to + "回国会の衆法（衆議院議員が提出した法律案）で「議案提出者一覧」に名前がある件数。現在の衆議院議員だけ。委員長提出は除きます。継続審査で再掲された議案は1件と数えます。10位までに入る人をすべて載せています。大臣・副大臣などの在任中は議員立法を提出しません。",
        src: src(SMRI_HR, "国会議案データベース：衆議院（議案提出者一覧）"), rows: pmc.map(function (x, i) {
          return { no: pmn[i], h: badge(x.o.kaiha) + " " + memLink(x.o), s: x.o.name + "（" + shortName(x.o.kaiha) + "）" + x.n + "件", v: fmt(x.n), u: "件", c: x.o.f.color, sub: esc(x.o.where) };
        }) });
    }

    // ---------------- 政党
    var fp = famsPresent().filter(function (x) { return x.f.family !== "無所属"; });
    add({ id: "seats", cat: "seito", title: "政党別 国会議員数ランキング", unit: "人", tag: "国会議員",
      basis: "衆議院と参議院の議員数の合計（会派を全サイト共通の政党カラー表で政党にまとめた数）。無所属・各派に属しない議員は除きます。",
      src: src(HR_LIST, "衆議院 議員一覧（" + (S.members.meta.hr_asof || "") + "）") + " " + src(SMRI_HC, "house-of-councillors（" + (S.members.meta.hc_asof || "") + "）"),
      rows: numberRows(fp.map(function (x) {
        var hr = MEM.filter(function (o) { return o.f === x.f && o.house === "hr"; }).length, hc = x.n - hr;
        return { h: famBadge(x.f, x.f.family === "その他" ? "その他の会派" : x.f.family, { big: true }), s: (x.f.family === "その他" ? "その他" : x.f.family) + " " + x.n + "人", v: String(x.n), u: "人", c: x.f.color, sub: "衆議院 " + hr + "人・参議院 " + hc + "人", k: x.n, bar: [hr, hc], barLab: ["衆議院", "参議院"] };
      }), function (r) { return r.k; }) });

    var wr = winRates();
    add({ id: "winrate", cat: "seito", title: "政党別 小選挙区の1位率ランキング", unit: "%", tag: "衆院選",
      basis: "計算式：小選挙区で1位になった数 ÷ 小選挙区に立てた候補者の数（擁立数）。第51回総選挙。候補者5人以上の政党が対象（無所属・諸派は除く）。擁立数を必ず並べて表示します。",
      src: ELEC(), rows: numberRows(wr.map(function (x) {
        var r1 = pct(x.w, x.n, 1);
        return { h: badge(x.p, { full: true }), s: shortName(x.p) + " " + r1 + "%（" + x.n + "人中" + x.w + "区）", v: r1, u: "%", c: fam(x.p).color, sub: "擁立 " + x.n + "人・1位 " + x.w + "区・2位 " + x.second + "区", k: x.r.toFixed(5), bar: [x.w, x.n - x.w] };
      }), function (r) { return r.k; }) });

    var pv = {}, totAll = 0;
    D.forEach(function (x) { x.r.forEach(function (c, i) { var p = ep(c.party); if (!pv[p]) pv[p] = { p: p, v: 0, w: 0, n: 0 }; pv[p].v += c.votes; pv[p].n++; if (i === 0) pv[p].w++; totAll += c.votes; }); });
    var pvl = Object.keys(pv).map(function (k) { return pv[k]; }).filter(function (x) { return x.p !== "無所属" && x.p !== "諸派"; }).sort(function (a, b) { return b.v - a.v; });
    add({ id: "votesp", cat: "seito", title: "政党別 小選挙区の得票の割合ランキング", unit: "%", tag: "衆院選",
      basis: "第51回総選挙の小選挙区で、政党の候補者の得票の合計 ÷ 全候補者の得票の合計（" + fmt(totAll) + "票）。あわせて「1位になった区の割合」（1位の数 ÷ " + D.length + "区）を並べます。無所属・諸派は除きます。",
      src: ELEC(), rows: numberRows(pvl.map(function (x) {
        var a = pct(x.v, totAll, 1), b = pct(x.w, D.length, 1);
        return { h: badge(x.p, { full: true }), s: shortName(x.p) + " 得票" + a + "%・1位" + b + "%", v: a, u: "%", c: fam(x.p).color, sub: "<b>1位の区の割合 " + b + "%</b>（" + x.w + "区）・得票 " + fmt(x.v) + "票・擁立 " + x.n + "人", k: x.v, two: [+a, +b] };
      }), function (r) { return r.k; }) });

    var rk = famsPresent().filter(function (x) { return x.f.family !== "無所属" && x.f.family !== "その他" && x.n >= 5; }).map(function (x) {
      var l = MEM.filter(function (o) { return o.f === x.f; }), one = l.filter(function (o) { return o.terms === 1; }).length; return { f: x.f, n: l.length, one: one, r: one / l.length };
    }).sort(function (a, b) { return b.r - a.r || b.n - a.n; });
    add({ id: "rookie", cat: "seito", title: "政党別 当選1回の議員の割合ランキング", unit: "%", tag: "国会議員",
      basis: "衆議院・参議院の議員のうち、それぞれの議院の名簿の当選回数が1回の人の割合（議員5人以上の政党）。高い・低いに良し悪しはありません。",
      src: src(HR_LIST, "衆議院 議員一覧") + " " + src(SMRI_HC, "house-of-councillors"), rows: numberRows(rk.map(function (x) {
        var r1 = pct(x.one, x.n, 1);
        return { h: famBadge(x.f, x.f.family, { big: true }), s: x.f.family + " " + r1 + "%", v: r1, u: "%", c: x.f.color, sub: x.n + "人のうち当選1回 " + x.one + "人", k: x.r.toFixed(5), bar: [x.one, x.n - x.one] };
      }), function (r) { return r.k; }) });

    if (PR && PR.party) {
      var cur = PR.ruling.current, rulingNow = cur ? cur.ruling : [];
      var nRule = "衆議院で法律案を出すには、議員20人以上（予算を伴う法律案は50人以上）の賛成者が必要です。人数の少ない会派は単独では出せません。";
      var propBasis = function (side) {
        return "第" + PR.from + "〜" + PR.to + "回国会の衆法 " + fmt(PR.n_bills) + "件のうち、提出日（衆議院の受理日）にその政党が" + (side === "opp" ? "野党" : "与党") + "だった期間の提出。共同提出は各政党に1件ずつ数えます。単独＝提出会派が1つ、共同＝2つ以上。委員長提出の " + fmt(PR.n_chair) + "件は別のランキングにしています。継続審査で再掲された議案は1件と数えます。" + nRule + "成立の割合が高い・低いに良し悪しはありません。";
      };
      var rsrc = function () { return src(SMRI_HR, "国会議案データベース：衆議院（議案提出会派・審議状況）") + " " + PR.ruling.sources.map(function (s2) { return src(s2.url, "与党の区分：" + s2.title); }).join(" ") + " " + src(KOKKAI_GIAN, "衆議院「議案の審査」（提出に必要な賛成者の数）"); };
      ["opp", "ruling"].forEach(function (side) {
        var L = PR.party.filter(function (x) { return x[side].n > 0; }).sort(function (a, b) { return b[side].n - a[side].n || a.p.localeCompare(b.p, "ja"); });
        add({ id: side === "opp" ? "propopp" : "propruling", cat: "seito", title: "議員立法の提出ランキング（" + (side === "opp" ? "野党の期間" : "与党の期間") + "）", unit: "件", tag: "議員立法",
          basis: propBasis(side) + (side === "ruling" ? "与党は政府の法律案（閣法）が中心です。同じ期間の閣法は " + fmt(PR.kakuho.n) + "件（成立 " + fmt(PR.kakuho.passed) + "件）。" : ""),
          src: rsrc(), rows: numberRows(L.map(function (x) {
            var t = x[side];
            return { h: partyKeyBadge(x), s: x.p + " " + t.n + "件", v: fmt(t.n), u: "件", c: partyKeyColor(x), sub: "単独 " + t.single + "件・共同 " + t.joint + "件／成立 " + t.passed + "件（" + pct(t.passed, t.n) + "%）", k: t.n, bar: [t.single, t.joint] };
          }), function (r) { return r.k; }), side: side });
      });
      // 議席数あたり（第221回国会以降＝今の議席の構成。与党と野党は別の表）
      var st = PR.seats;
      if (st) {
        var seatOf = function (p) { return st.seats[p] || 0; };
        var keys = Object.keys(st.seats).filter(function (k) { return k !== "無所属" && k !== "欠員"; });
        var rec = function (p) { var x = PR.party.filter(function (z) { return z.p === p; })[0]; return x ? x.recent : { n: 0, single: 0, joint: 0, passed: 0 }; };
        var mk = function (p) { var x = PR.party.filter(function (z) { return z.p === p; })[0] || { p: p, fam: SLUG[p] ? p : null, kaiha: {} }; if (!Object.keys(x.kaiha).length) x.kaiha[p] = 1; return x; };
        var opp = keys.filter(function (k) { return rulingNow.indexOf(k) < 0; }).map(function (k) { var r0 = rec(k); return { x: mk(k), seats: seatOf(k), r: r0, per: r0.n / seatOf(k) * 10 }; }).sort(function (a, b) { return b.per - a.per || b.seats - a.seats; });
        var rul = keys.filter(function (k) { return rulingNow.indexOf(k) >= 0; }).map(function (k) { var r0 = rec(k); return { x: mk(k), seats: seatOf(k), r: r0, per: r0.n / seatOf(k) * 10 }; }).sort(function (a, b) { return b.seats - a.seats; });
        var row = function (z) { return { h: partyKeyBadge(z.x), s: z.x.p + " " + z.per.toFixed(1) + "件", v: z.per.toFixed(1), u: "件", c: partyKeyColor(z.x), sub: "提出 " + z.r.n + "件（単独 " + z.r.single + "・共同 " + z.r.joint + "、成立 " + z.r.passed + "）÷ 議席 " + z.seats, k: z.per.toFixed(3) }; };
        var rulTbl = '<div class="rk-side"><h3 class="rk-side-h">与党（' + esc(rulingNow.join("・")) + '）は別の表・順位なし</h3><table class="tbl"><thead><tr><th>政党</th><th>議席</th><th>提出</th><th>単独</th><th>共同</th><th>成立</th><th>10議席あたり</th></tr></thead><tbody>' +
          rul.map(function (z) { return "<tr><td>" + partyKeyBadge(z.x) + "</td><td>" + z.seats + "</td><td>" + z.r.n + "</td><td>" + z.r.single + "</td><td>" + z.r.joint + "</td><td>" + z.r.passed + "</td><td>" + z.per.toFixed(1) + "</td></tr>"; }).join("") +
          '</tbody></table><p class="note">与党は政府の法律案（閣法）が中心です。同じ期間（第' + st.recent_from + "回国会以降）の閣法は " + fmt(PR.kakuho.recent_n) + "件（成立 " + fmt(PR.kakuho.recent_passed) + "件）。</p></div>";
        add({ id: "propseat", cat: "seito", title: "議員立法 10議席あたりの提出ランキング（野党）", unit: "件", tag: "議員立法",
          basis: st.recent_note + "の衆法の件数 ÷ 衆議院の議席数 × 10。議席数は" + st.date + "現在の会派別所属議員数（" + st.note + "）。現在の与党（" + rulingNow.join("・") + "、" + (cur.from || "") + "〜）と野党を分け、順位は野党だけで付けます。共同提出は各政党に1件。" + nRule,
          src: rsrc() + " " + src(st.src.url, st.src.title), rows: numberRows(opp.map(row), function (r) { return r.k; }), extra: rulTbl });
      }
    }
    var kr = kaihaRates();
    add({ id: "yesrate", cat: "seito", title: "会派の賛成の割合ランキング", unit: "%", tag: "国会",
      basis: "衆議院の議案への会派の賛否で、賛成の件数 ÷（賛成＋反対の件数）。第196回国会以降、第" + S.maxS + "回国会に記録のある会派名で記録された議案。高い・低いに良し悪しはありません。会派名が変わる前の記録は含みません。",
      src: HRSRC(), rows: numberRows(kr.map(function (x) {
        var r1 = pct(x.y, x.y + x.n, 1);
        return { h: badge(x.k, { full: true }), s: shortName(x.k) + " " + r1 + "%", v: r1, u: "%", c: fam(x.k).color, sub: "賛成 " + fmt(x.y) + "件・反対 " + fmt(x.n) + "件", k: x.r.toFixed(5), bar: [x.y, x.n], barLab: ["賛成", "反対"], yn: 1 };
      }), function (r) { return r.k; }) });

    // ---------------- 議案
    var sb = splitBills().slice(0, 10);
    add({ id: "split", cat: "gian", title: "賛否が割れた議案ランキング", unit: "会派", tag: "国会",
      basis: "衆議院の議案 " + fmt(V.bills.length) + "件（第196回国会以降）で、賛成した会派の数と反対した会派の数の少ないほうが多い順（同じなら差が小さい順、新しい順）。",
      src: HRSRC(), rows: sb.map(function (b, i) {
        var tt = b.t.length > 26 ? b.t.slice(0, 26) + "…" : b.t;
        return { no: i + 1, h: '<a class="r-t" href="#bill-hr-' + b.id + '">' + esc(b.t) + "</a>", s: tt + "（賛" + b.y.length + "・反" + b.n.length + "）", v: b.y.length + "対" + b.n.length, u: "会派", c: "", sub: "賛成 " + b.y.length + "会派・反対 " + b.n.length + "会派／第" + b.s + "回国会・" + esc(b.k) + "・" + esc(b.res), long: 1 };
      }) });
    var tg = {};
    V.bills.forEach(function (b) { b.g.forEach(function (g) { if (g === "none") return; if (!tg[g]) tg[g] = { g: g, n: 0, u: 0 }; tg[g].n++; if (b.how === "全会一致") tg[g].u++; }); });
    var tgl = Object.keys(tg).map(function (k) { return tg[k]; }).filter(function (x) { return x.n >= 20; }).sort(function (a, b) { return b.u / b.n - a.u / a.n || b.n - a.n; });
    add({ id: "unanimous", cat: "gian", title: "全会一致の割合が高い分野ランキング", unit: "%", tag: "国会",
      basis: "衆議院の議案（第196回国会以降）を政策分野タグ（件名のキーワードによる自動分類）ごとに数え、全会一致だった件数 ÷ その分野の件数の高い順。20件以上の分野だけ。1つの議案が複数の分野に入ることがあります。",
      src: HRSRC() + ' <a class="src" href="#tags">分類の規則（タグ一覧）</a>', rows: numberRows(tgl.map(function (x) {
        var r1 = pct(x.u, x.n, 1), lab = PTAG[x.g] ? PTAG[x.g].label : x.g;
        return { h: '<a class="tag tag-p tag-l" href="#tag-p-' + x.g + '">' + esc(lab) + "</a>", s: lab + " " + r1 + "%", v: r1, u: "%", c: "", sub: fmt(x.n) + "件のうち全会一致 " + fmt(x.u) + "件", k: (x.u / x.n).toFixed(5), bar: [x.u, x.n - x.u], barLab: ["全会一致", "それ以外"] };
      }), function (r) { return r.k; }) });
    var ss = {};
    V.bills.forEach(function (b) { if (!ss[b.s]) ss[b.s] = { s: b.s, n: 0, u: 0 }; ss[b.s].n++; if (b.how === "全会一致") ss[b.s].u++; });
    var ssl = Object.keys(ss).map(function (k) { return ss[k]; }).filter(function (x) { return x.n >= 20; }).sort(function (a, b) { return b.u / b.n - a.u / a.n || b.s - a.s; }).slice(0, 10);
    add({ id: "session", cat: "gian", title: "全会一致の割合が高い国会ランキング", unit: "%", tag: "国会",
      basis: "衆議院で会派の賛否が記録された議案を国会（回次）ごとに数え、全会一致だった割合の高い順。20件以上の国会だけ。上位10回を載せています。",
      src: HRSRC(), rows: numberRows(ssl.map(function (x) {
        var r1 = pct(x.u, x.n, 1);
        return { h: '<span class="r-t">第' + x.s + "回国会</span>", s: "第" + x.s + "回 " + r1 + "%", v: r1, u: "%", c: "", sub: fmt(x.n) + "件のうち全会一致 " + fmt(x.u) + "件", k: (x.u / x.n).toFixed(5), bar: [x.u, x.n - x.u], barLab: ["全会一致", "それ以外"] };
      }), function (r) { return r.k; }) });
    if (PR && PR.chair) {
      var ch = Object.keys(PR.chair).map(function (k) { return { k: k, n: PR.chair[k].n, p: PR.chair[k].passed }; }).sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k, "ja"); }).slice(0, 10);
      add({ id: "chair", cat: "gian", title: "委員長提出の法律案ランキング（委員会別）", unit: "件", tag: "議員立法",
        basis: "第" + PR.from + "回国会以降の衆法のうち、委員会の委員長が提出したもの（委員会提出の法律案）" + fmt(PR.n_chair) + "件を委員会ごとに数えました（成立 " + fmt(PR.chair_passed) + "件）。政党別の議員立法のランキングには入れていません。",
        src: src(SMRI_HR, "国会議案データベース：衆議院（議案提出者）"), rows: numberRows(ch.map(function (x) {
          return { h: '<span class="r-t">' + esc(x.k) + "委員会</span>", s: x.k + " " + x.n + "件", v: String(x.n), u: "件", c: "", sub: "成立 " + x.p + "件", k: x.n };
        }), function (r) { return r.k; }) });
    }

    // ---------------- 地域
    var PM = prefMembers();
    var pb = Object.keys(PM).map(function (pi) { var l = PM[pi], fc = famCount(l); return { pi: +pi, name: S.prefs[pi - 1].name, n: l.length, top: fc[0], fc: fc, r: fc[0].n / l.length }; })
      .sort(function (a, b) { return b.r - a.r || b.n - a.n || a.pi - b.pi; });
    add({ id: "prefbias", cat: "chiiki", title: "都道府県別 選出議員の政党の偏りランキング", unit: "%", tag: "地域の政治",
      basis: "都道府県ごとに、衆議院の小選挙区と参議院の選挙区から選ばれた議員（比例代表は除く。参議院の合区は両方の県に数える）のうち、最も多い政党の議員の割合の高い順。同じ割合は人数の多い順。",
      src: src(HR_LIST, "衆議院 議員一覧") + " " + src(SMRI_HC, "house-of-councillors") + " " + ELEC(), rows: numberRows(pb.map(function (x) {
        var r1 = pct(x.top.n, x.n, 1);
        return { h: '<a class="r-t" href="#tag-pref-' + x.pi + '">' + esc(x.name) + "</a>", s: x.name + " " + x.top.f.family + r1 + "%", v: r1, u: "%", c: x.top.f.color, sub: x.fc.map(function (z) { return famLabelBadge(z.f, z.f.family + " " + z.n, true); }).join(" ") + " 計" + x.n + "人", k: x.r.toFixed(5) + "|" + x.n, stack: x.fc };
      }), function (r) { return r.k; }), all: 1 });
    var pcl = {};
    D.forEach(function (x) { var pi = +x.k.slice(0, 2); if (!pcl[pi]) pcl[pi] = { pi: pi, n: 0, c: 0 }; pcl[pi].n++; if (x.r.length > 1 && x.diff < 10000) pcl[pi].c++; });
    var pcll = Object.keys(pcl).map(function (k) { return pcl[k]; }).filter(function (x) { return x.c > 0; }).sort(function (a, b) { return b.c - a.c || b.c / b.n - a.c / a.n || a.pi - b.pi; });
    add({ id: "prefclose", cat: "chiiki", title: "都道府県別 1万票差未満の小選挙区の数ランキング", unit: "区", tag: "衆院選",
      basis: "第51回総選挙で、1位と2位の差が1万票未満だった小選挙区を都道府県ごとに数えました（同じ数なら、その都道府県の小選挙区に占める割合の高い順）。1区もない都道府県は載せていません。",
      src: ELEC(), rows: numberRows(pcll.map(function (x) {
        var nm = S.prefs[x.pi - 1].name;
        return { h: '<a class="r-t" href="#tag-pref-' + x.pi + '">' + esc(nm) + "</a>", s: nm + " " + x.c + "区", v: String(x.c), u: "区", c: "", sub: "小選挙区 " + x.n + "区のうち（" + pct(x.c, x.n) + "%）", k: x.c, bar: [x.c, x.n - x.c], barLab: ["1万票差未満", "それ以外"] };
      }), function (r) { return r.k; }), all: 1 });
    var pp = Object.keys(PM).map(function (pi) { var fc = famCount(PM[pi]); return { pi: +pi, name: S.prefs[pi - 1].name, k: fc.length, n: PM[pi].length, fc: fc }; })
      .sort(function (a, b) { return b.k - a.k || b.n - a.n || a.pi - b.pi; });
    add({ id: "prefparties", cat: "chiiki", title: "都道府県別 選出議員の政党の数ランキング", unit: "党", tag: "地域の政治",
      basis: "都道府県ごとに、衆議院の小選挙区と参議院の選挙区から選ばれた議員の政党（全サイト共通の政党カラー表の区分。無所属も1つに数える）の種類の多い順。同じ数は議員の多い順。",
      src: src(HR_LIST, "衆議院 議員一覧") + " " + src(SMRI_HC, "house-of-councillors"), rows: numberRows(pp.map(function (x) {
        return { h: '<a class="r-t" href="#tag-pref-' + x.pi + '">' + esc(x.name) + "</a>", s: x.name + " " + x.k + "党", v: String(x.k), u: "党", c: "", sub: x.fc.map(function (z) { return famLabelBadge(z.f, z.f.family + " " + z.n, true); }).join(" "), k: x.k, stack: x.fc };
      }), function (r) { return r.k; }), all: 1 });
    var bl = BLOCKS.map(function (b, i) { var l = MEM.filter(function (o) { return o.house === "hr" && o.block === b; }), fc = famCount(l); return { b: b, i: i + 1, n: l.length, fc: fc, top: fc[0], r: fc.length ? fc[0].n / l.length : 0 }; })
      .filter(function (x) { return x.n; }).sort(function (a, b) { return b.r - a.r || b.n - a.n; });
    add({ id: "block", cat: "chiiki", title: "比例ブロック別 最多政党の割合ランキング", unit: "%", tag: "衆院選",
      basis: "衆議院の比例代表 11ブロックごとに、現在の比例選出議員のうち最も多い政党の割合の高い順。",
      src: src(HR_LIST, "衆議院 議員一覧（" + (S.members.meta.hr_asof || "") + "）"), rows: numberRows(bl.map(function (x) {
        var r1 = pct(x.top.n, x.n, 1);
        return { h: '<a class="r-t" href="#tag-block-' + x.i + '">比例 ' + esc(x.b) + "</a>", s: x.b + " " + x.top.f.family + r1 + "%", v: r1, u: "%", c: x.top.f.color, sub: x.fc.map(function (z) { return famLabelBadge(z.f, z.f.family + " " + z.n, true); }).join(" ") + " 計" + x.n + "人", k: x.r.toFixed(5), stack: x.fc };
      }), function (r) { return r.k; }), all: 1 });

    // ---------------- 暮らし（暮らしテーマ別。全会派に同じ計算・数値の順）
    if (S.ltags && S.ltags.rules.length) {
      var LS = S.ltags.rules.map(function (r0) { return { r: r0, st: lifeStats(r0.id) }; });
      var lu = LS.filter(function (x) { return x.st.rows.length; }).sort(function (a, b) { return b.st.un / b.st.rows.length - a.st.un / a.st.rows.length || b.st.rows.length - a.st.rows.length; });
      add({ id: "lifeun", cat: "kurashi", title: "暮らしテーマ別 全会一致の割合ランキング", unit: "%", tag: "暮らしと国会", db: ["#life", "暮らしテーマ別に議案を探す"],
        basis: "衆議院の議案（第196回国会以降）を暮らしテーマ（件名のキーワードによる自動分類）ごとに数え、全会一致だった件数 ÷ そのテーマの件数の高い順。1つの議案が複数のテーマに入ることがあります。",
        src: HRSRC() + ' <a class="src" href="#tags">分類の規則</a>', rows: numberRows(lu.map(function (x) {
          var r1 = pct(x.st.un, x.st.rows.length, 1);
          return { h: '<a class="r-t" href="#life-' + x.r.id + '">' + esc(x.r.label) + "</a>", s: x.r.label + " " + r1 + "%", v: r1, u: "%", c: "", sub: esc(x.r.desc) + "・" + fmt(x.st.rows.length) + "件のうち全会一致 " + fmt(x.st.un) + "件", k: (x.st.un / x.st.rows.length).toFixed(4), bar: [x.st.un, x.st.rows.length - x.st.un], barLab: ["全会一致", "賛否が分かれた"] };
        }), function (r) { return r.k; }) });
      var ls = LS.map(function (x) { return { x: x, n: x.st.sp.length }; }).sort(function (a, b) { return b.n - a.n; });
      add({ id: "lifesplit", cat: "kurashi", title: "暮らしテーマ別 賛否が分かれた議案の数ランキング", unit: "件", tag: "暮らしと国会", db: ["#bills", "議案の一覧（暮らしテーマで絞り込み）"],
        basis: "衆議院の議案（第196回国会以降）のうち、賛成した会派と反対した会派の両方がある議案を暮らしテーマごとに数えた多い順。各テーマで最も割れた議案を下に載せています。",
        src: HRSRC(), rows: numberRows(ls.map(function (z) {
          var b0 = z.x.st.sp[0];
          return { h: '<a class="r-t" href="#life-' + z.x.r.id + '">' + esc(z.x.r.label) + "</a>", s: z.x.r.label + " " + z.n + "件", v: String(z.n), u: "件", c: "", sub: b0 ? '最も割れた議案：<a href="#bill-hr-' + b0.id + '">' + esc(b0.t.length > 34 ? b0.t.slice(0, 34) + "…" : b0.t) + "</a>（賛成" + b0.y.length + "・反対" + b0.n.length + "会派）" : "", k: z.n };
        }), function (r) { return r.k; }) });
      LS.forEach(function (x) {
        var st = x.st;
        var krm = st.kr.filter(function (z) { return z.y + z.n >= 5; }), few = st.kr.length - krm.length;
        if (!krm.length) return;
        var spl = st.sp.slice(0, 5);
        add({ id: "life" + x.r.id, cat: "kurashi", title: "「" + x.r.label + "」の議案 会派の賛成の割合ランキング", unit: "%", tag: "暮らしと国会", db: ["#life-" + x.r.id, "「" + x.r.label + "」の議案をすべて見る"],
          hl: "衆議院 " + st.rows.length + "件・全会一致 " + pct(st.un, st.rows.length) + "%",
          basis: "暮らしテーマ「" + x.r.label + "」（" + x.r.desc + "。" + lifeRule(x.r) + "。自動分類）の衆議院の議案で、第" + S.maxS + "回国会に記録のある全会派に同じ計算：賛成の件数 ÷（賛成＋反対の件数）。数値の高い順に機械的に並べています。賛否の記録が5件以上の会派が対象" + (few ? "（5件未満の " + few + "会派はテーマのページに件数つきで表示）" : "") + "。高い・低いに良し悪しはありません。",
          src: HRSRC(), rows: numberRows(krm.map(function (z) {
            var r1 = pct(z.y, z.y + z.n, 1);
            return { h: badge(z.k, { full: true }), s: shortName(z.k) + " " + r1 + "%", v: r1, u: "%", c: fam(z.k).color, sub: "賛成 " + z.y + "件・反対 " + z.n + "件", k: (z.y / (z.y + z.n)).toFixed(4), bar: [z.y, z.n], barLab: ["賛成", "反対"] };
          }), function (r) { return r.k; }),
          extra: spl.length ? '<div class="rk-side"><h3 class="rk-side-h">このテーマで賛否が割れた議案</h3>' + billListHtml(spl, "hr", 5) + "</div>" : "" });
      });
    }
    // ---------------- 知ってた？（事実そのものの意外さ。因果をにおわせる言葉は使わない。単位は政党・選挙区・都道府県・ブロック・議案の種類）
    (function () {
      var NS = D.length, TOT = D.reduce(function (a, x) { return a + x.tot; }, 0);
      // 1 得票の割合と1位の区の割合
      var sv = pvl.filter(function (x) { return x.n >= 5; }).map(function (x) { var a = x.v / TOT, b = x.w / NS; return { x: x, a: a, b: b, k: a ? b / a : 0 }; }).sort(function (p, q) { return q.k - p.k || q.x.v - p.x.v; });
      var t0 = sv[0];
      add({ id: "seatvote", cat: "shitteta", title: "得票の割合と1位の区の割合の倍率ランキング", unit: "倍", tag: "衆院選",
        hl: sv.length ? "政党ごとの倍率は " + sv[sv.length - 1].k.toFixed(2) + "倍〜" + t0.k.toFixed(2) + "倍（" + sv.length + "党）" : "",
        basis: "第51回総選挙の小選挙区で、政党ごとに「1位になった区の割合（1位の区の数 ÷ " + NS + "区）」÷「得票の割合（政党の候補者の得票合計 ÷ 全候補者の得票合計）」。1倍より大きいと、得票の割合より1位の区の割合が大きいことを表します。小選挙区は各区で1位の1人だけが選ばれる仕組みのため、この差が出ます。候補者5人以上の政党が対象（無所属・諸派は除く）。全政党に同じ計算をしています。",
        src: ELEC(), rows: numberRows(sv.map(function (z) {
          return { h: badge(z.x.p, { full: true }), s: shortName(z.x.p) + " " + z.k.toFixed(2) + "倍", v: z.k.toFixed(2), u: "倍", c: fam(z.x.p).color, sub: "得票の割合 " + (z.a * 100).toFixed(1) + "%・1位の区の割合 " + (z.b * 100).toFixed(1) + "%（" + z.x.w + "区／擁立 " + z.x.n + "人）", k: z.k.toFixed(4) };
        }), function (r) { return r.k; }) });
      // 2 死票率が高い小選挙区
      var dv = D.filter(function (x) { return x.r.length > 1; }).map(function (x) { return { x: x, k: 1 - x.r[0].votes / x.tot }; }).sort(function (a, b) { return b.k - a.k || a.x.k.localeCompare(b.x.k); }).slice(0, 10);
      add({ id: "deadvote", cat: "shitteta", title: "1位以外への票の割合が高い小選挙区ランキング", unit: "%", tag: "衆院選",
        hl: dv[0] ? dv[0].x.d.name + "：投票の " + (dv[0].k * 100).toFixed(1) + "%が1位以外の候補へ" : "",
        basis: "第51回総選挙の小選挙区ごとに、1位の候補以外に入った票の合計 ÷ 有効票の合計（いわゆる死票の割合）。高い順に10区。順位は選挙区の単位で付けています（候補者個人の順位ではありません）。",
        src: ELEC(), rows: numberRows(dv.map(function (z) {
          var r1 = (z.k * 100).toFixed(1);
          return { h: '<span class="r-t">' + esc(z.x.d.name) + "</span>", s: z.x.d.name + " " + r1 + "%", v: r1, u: "%", c: "", sub: "有効票 " + fmt(z.x.tot) + "票のうち1位以外 " + fmt(z.x.tot - z.x.r[0].votes) + "票・候補者 " + z.x.r.length + "人", k: r1, bar: [z.x.tot - z.x.r[0].votes, z.x.r[0].votes], barLab: ["1位以外", "1位"] };
        }), function (r) { return r.k; }) });
      // 3 得票率5割未満で1位（政党別）
      var u5 = {};
      D.forEach(function (x) { if (!x.r.length) return; var p = ep(x.r[0].party); if (!u5[p]) u5[p] = { p: p, w: 0, u: 0 }; u5[p].w++; if (x.r[0].votes / x.tot < 0.5) u5[p].u++; });
      var u5l = Object.keys(u5).map(function (k) { return u5[k]; }).filter(function (x) { return x.u > 0; }).sort(function (a, b) { return b.u - a.u || b.u / b.w - a.u / a.w; });
      var nU = u5l.reduce(function (a, x) { return a + x.u; }, 0);
      add({ id: "under50", cat: "shitteta", title: "得票率5割未満で1位になった区の数ランキング（政党別）", unit: "区", tag: "衆院選",
        hl: NS + "区のうち " + nU + "区は、1位の得票率が5割未満",
        basis: "第51回総選挙の小選挙区で、1位の候補の得票率（得票 ÷ その区の有効票の合計）が50%未満だった区を、1位の政党ごとに数えました。同じ数なら、その政党が1位の区に占める割合の高い順。全政党に同じ基準です。",
        src: ELEC(), rows: numberRows(u5l.map(function (x) {
          return { h: badge(x.p, { full: true }), s: shortName(x.p) + " " + x.u + "区", v: String(x.u), u: "区", c: fam(x.p).color, sub: "1位の " + x.w + "区のうち（" + pct(x.u, x.w) + "%）", k: x.u, bar: [x.u, x.w - x.u], barLab: ["5割未満", "5割以上"] };
        }), function (r) { return r.k; }) });
      // 4 都道府県別
      var u5p = {};
      D.forEach(function (x) { var pi = +x.k.slice(0, 2); if (!u5p[pi]) u5p[pi] = { pi: pi, n: 0, u: 0 }; u5p[pi].n++; if (x.r.length && x.r[0].votes / x.tot < 0.5) u5p[pi].u++; });
      var u5pl = Object.keys(u5p).map(function (k) { return u5p[k]; }).filter(function (x) { return x.u > 0; }).sort(function (a, b) { return b.u / b.n - a.u / a.n || b.n - a.n || a.pi - b.pi; });
      add({ id: "under50pref", cat: "shitteta", title: "得票率5割未満で1位になった区の割合ランキング（都道府県別）", unit: "%", tag: "衆院選",
        hl: u5pl[0] ? S.prefs[u5pl[0].pi - 1].name + "：" + u5pl[0].n + "区のうち " + u5pl[0].u + "区が5割未満の1位" : "",
        basis: "第51回総選挙で、1位の候補の得票率が50%未満だった小選挙区の数 ÷ その都道府県の小選挙区の数。同じ割合なら区の多い順。1区もない都道府県は載せていません。",
        src: ELEC(), rows: numberRows(u5pl.map(function (x) {
          var nm = S.prefs[x.pi - 1].name, r1 = pct(x.u, x.n, 1);
          return { h: '<a class="r-t" href="#tag-pref-' + x.pi + '">' + esc(nm) + "</a>", s: nm + " " + r1 + "%", v: r1, u: "%", c: "", sub: x.n + "区のうち " + x.u + "区", k: (x.u / x.n).toFixed(4) + "|" + x.n, bar: [x.u, x.n - x.u], barLab: ["5割未満", "5割以上"] };
        }), function (r) { return r.k; }), all: 1 });
      // 5・6 比例復活（重複立候補で比例当選）
      var cand = {};
      D.forEach(function (x) { x.r.forEach(function (c) { cand[snorm(c.name) + "|" + x.d.block] = x; }); });
      var pr = MEM.filter(function (o) { return o.house === "hr" && o.block; });
      pr.forEach(function (o) { o.revive = !!cand[snorm(o.name) + "|" + o.block]; });
      var fk = {};
      pr.forEach(function (o) { var f = o.f.family; if (!fk[f]) fk[f] = { f: o.f, n: 0, r: 0 }; fk[f].n++; if (o.revive) fk[f].r++; });
      var fkl = Object.keys(fk).map(function (k) { return fk[k]; }).filter(function (x) { return x.r > 0; }).sort(function (a, b) { return b.r - a.r || b.r / b.n - a.r / a.n; });
      var nR = pr.filter(function (o) { return o.revive; }).length;
      var rvBasis = "現在の衆議院の比例代表選出の議員のうち、第51回総選挙で同じ比例ブロック内の小選挙区にも立候補していた人（小選挙区と比例代表の重複立候補で、比例代表で当選＝いわゆる比例復活）。氏名とブロックで照合しています。制度どおりの当選の仕組みで、良し悪しを表すものではありません。";
      add({ id: "revive", cat: "shitteta", title: "比例復活の議員数ランキング（政党別）", unit: "人", tag: "衆院選",
        hl: "比例選出 " + pr.length + "人のうち " + nR + "人は小選挙区にも立候補",
        basis: rvBasis + "政党ごとの人数の多い順（同じなら比例選出議員に占める割合の高い順）。",
        src: src(HR_LIST, "衆議院 議員一覧（" + (S.members.meta.hr_asof || "") + "）") + " " + ELEC(), rows: numberRows(fkl.map(function (x) {
          return { h: famBadge(x.f, x.f.family, { big: true }), s: x.f.family + " " + x.r + "人", v: String(x.r), u: "人", c: x.f.color, sub: "比例選出 " + x.n + "人のうち（" + pct(x.r, x.n) + "%）", k: x.r, bar: [x.r, x.n - x.r], barLab: ["小選挙区にも立候補", "比例のみ"] };
        }), function (r) { return r.k; }) });
      var bk = BLOCKS.map(function (b, i) { var l = pr.filter(function (o) { return o.block === b; }); return { b: b, i: i + 1, n: l.length, r: l.filter(function (o) { return o.revive; }).length }; }).filter(function (x) { return x.n; })
        .sort(function (a, b) { return b.r / b.n - a.r / a.n || b.n - a.n; });
      add({ id: "reviveblock", cat: "shitteta", title: "比例復活の割合ランキング（比例ブロック別）", unit: "%", tag: "衆院選",
        hl: bk[0] ? "比例 " + bk[0].b + "：" + bk[0].n + "人のうち " + bk[0].r + "人が比例復活" : "",
        basis: rvBasis + "ブロックごとに、比例復活の人数 ÷ 比例選出の議員数の高い順。",
        src: src(HR_LIST, "衆議院 議員一覧") + " " + ELEC(), rows: numberRows(bk.map(function (x) {
          var r1 = pct(x.r, x.n, 1);
          return { h: '<a class="r-t" href="#tag-block-' + x.i + '">比例 ' + esc(x.b) + "</a>", s: x.b + " " + r1 + "%", v: r1, u: "%", c: "", sub: x.n + "人のうち " + x.r + "人", k: (x.r / x.n).toFixed(4), bar: [x.r, x.n - x.r], barLab: ["比例復活", "それ以外"] };
        }), function (r) { return r.k; }), all: 1 });
      // 7 有効票の差（有権者数ではない）
      var vmin = D.slice().sort(function (a, b) { return a.tot - b.tot; })[0];
      var vt = D.slice().sort(function (a, b) { return b.tot - a.tot || a.k.localeCompare(b.k); }).slice(0, 10);
      add({ id: "votegap", cat: "shitteta", title: "有効票の合計が多い小選挙区ランキング（最も少ない区との倍率）", unit: "倍", tag: "衆院選",
        hl: vt[0] ? vt[0].d.name + " " + fmt(vt[0].tot) + "票、" + vmin.d.name + " " + fmt(vmin.tot) + "票：" + (vt[0].tot / vmin.tot).toFixed(2) + "倍" : "",
        basis: "第51回総選挙の小選挙区ごとの有効票の合計（候補者の得票の合計）を、最も少なかった " + vmin.d.name + "（" + fmt(vmin.tot) + "票）の何倍かで並べました。有権者数ではなく実際の有効票の数です（いわゆる「1票の格差」は有権者数で計算するもので、このサイトは有権者数を未取得です）。",
        src: ELEC(), rows: numberRows(vt.map(function (x) {
          var r1 = (x.tot / vmin.tot).toFixed(2);
          return { h: '<span class="r-t">' + esc(x.d.name) + "</span>", s: x.d.name + " " + r1 + "倍", v: r1, u: "倍", c: "", sub: "有効票 " + fmt(x.tot) + "票・候補者 " + x.r.length + "人", k: x.tot };
        }), function (r) { return r.k; }) });
      // 8 法律案の種類別の成立の割合
      if (PR && PR.kakuho) {
        var kinds = [{ l: "閣法（内閣が提出）", s: "閣法", n: PR.kakuho.n, p: PR.kakuho.passed }, { l: "委員長提出の衆法", s: "委員長提出", n: PR.n_chair, p: PR.chair_passed }, { l: "議員が提出した衆法（委員長提出を除く）", s: "議員提出の衆法", n: PR.n_bills, p: PR.shuho_passed }]
          .sort(function (a, b) { return b.p / b.n - a.p / a.n; });
        add({ id: "passrate", cat: "shitteta", title: "法律案の種類別 成立の割合ランキング", unit: "%", tag: "国会",
          hl: "成立の割合 閣法 " + pct(PR.kakuho.passed, PR.kakuho.n) + "%・議員提出の衆法 " + pct(PR.shuho_passed, PR.n_bills) + "%",
          basis: "第" + PR.from + "〜" + PR.to + "回国会に衆議院に出された法律案（衆議院先議）を種類ごとに数え、成立した件数 ÷ 件数（審議中のものを含む）。継続審査で再掲された議案は1件と数えます。参議院議員が提出した法律案（参法）は含みません。",
          src: src(SMRI_HR, "国会議案データベース：衆議院（議案種類・審議状況）"), rows: numberRows(kinds.map(function (x) {
            var r1 = pct(x.p, x.n, 1);
            return { h: '<span class="r-t">' + esc(x.l) + "</span>", s: x.s + " " + r1 + "%", v: r1, u: "%", c: "", sub: fmt(x.n) + "件のうち成立 " + fmt(x.p) + "件", k: (x.p / x.n).toFixed(4), bar: [x.p, x.n - x.p], barLab: ["成立", "それ以外"] };
          }), function (r) { return r.k; }) });
      }
      // 9 全会一致の割合が高い会期（年ごと）
      var yy = {};
      V.bills.forEach(function (b) { var m = String(b.dt || "").match(/(令和|平成)\s*(元|\d+)年/); if (!m) return; var y = (m[1] === "令和" ? 2018 : 1988) + (m[2] === "元" ? 1 : +m[2]); if (!yy[y]) yy[y] = { y: y, n: 0, u: 0 }; yy[y].n++; if (b.how === "全会一致") yy[y].u++; });
      var yyl = Object.keys(yy).map(function (k) { return yy[k]; }).filter(function (x) { return x.n >= 20; }).sort(function (a, b) { return b.u / b.n - a.u / a.n || b.y - a.y; });
      add({ id: "unanyear", cat: "shitteta", title: "全会一致の議案の割合ランキング（年別）", unit: "%", tag: "国会",
        hl: yyl[0] ? yyl[0].y + "年：衆議院の議案の " + pct(yyl[0].u, yyl[0].n) + "%が全会一致" : "",
        basis: "衆議院で会派の賛否が記録された議案（第196回国会以降）を議決の年ごとに数え、全会一致だった割合の高い順。20件以上の年だけ。",
        src: HRSRC(), rows: numberRows(yyl.map(function (x) {
          var r1 = pct(x.u, x.n, 1);
          return { h: '<span class="r-t">' + x.y + "年</span>", s: x.y + "年 " + r1 + "%", v: r1, u: "%", c: "", sub: fmt(x.n) + "件のうち全会一致 " + fmt(x.u) + "件", k: (x.u / x.n).toFixed(4), bar: [x.u, x.n - x.u], barLab: ["全会一致", "それ以外"] };
        }), function (r) { return r.k; }), all: 1 });
    })();
    // カードに出す対象と出典の短い表記（スクショだけでも何のデータか分かるように）
    var EL = "第51回総選挙（2026年2月8日）小選挙区", ES = "出典：矢内勇生 公開データ";
    var PRL = PR ? "衆法 第" + PR.from + "〜" + PR.to + "回国会" : "", HS = "出典：国会議案データベース（スマートニュース メディア研究所）";
    var LEAD = { close: [EL, ES], share: [EL, ES], votes: [EL, ES], cands: [EL, ES], matchup: [EL, ES], winrate: [EL, ES], votesp: [EL, ES], prefclose: [EL, ES],
      terms: ["衆議院 " + (S.members.meta.hr_asof || ""), "出典：衆議院 議員一覧"], hcterms: ["参議院 " + (S.members.meta.hc_asof || "").slice(0, 10), "出典：house-of-councillors"],
      propm: [PRL + "・委員長提出を除く", HS], propopp: [PRL + "・提出日に野党だった期間", HS + "ほか"], propruling: [PRL + "・提出日に与党だった期間", HS + "ほか"],
      propseat: ["第221回国会以降・議席は" + (PR && PR.seats ? PR.seats.date : "") + "現在・与党は別表", HS + "・衆議院"], chair: [PRL + "・委員長提出", HS],
      seats: ["衆議院＋参議院", "出典：衆議院 議員一覧・house-of-councillors"], rookie: ["衆議院＋参議院・議員5人以上の政党", "出典：衆議院 議員一覧・house-of-councillors"],
      yesrate: ["衆議院・第196回国会以降", HS], split: ["衆議院・第196回国会以降", HS], unanimous: ["衆議院・第196回国会以降・分野は自動分類", HS], session: ["衆議院・第196回国会以降", HS],
      prefbias: ["小選挙区＋参議院選挙区の議員（比例を除く）", "出典：衆議院 議員一覧・house-of-councillors"], prefparties: ["小選挙区＋参議院選挙区の議員（比例を除く）", "出典：衆議院 議員一覧・house-of-councillors"],
      block: ["衆議院 比例代表の議員", "出典：衆議院 議員一覧"],
      seatvote: [EL, ES], deadvote: [EL, ES], under50: [EL, ES], under50pref: [EL, ES], votegap: [EL + "・有効票（有権者数ではない）", ES],
      revive: ["衆議院の比例選出議員・" + EL, "出典：衆議院 議員一覧・矢内勇生 公開データ"], reviveblock: ["衆議院の比例選出議員・" + EL, "出典：衆議院 議員一覧・矢内勇生 公開データ"],
      passrate: [PRL + "・衆議院先議の法律案", HS], unanyear: ["衆議院・第196回国会以降", HS] };
    R.forEach(function (r) { if (r.cat === "kurashi") LEAD[r.id] = ["衆議院・第196回国会以降・テーマは自動分類", HS]; });
    var DB = { senkyo: ["#vs", "小選挙区を2つ選んで比べる（全289区）"], giin: ["#members", "国会議員の一覧（全員・絞り込み・並べ替え）"], seito: ["#parties", "政党の一覧（所属議員・賛否の推移）"], gian: ["#bills", "議案の一覧（全件・絞り込み・並べ替え）"], chiiki: ["#tags", "都道府県・ブロック別の議員一覧"] };
    var DBID = { seatvote: "seito", deadvote: "senkyo", under50: "seito", under50pref: "chiiki", revive: "giin", reviveblock: "chiiki", votegap: "senkyo", passrate: "gian", unanyear: "gian", propm: "giin", chair: "gian", split: "gian", unanimous: "gian", session: "gian", yesrate: "seito" };
    R.forEach(function (r) { var l = LEAD[r.id] || ["", ""]; r.lead = l[0]; r.srcShort = l[1]; if (!r.db) r.db = DB[DBID[r.id] || r.cat] || ["#bills", "議案の一覧"]; });
    R = R.filter(function (r) { return r.cat === "shitteta"; }).concat(R.filter(function (r) { return r.cat !== "shitteta"; }));
    RK = R;
    return R;
  }

  // ---------- シェア文：【○○ランキング】1位 ○○／2位 ○○／3位 ○○｜サイト名 #タグ（140字前後）
  function rkShareText(r) {
    var top = r.rows.slice(0, 3), head = "【" + r.title + "】" + (r.hl ? r.hl + "。" : ""), tail = "｜" + SITE_NAME + " #" + HASHTAG + (r.tag ? " #" + r.tag : "");
    var lim = 140, cut = 40, items;
    function build(c) { return head + top.map(function (x) { var s = x.s.length > c ? x.s.slice(0, c - 1) + "…" : x.s; return x.no + "位 " + s; }).join("／") + tail; }
    var t = build(cut);
    while (t.length > lim && cut > 8) { cut--; t = build(cut); }
    return t;
  }
  function rkShareBar(r) {
    var hash = "#rank-" + r.id, url = shareUrl(hash), t = rkShareText(r);
    var x = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(t) + (url ? "&url=" + encodeURIComponent(url) : "");
    var id = "c" + (++copySeq); COPY[id] = t + (url ? "\n" + url : "");
    return '<div class="share rk-share"><a class="btn-x" href="' + esc(x) + '" target="_blank" rel="noopener" aria-label="このランキングをXでシェア（新しいタブ）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>Xでシェア</a><button type="button" class="btn-copy" data-copy="' + id + '">文をコピー</button><button type="button" class="btn-copy btn-link" data-copy="' + (function () { var j = "c" + (++copySeq); COPY[j] = url || location.href; return j; })() + '">リンクをコピー</button></div>' +
      '<p class="rk-preview" aria-label="シェアする文"><span class="lab">シェアする文</span>' + esc(t) + (url ? "<br><span class=\"rk-url\">" + esc(url) + "</span>" : "") + "</p>";
  }

  // ---------- TOP3 カード（スクショ映え）
  function rkBar(x) {
    if (!x.bar) return "";
    var t = (x.bar[0] + x.bar[1]) || 1;
    return '<span class="ynbar rk-bar" aria-hidden="true"><i class="y" style="width:' + (x.bar[0] / t * 100).toFixed(1) + '%"></i><i class="n" style="width:' + (x.bar[1] / t * 100).toFixed(1) + '%"></i></span>';
  }
  function rkStack(x) {
    if (!x.stack) return "";
    var t = x.stack.reduce(function (s, z) { return s + z.n; }, 0) || 1;
    return '<span class="rk-stack" aria-hidden="true">' + x.stack.map(function (z) { return '<i style="width:' + (z.n / t * 100).toFixed(2) + "%;background:" + z.f.color + '"></i>'; }).join("") + "</span>";
  }
  function rkCard(r, opt) {
    opt = opt || {};
    var top = r.rows.slice(0, 3);
    var h = '<article class="rk-card' + (opt.mini ? " rk-mini" : "") + '" id="' + (opt.mini ? "rkc-" : "rk-") + r.id + '" data-cat="' + r.cat + '">';
    h += '<header class="rk-ch"><span class="rk-cat">' + esc(catLabel(r.cat)) + "</span>" + (opt.mini ? '<h3 class="rk-t"><a href="#rank-' + r.id + '">' + esc(r.title) + "</a></h3>" : '<h1 class="rk-t">' + esc(r.title) + "</h1>") + (r.hl ? '<p class="rk-hl">' + esc(r.hl) + "</p>" : "") + (r.lead ? '<p class="rk-lead">' + esc(r.lead) + "</p>" : "") + "</header>";
    if (!top.length) h += '<p class="empty">データがありません</p>';
    h += '<ol class="rk-pod">';
    top.forEach(function (x, i) {
      h += '<li class="rk-p rk-p' + (i + 1) + '"' + (x.c ? ' style="--rc:' + x.c + (x.c2 ? ";--rc2:" + x.c2 : "") + '"' : "") + '><span class="rk-no"><b>' + x.no + "</b>位</span>" +
        '<div class="rk-who' + (x.long ? " rk-long" : "") + '">' + x.h + (opt.mini ? "" : '<div class="rk-sub">' + x.sub + "</div>") + (opt.mini ? "" : rkStack(x)) + "</div>" +
        '<span class="rk-v"><b>' + esc(x.v) + "</b>" + esc(x.u) + "</span>" + (opt.mini ? "" : rkBar(x)) + "</li>";
    });
    h += "</ol>";
    h += '<footer class="rk-cf"><span class="rk-site">' + esc(SITE_NAME) + "</span>" + (!opt.mini && r.srcShort ? '<span class="rk-cs">' + esc(r.srcShort) + "</span>" : "") + (opt.mini ? '<span class="rk-links"><a class="rk-more" href="#rank-' + r.id + '">全順位と基準</a>' + (r.db ? '<a class="rk-more" href="' + r.db[0] + '">一覧で見る</a>' : "") + "</span>" : "") + "</footer></article>";
    return h;
  }
  function rkList(r) {
    var rows = r.rows, lim = r.all ? 10 : rows.length;
    function li(x) {
      return '<li class="rrow' + (x.no <= 3 ? " top3" : "") + '"><span class="rno">' + x.no + '</span><div class="rmain"><div>' + x.h + '</div><div class="rsub">' + x.sub + "</div>" + (x.bar ? '<div class="rbar">' + rkBar(x) + (x.barLab ? '<span class="rk-bl">' + esc(x.barLab[0]) + " " + x.bar[0] + "／" + esc(x.barLab[1]) + " " + x.bar[1] + "</span>" : "") + "</div>" : "") + (x.stack ? '<div class="rbar">' + rkStack(x) + "</div>" : "") + '</div><div class="rval"><b class="big-n">' + esc(x.v) + "</b>" + esc(x.u) + "</div></li>";
    }
    var h = '<ol class="rlist">' + rows.slice(0, lim).map(li).join("") + "</ol>";
    if (rows.length > lim) h += '<details class="rk-rest"><summary>' + (rows.length - lim) + "件をすべて見る</summary><ol class=\"rlist\">" + rows.slice(lim).map(li).join("") + "</ol></details>";
    return h;
  }
  function pageRankings(cat) {
    var h = '<div class="wrap page"><header class="ph"><p class="ph-pre">選挙・議員・政党・議案・地域</p><h1 class="ph-h">ランキング集</h1><p class="ph-sub">公開データから計算できるものだけを、切り口ごとにランキングにしました。各ランキングに基準と出典を書き、TOP3はそのままXでシェアできます。議員個人は上位だけを載せます。</p></header>';
    h += '<div class="chips rk-chips" role="group" aria-label="分類で絞り込む"><button type="button" class="chip chip-tag" data-c="" aria-pressed="' + !cat + '">すべて</button>' + RK_CATS.map(function (c) { return '<button type="button" class="chip chip-tag" data-c="' + c.id + '" aria-pressed="' + (cat === c.id) + '">' + c.label + "</button>"; }).join("") + '<span class="count" id="rk-count"></span></div>';
    h += '<div class="rk-grid" id="rk-grid"><div class="skeleton"></div></div><p class="note">旧来の一覧表は<a href="#rank">ランキング（一覧表）</a>にあります。</p></div>';
    setView(h, "ランキング集");
    getVotes().then(function () {
      if (!$("rk-grid")) return;
      var R = buildRankings();
      $("rk-grid").innerHTML = R.map(function (r) { return rkCard(r, { mini: true }); }).join("");
      function apply(c) {
        var n = 0;
        each("#rk-grid .rk-card", function (el) { var on = !c || el.getAttribute("data-cat") === c; el.hidden = !on; if (on) n++; });
        each(".rk-chips .chip", function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-c") === (c || ""))); });
        $("rk-count").textContent = n + " 件";
      }
      each(".rk-chips .chip", function (b) { b.addEventListener("click", function () { var c = b.getAttribute("data-c"); if (location.hash !== (c ? "#rankings-" + c : "#rankings")) { RK_SKIP = true; location.hash = c ? "#rankings-" + c : "#rankings"; } apply(c); }); });
      apply(cat || "");
    });
  }
  var RK_SKIP = false;
  function pageRankOne(id) {
    getVotes().then(function () {
      var R = buildRankings(), r = RK_BY[id];
      if (!r) { setView('<div class="wrap page"><div class="empty"><b>このランキングは見つかりません</b><a href="#rankings">ランキング集へ</a></div></div>', "ランキング"); return; }
      var same = R.filter(function (z) { return z.cat === r.cat && z !== r; }), i = R.indexOf(r), prev = R[(i - 1 + R.length) % R.length], next = R[(i + 1) % R.length];
      var h = '<div class="wrap page rk-page"><nav class="crumb" aria-label="現在地"><a href="#rankings">ランキング集</a> ／ <a href="#rankings-' + r.cat + '">' + esc(catLabel(r.cat)) + "</a></nav>";
      h += rkCard(r) + rkShareBar(r) + '<p class="rk-db"><span>データベースで確かめる</span><a href="' + r.db[0] + '">' + esc(r.db[1]) + " →</a></p>";
      h += '<section class="rank rk-full"><h2 class="rank-h">全順位</h2>' + rkList(r) + (r.extra || "") +
        '<div class="rk-basis"><h3>基準</h3><p>' + esc(r.basis) + '</p><p class="rk-srcs">' + r.src + "</p></div></section>";
      h += '<nav class="rk-nav" aria-label="ほかのランキング"><a href="#rank-' + prev.id + '">← ' + esc(prev.title) + '</a><a href="#rank-' + next.id + '">' + esc(next.title) + " →</a></nav>";
      if (same.length) h += '<section class="sec"><h2 class="rk-same-h">同じ分類（' + esc(catLabel(r.cat)) + "）のランキング</h2><div class=\"rk-grid\">" + same.map(function (z) { return rkCard(z, { mini: true }); }).join("") + "</div></section>";
      h += "</div>";
      setView(h, r.title);
    });
  }

  // ---------- 議席図（半円。1点＝1人）
  function seatGroups(house) {
    var list = MEM.filter(function (o) { return o.house === house; }), g = {};
    list.forEach(function (o) { if (!g[o.kaiha]) g[o.kaiha] = { k: o.kaiha, f: o.f, n: 0 }; g[o.kaiha].n++; });
    return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k, "ja"); });
  }
  function hemicycle(groups, opt) {
    opt = opt || {};
    var total = groups.reduce(function (s, g) { return s + g.n; }, 0);
    var r0 = 0.42, R = Math.max(3, Math.round((1 + Math.sqrt(1 + 4 * total / 3.0)) / 2));
    var radii = [], sum = 0;
    for (var i = 0; i < R; i++) { var r = r0 + (1 - r0) * i / (R - 1); radii.push(r); sum += r; }
    var counts = radii.map(function (r) { return Math.floor(total * r / sum); }), left = total - counts.reduce(function (a, b) { return a + b; }, 0);
    for (var k = R - 1; left > 0; k = (k - 1 + R) % R) { counts[k]++; left--; }
    var pts = [];
    radii.forEach(function (r, i) { var c = counts[i]; for (var j = 0; j < c; j++) { var a = c === 1 ? Math.PI / 2 : Math.PI * (1 - j / (c - 1)); pts.push({ a: a, x: r * Math.cos(a), y: r * Math.sin(a) }); } });
    pts.sort(function (p, q) { return q.a - p.a || q.y - p.y; });
    var rad = (1 - r0) / (R - 1) * 0.4, W = 200, H = 104, sc = 96;
    var s = '<svg class="hemi" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opt.label || "議席図") + '">', idx = 0;
    groups.forEach(function (g, gi) {
      s += '<g class="hg" data-g="' + gi + '" fill="' + g.f.color + '">';
      for (var n = 0; n < g.n; n++, idx++) { var p = pts[idx]; s += '<circle cx="' + (W / 2 + p.x * sc).toFixed(2) + '" cy="' + (H - 4 - p.y * sc).toFixed(2) + '" r="' + (rad * sc).toFixed(2) + '"/>'; }
      s += "</g>";
    });
    s += '<text x="' + W / 2 + '" y="' + (H - 14) + '" text-anchor="middle" class="hemi-n">' + fmt(total) + '</text><text x="' + W / 2 + '" y="' + (H - 4) + '" text-anchor="middle" class="hemi-l">' + esc(opt.center || "") + "</text></svg>";
    return s;
  }
  function seatBlock(house) {
    var g = seatGroups(house), tot = g.reduce(function (s, x) { return s + x.n; }, 0);
    var h = '<div class="seatblock" data-house="' + house + '"><div class="hemi-wrap">' + hemicycle(g, { label: houseName(house) + "の会派別議席図", center: "人（" + houseName(house) + "）" }) + "</div>";
    h += '<ul class="seat-legend">' + g.map(function (x, i) { return '<li data-g="' + i + '">' + badge(x.k, { full: true }) + '<span class="sl-n"><b>' + x.n + "</b>人</span><span class=\"sl-p\">" + pct(x.n, tot, 1) + "%</span></li>"; }).join("") + "</ul></div>";
    h += '<p class="note">' + (house === "hr" ? "出典：衆議院ホームページ 議員一覧（" + esc(S.members.meta.hr_asof || "") + "）。在籍 " + fmt(tot) + "人。" : "出典：" + esc(S.members.meta.hc_source || "") + "（" + esc(S.members.meta.hc_asof || "") + "）。") + "</p>";
    return h;
  }
  function bindSeatTips(root) {
    each(".seatblock", function (sb) {
      var house = sb.getAttribute("data-house"), g = seatGroups(house), tot = g.reduce(function (s, x) { return s + x.n; }, 0);
      function build(el, t) { var x = g[+el.getAttribute("data-g")]; tEl(t, "div", "tl", houseName(house)); tRow(t, x.f.color, x.n + "人（" + pct(x.n, tot, 1) + "%）", x.k); }
      each(".hg", function (el) {
        el.addEventListener("pointerenter", function (ev) { sb.classList.add("hl"); el.classList.add("on"); tipShow(ev, function (t) { build(el, t); }); });
        el.addEventListener("pointermove", tipMove);
        el.addEventListener("pointerleave", function () { sb.classList.remove("hl"); el.classList.remove("on"); tipHide(); });
      }, sb);
    }, root);
  }

  // ====================================================================== 競う見せ方（基準と計算式は画面に明記、全対象に同じ基準）
  // 議員個人には「上位入り」の達成バッジだけを付ける（低い順・ワーストは個人には付けない）
  var BADGES = {};
  function addBadge(o, label, href) { if (!o) return; (BADGES[o.id] = BADGES[o.id] || []).push({ label: label, href: href }); }
  function shareRank() {
    var out = [];
    Object.keys(S.districts).forEach(function (k) {
      var r = S.districts[k].result2026 || [], tot = r.reduce(function (s, x) { return s + x.votes; }, 0);
      r.forEach(function (x) { out.push({ name: x.name, party: x.party, votes: x.votes, share: tot ? x.votes / tot : 0, dn: S.districts[k].name, code: k }); });
    });
    return out.sort(function (a, b) { return b.share - a.share; });
  }
  function propMembers() {
    if (!S.prop) return [];
    return Object.keys(S.prop.members).map(function (n) { return { o: memByName(n, "hr"), n: S.prop.members[n] }; }).filter(function (x) { return x.o; })
      .sort(function (a, b) { return b.n - a.n || (a.o.y || "").localeCompare(b.o.y || "", "ja"); });
  }
  function hrVeterans() { return MEM.filter(function (o) { return o.house === "hr"; }).sort(function (a, b) { return b.terms - a.terms || a.y.localeCompare(b.y, "ja"); }); }
  function computeBadges() {
    BADGES = {};
    topVotes().slice(0, 10).forEach(function (x, i) { addBadge(memByName(x.name, "hr"), "得票数 全国TOP10（" + (i + 1) + "位）", "#rank-votes"); });
    shareRank().slice(0, 10).forEach(function (x, i) { addBadge(memByName(x.name, "hr"), "得票率 全国TOP10（" + (i + 1) + "位）", "#rank-share"); });
    var v = hrVeterans(), vn = rankNo(v, function (o) { return o.terms; });
    v.forEach(function (o, i) { if (vn[i] <= 10) addBadge(o, "当選回数 衆議院TOP10（" + vn[i] + "位）", "#rank-terms");
    var hv = MEM.filter(function (o) { return o.house === "hc"; }).sort(function (a, b) { return b.terms - a.terms || a.y.localeCompare(b.y, "ja"); }), hn = rankNo(hv, function (o) { return o.terms; });
    hv.forEach(function (o, i) { if (hn[i] <= 5) addBadge(o, "当選回数 参議院TOP5（" + hn[i] + "位）", "#rank-hcterms"); }); });
    var pm = propMembers(), pn = rankNo(pm, function (x) { return x.n; });
    pm.forEach(function (x, i) { if (pn[i] <= 10) addBadge(x.o, "議員立法の提出 TOP10（" + pn[i] + "位）", "#rank-propm"); });
  }
  function badgeRow(o) {
    var b = BADGES[o.id]; if (!b || !b.length) return "";
    return '<div class="ach">' + b.map(function (x) { return '<a class="ach-b" href="' + x.href + '">★ ' + esc(x.label) + "</a>"; }).join("") + "</div>";
  }
  // 小選挙区で1位になった割合（政党）。勝つことが目的の指標なので、ベスト／ワーストと段階（S〜E）を付ける
  var TIERS = [{ t: "S", lo: 0.75 }, { t: "A", lo: 0.5 }, { t: "B", lo: 0.25 }, { t: "C", lo: 0.1 }, { t: "D", lo: 0.000001 }, { t: "E", lo: -1 }];
  var TIER_RULE = "S＝75%以上、A＝50%以上、B＝25%以上、C＝10%以上、D＝0%より上、E＝0%（1位なし）";
  function tierOf(r) { for (var i = 0; i < TIERS.length; i++) if (r >= TIERS[i].lo) return TIERS[i].t; return "E"; }
  function tierBadge(t) { return '<span class="tier tier-' + t + '" title="段階 ' + t + '">' + t + "</span>"; }
  function winRates() {
    var c = {};
    Object.keys(S.districts).forEach(function (k) {
      var r = (S.districts[k].result2026 || []).slice().sort(function (a, b) { return b.votes - a.votes; });
      r.forEach(function (x, i) { var p = ep(x.party); if (!c[p]) c[p] = { p: p, n: 0, w: 0, second: 0 }; c[p].n++; if (i === 0) c[p].w++; if (i === 1) c[p].second++; });
    });
    return Object.keys(c).map(function (k) { var x = c[k]; x.r = x.w / x.n; x.tier = tierOf(x.r); return x; })
      .filter(function (x) { return x.n >= 5 && x.p !== "無所属" && x.p !== "諸派"; })
      .sort(function (a, b) { return b.r - a.r || b.w - a.w || b.n - a.n; });
  }
  // ワーストの順位（低い順。同じ値は同じ順位）
  function worstNo(list, x) { return list.filter(function (z) { return z.r < x.r; }).length + 1; }
  function propKaiha() {
    if (!S.prop) return [];
    return Object.keys(S.prop.kaiha).map(function (k) { return { k: k, n: S.prop.kaiha[k] }; }).sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k, "ja"); });
  }
  function times(a, b) { return b ? (a / b).toFixed(a / b >= 10 ? 0 : 1) : "—"; }

  // ---------- 対決比較（2つの政党）
  function famStats(f) {
    var V = S.votesHr, idx = S.curKaiha.filter(function (ki) { return fam(V.kaiha[ki]) === f; });
    var mem = MEM.filter(function (o) { return o.f === f; });
    var y = 0, n = 0;
    idx.forEach(function (ki) { var st = kaihaStats(ki, V.bills); y += st.y; n += st.n; });
    var prop = 0, pk = S.prop ? S.prop.kaiha : {};
    Object.keys(pk).forEach(function (k) { if (fam(k) === f) prop += pk[k]; });
    var wr = winRates().filter(function (x) { return fam(x.p) === f; })[0];
    return { f: f, idx: idx, hr: mem.filter(function (o) { return o.house === "hr"; }).length, hc: mem.filter(function (o) { return o.house === "hc"; }).length, y: y, n: n, prop: prop, wr: wr };
  }
  function pageVs(a, b) {
    var P = famsPresent().filter(function (x) { return x.f.family !== "その他" && x.f.family !== "無所属"; });
    if (!a || !b) { a = famSlug(P[0].f); b = famSlug(P[1].f); }
    var A = famBySlug(a), B = famBySlug(b);
    if (!A || !B) { a = famSlug(P[0].f); b = famSlug(P[1].f); A = P[0].f; B = P[1].f; }
    function sel(id, v) { return '<select id="' + id + '" aria-label="比べる政党">' + P.map(function (x) { var s2 = famSlug(x.f); return '<option value="' + s2 + '"' + (s2 === v ? " selected" : "") + ">" + esc(x.f.family) + "</option>"; }).join("") + "</select>"; }
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">対決比較</h1><p class="ph-sub">2つの政党、2つの小選挙区を、同じ物差しで並べます。勝ち負けを付けるのは「小選挙区で1位になった数」のように、多いほうが目的にかなう指標だけです。</p></header>';
    h += '<section class="sec"><div class="vs-pick">' + sel("vs-a", a) + '<span class="vs-x">対</span>' + sel("vs-b", b) + '</div><div id="vs-out"><div class="skeleton"></div></div></section>';
    h += '<section class="sec"><div class="sec-head"><h2>小選挙区の対決</h2><p class="sec-note">2つの小選挙区の第51回総選挙を並べます。</p></div><div class="vs-pick">' + distSel("vd-a", "13-01") + '<span class="vs-x">対</span>' + distSel("vd-b", "27-01") + '<button type="button" class="go go-dark" id="vd-go">比べる</button></div></section></div>';
    setView(h, "対決比較");
    function goVs() { var x = $("vs-a").value, y = $("vs-b").value; location.hash = "#vs-" + x + "-" + y; }
    $("vs-a").addEventListener("change", goVs); $("vs-b").addEventListener("change", goVs);
    $("vd-go").addEventListener("click", function () { location.hash = "#vsd-" + $("vd-a").value.replace("-", "") + "-" + $("vd-b").value.replace("-", ""); });
    getVotes().then(function () {
      if (!$("vs-out")) return;
      if (A === B) { $("vs-out").innerHTML = '<div class="empty"><b>同じ政党が選ばれています</b>別の政党を選んでください。</div>'; return; }
      var sa = famStats(A), sb = famStats(B), V = S.votesHr;
      function row(label, va, vb, fa, fb, opt) {
        opt = opt || {};
        var win = opt.dir ? (fa > fb ? "a" : fb > fa ? "b" : "") : "";
        var mx = Math.max(fa, fb) || 1;
        return '<div class="vs-row"><div class="vs-l">' + esc(label) + (opt.note ? '<span class="vs-note">' + esc(opt.note) + "</span>" : "") + '</div><div class="vs-a' + (win === "a" ? " win" : "") + '"><b>' + va + '</b><span class="vs-bar"><i style="width:' + (fa / mx * 100).toFixed(1) + "%;background:" + A.color + '"></i></span></div><div class="vs-b' + (win === "b" ? " win" : "") + '"><b>' + vb + '</b><span class="vs-bar"><i style="width:' + (fb / mx * 100).toFixed(1) + "%;background:" + B.color + '"></i></span></div></div>';
      }
      var seatA = sa.hr + sa.hc, seatB = sb.hr + sb.hc;
      var big = seatA >= seatB ? [A, seatA, B, seatB] : [B, seatB, A, seatA];
      var h2 = '<p class="vs-head">' + famBadge(A, A.family, { big: true }) + '<span class="vs-x">対</span>' + famBadge(B, B.family, { big: true }) + "</p>";
      h2 += '<p class="ph-big">議席は ' + esc(big[0].family) + " が " + esc(big[2].family) + " の <b>" + times(big[1], big[3]) + "</b>倍<span>国会議員 " + esc(A.family) + " " + seatA + "人・" + esc(B.family) + " " + seatB + "人</span></p>";
      h2 += '<div class="vs-grid"><div class="vs-row vs-hd"><div></div><div>' + famBadge(A) + "</div><div>" + famBadge(B) + "</div></div>";
      h2 += row("衆議院の議員", sa.hr + "人", sb.hr + "人", sa.hr, sb.hr);
      h2 += row("参議院の議員", sa.hc + "人", sb.hc + "人", sa.hc, sb.hc);
      var wa = sa.wr, wb = sb.wr;
      h2 += row("小選挙区で1位になった数", wa ? wa.w + "区" : "—", wb ? wb.w + "区" : "—", wa ? wa.w : 0, wb ? wb.w : 0, { dir: 1, note: "第51回総選挙。多いほうに印" });
      h2 += row("小選挙区の1位率", wa ? pct(wa.w, wa.n) + "% " + tierBadge(wa.tier) : "—", wb ? pct(wb.w, wb.n) + "% " + tierBadge(wb.tier) : "—", wa ? wa.r : 0, wb ? wb.r : 0, { dir: 1, note: "1位の数÷候補者数。" + TIER_RULE });
      h2 += row("衆議院の議案への賛成の割合", sa.y + sa.n ? pct(sa.y, sa.y + sa.n) + "%" : "—", sb.y + sb.n ? pct(sb.y, sb.y + sb.n) + "%" : "—", sa.y / Math.max(1, sa.y + sa.n), sb.y / Math.max(1, sb.y + sb.n), { note: "高い・低いに良し悪しはありません" });
      h2 += row("議員立法（衆法）の提出", fmt(sa.prop) + "件", fmt(sb.prop) + "件", sa.prop, sb.prop, { note: "共同提出を含む。与党は内閣提出の法律案が中心" });
      // 一致率
      var same = 0, both = 0;
      if (sa.idx.length && sb.idx.length) V.bills.forEach(function (bl) {
        var x = sa.idx.map(function (ki) { return stance(bl, ki); }).filter(function (q) { return q !== "u"; })[0], y = sb.idx.map(function (ki) { return stance(bl, ki); }).filter(function (q) { return q !== "u"; })[0];
        if (x && y) { both++; if (x === y) same++; }
      });
      h2 += "</div>";
      h2 += '<div class="vs-match"><p class="vs-mh">衆議院の議案で、賛否が同じだった割合</p><p class="vs-mv"><b>' + (both ? pct(same, both) : "—") + "</b>%</p><p class=\"note\">両方の会派の賛否が記録された " + fmt(both) + " 件のうち、同じだった " + fmt(same) + " 件（第" + S.maxS + "回国会に記録のある会派名どうし）。</p></div>";
      // 直接対決
      var dw = { a: 0, b: 0, list: [] };
      Object.keys(S.districts).forEach(function (k) {
        var r = (S.districts[k].result2026 || []).slice().sort(function (p, q) { return q.votes - p.votes; });
        if (r.length < 2) return;
        var f0 = fam(ep(r[0].party)), f1 = fam(ep(r[1].party));
        if ((f0 === A && f1 === B) || (f0 === B && f1 === A)) { dw[f0 === A ? "a" : "b"]++; dw.list.push({ k: k, r: r }); }
      });
      h2 += '<div class="vs-match"><p class="vs-mh">直接対決：1位と2位がこの2党だった小選挙区</p><p class="vs-mv">' + famBadge(A) + " <b>" + dw.a + '</b>勝 <span class="vs-x">対</span> ' + famBadge(B) + " <b>" + dw.b + "</b>勝</p>";
      if (dw.list.length) h2 += '<details><summary>' + dw.list.length + " 区を見る</summary><ul class=\"dl\">" + dw.list.map(function (x) { return "<li><b>" + esc(S.districts[x.k].name) + "</b>：" + esc(x.r[0].name) + "（" + esc(ep(x.r[0].party)) + "）" + fmt(x.r[0].votes) + "票、" + esc(x.r[1].name) + "（" + esc(ep(x.r[1].party)) + "）" + fmt(x.r[1].votes) + "票</li>"; }).join("") + "</ul></details>";
      h2 += "</div>";
      h2 += '<p class="note">出典：' + link(SMRI_HR, "国会議案データベース：衆議院") + "（" + esc(V.asof) + "）／" + link(ELEC_SRC, "矢内勇生 公開データ（第51回総選挙）") + "／衆議院・参議院 議員名簿。政党は全サイト共通の政党カラー表で会派名をまとめたもの。</p>";
      h2 += shareBar(A.family + " 対 " + B.family + "：国会議員 " + seatA + "人 対 " + seatB + "人、小選挙区の1位 " + (wa ? wa.w : 0) + "区 対 " + (wb ? wb.w : 0) + "区、衆議院の議案で賛否が同じだった割合 " + (both ? pct(same, both) : "—") + "%", "#vs-" + a + "-" + b);
      $("vs-out").innerHTML = h2;
    });
  }
  function distSel(id, v) {
    return '<select id="' + id + '" aria-label="小選挙区">' + Object.keys(S.districts).map(function (k) { return '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + esc(S.districts[k].name) + "</option>"; }).join("") + "</select>";
  }
  function distFacts(k) {
    var all = Object.keys(S.districts).map(function (c) { var r = (S.districts[c].result2026 || []).slice().sort(function (a, b) { return b.votes - a.votes; }); return { c: c, tot: r.reduce(function (s, x) { return s + x.votes; }, 0), diff: r.length > 1 ? r[0].votes - r[1].votes : 0, n: r.length }; });
    var me = all.filter(function (x) { return x.c === k; })[0];
    var rTot = all.filter(function (x) { return x.tot > me.tot; }).length + 1, rDiff = all.filter(function (x) { return x.diff < me.diff; }).length + 1;
    return { tot: me.tot, diff: me.diff, n: me.n, rTot: rTot, rDiff: rDiff, N: all.length };
  }
  function pageVsd(a, b) {
    var ka = a.slice(0, 2) + "-" + a.slice(2), kb = b.slice(0, 2) + "-" + b.slice(2);
    if (!S.districts[ka] || !S.districts[kb]) { pageVs(); return; }
    var h = '<div class="wrap page"><header class="ph"><p class="ph-pre">小選挙区の対決（第51回総選挙・2026年2月8日）</p><h1 class="ph-h">' + esc(S.districts[ka].name) + '<span class="vs-x">対</span>' + esc(S.districts[kb].name) + '</h1><p class="ph-sub"><a href="#vs">ほかの組み合わせを選ぶ</a></p></header><div class="vsd">';
    var share = [];
    [ka, kb].forEach(function (k) {
      var d = S.districts[k], F = distFacts(k), r = d.result2026 || [], vb = voteBars(r), top = vb.arr[0];
      share.push(d.name + "：1位 " + top.name + "（" + ep(top.party) + "）、1位と2位の差 " + F.diff + "票（全国" + F.rDiff + "位・小さい順）");
      h += '<section class="panel vsd-col"><h2>' + esc(d.name) + "</h2>";
      h += '<dl class="kv"><dt>有効票の合計</dt><dd><b>' + fmt(F.tot) + "</b>票（全国 " + F.rTot + "位／" + F.N + "区・多い順）</dd><dt>1位と2位の差</dt><dd><b>" + fmt(F.diff) + "</b>票（全国 " + F.rDiff + "位／" + F.N + "区・小さい順）</dd><dt>1位は2位の</dt><dd><b>" + (vb.arr[1] ? times(vb.arr[0].votes, vb.arr[1].votes) : "—") + "</b>倍の得票</dd><dt>候補者</dt><dd>" + F.n + "人</dd></dl>" + vb.html + "</section>";
    });
    h += '</div><p class="note">' + link(ELEC_SRC, "出典：矢内勇生 公開データ（第51回総選挙）") + "。順位は全国 " + Object.keys(S.districts).length + " 区の中での位置（同じ値は同じ順位）。</p>" + shareBar(share.join(" ／ "), "#vsd-" + a + "-" + b) + "</div>";
    setView(h, S.districts[ka].name + " 対 " + S.districts[kb].name);
    each(".vsd-col", function (col, i) { bindVoteBars(col, [{ name: S.districts[[ka, kb][i]].name, vb: voteBars(S.districts[[ka, kb][i]].result2026) }]); }, $("view"));
  }

  // ====================================================================== 住所
  function bindAddr() {
    if ($("sel-pref")) initPickers();
    $("addr").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); search($("addr").value); }
    });
    $("go").addEventListener("click", function () { search($("addr").value); });
    each("#examples button", function (b) { b.addEventListener("click", function () { $("addr").value = b.getAttribute("data-ex"); search($("addr").value); }); });
  }
  function msg(html) { if ($("msg")) $("msg").innerHTML = html || ""; }
  function initPickers() {
    var sp = $("sel-pref");
    S.prefs.forEach(function (p, i) { var o = document.createElement("option"); o.value = i + 1; o.textContent = p.name; sp.appendChild(o); });
    sp.addEventListener("change", function () { var pi = +sp.value; fillCities(pi); if (pi) loadPref(pi); });
    $("sel-city").addEventListener("change", function () {
      var pi = +sp.value, c = $("sel-city").value;
      if (!pi || !c) return;
      loadPref(pi).then(function (pd) { go(pi, c, ""); });
    });
    $("sel-town").addEventListener("change", function () { var pi = +sp.value; go(pi, $("sel-city").value, $("sel-town").value); });
  }
  function fillCities(pi, selected) {
    var sc = $("sel-city"); if (!sc) return;
    sc.innerHTML = '<option value="">選んでください</option>'; sc.disabled = !pi;
    $("sel-town").innerHTML = '<option value="">（指定しない）</option>'; $("sel-town").disabled = true;
    if (!pi) return;
    S.prefs[pi - 1].cities.forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; if (c === selected) o.selected = true; sc.appendChild(o); });
  }
  function loadPref(pi) {
    var k = ("0" + pi).slice(-2);
    if (S.pref[k]) return Promise.resolve(S.pref[k]);
    return getJSON("pref/" + k + ".json").then(function (d) { S.pref[k] = d; return d; });
  }
  function cityRec(pd, name) { for (var i = 0; i < pd.cities.length; i++) if (pd.cities[i].n === name) return pd.cities[i]; return null; }
  // 住所 → ハッシュに変えて移動（表示は route が行う）
  function go(pi, city, town) {
    loadPref(pi).then(function (pd) {
      var rec = cityRec(pd, city); if (!rec) return;
      var ci = pd.cities.indexOf(rec), ti = town ? rec.towns.indexOf(town) : -1;
      var h = "#p" + pi + "-c" + ci + (ti >= 0 ? "-t" + ti : "");
      if (location.hash === h) route(); else location.hash = h;
    });
  }
  function search(text) {
    var s = norm(text);
    msg("");
    if (!s) { msg("住所を入力してください。例：東京都千代田区永田町一丁目"); return; }
    var pi = 0, rest = s;
    for (var i = 0; i < S.prefs.length; i++) if (s.indexOf(norm(S.prefs[i].name)) === 0) { pi = i + 1; rest = s.slice(norm(S.prefs[i].name).length); break; }
    var hits = [], prefRange = pi ? [pi] : S.prefs.map(function (_, i) { return i + 1; });
    prefRange.forEach(function (p) {
      S.prefs[p - 1].cities.forEach(function (c) {
        var nc = norm(c), short = nc.replace(/^.+?郡/, "");
        if (rest.indexOf(nc) === 0) hits.push({ pi: p, c: c, len: nc.length, rest: rest.slice(nc.length) });
        else if (short !== nc && rest.indexOf(short) === 0) hits.push({ pi: p, c: c, len: short.length, rest: rest.slice(short.length) });
      });
    });
    if (!hits.length) {
      var wards = [];
      prefRange.forEach(function (p) { S.prefs[p - 1].cities.forEach(function (c) { var m = c.match(/^(.+?市)(.+区)$/); if (m && rest.indexOf(norm(m[1])) === 0) wards.push({ pi: p, c: c }); }); });
      if (wards.length) {
        msg("区を選んでください：<br>" + wards.map(function (w) { return '<button type="button" class="btn-sub choice" data-pi="' + w.pi + '" data-c="' + esc(w.c) + '">' + esc(w.c) + "</button>"; }).join(""));
        bindChoices(); return;
      }
      msg(pi ? esc(S.prefs[pi - 1].name) + "の市区町村名が見つかりませんでした。市区町村名を確かめるか、「一覧から選ぶ」を使ってください。" : "都道府県名または市区町村名が見つかりませんでした。都道府県名から入力してください（例：東京都千代田区）。");
      if (pi && $("sel-pref")) { $("sel-pref").value = pi; fillCities(pi); $("pickers").open = true; }
      return;
    }
    hits.sort(function (a, b) { return b.len - a.len; });
    var best = hits.filter(function (h) { return h.len === hits[0].len; }), uniq = {};
    best = best.filter(function (h) { var k = h.pi + h.c; if (uniq[k]) return false; uniq[k] = 1; return true; });
    if (best.length > 1) {
      msg("同じ名前の市区町村が複数あります。選んでください：<br>" + best.map(function (w) { return '<button type="button" class="btn-sub choice" data-pi="' + w.pi + '" data-c="' + esc(w.c) + '" data-rest="' + esc(w.rest) + '">' + esc(S.prefs[w.pi - 1].name + w.c) + "</button>"; }).join(""));
      bindChoices(); return;
    }
    var h = best[0];
    loading(true);
    loadPref(h.pi).then(function (pd) {
      loading(false);
      var town = matchTown(cityRec(pd, h.c), h.rest);
      if (h.rest && !town) S.townMiss = h.rest; else S.townMiss = null;
      go(h.pi, h.c, town || "");
    });
  }
  function bindChoices() {
    each(".choice", function (b) {
      b.addEventListener("click", function () {
        var pi = +b.getAttribute("data-pi"), c = b.getAttribute("data-c"), rest = b.getAttribute("data-rest") || "";
        loadPref(pi).then(function (pd) { go(pi, c, matchTown(cityRec(pd, c), rest) || ""); });
      });
    });
  }
  function matchTown(rec, rest) {
    if (!rec || !rest) return null;
    var r1 = digitsToKanji(rest).replace(/^大字/, "").replace(/^字/, ""), tries = [r1];
    var m = r1.match(/^(\D+?)(\d+)(?:-|番|$)/);
    if (m) { var k = kanji(m[2]); if (k) tries.push(m[1] + k + "丁目"); }
    var best = null, bestLen = 0;
    rec.towns.forEach(function (t) { var tk = townKey(t); tries.forEach(function (r) { if (r.indexOf(tk) === 0 && tk.length > bestLen) { best = t; bestLen = tk.length; } }); });
    return best;
  }
  function districtsFor(rec, town) { if (rec.split && town && rec.td && rec.td[town]) return rec.td[town]; return rec.d || []; }
  function regionMembers(pd, dist) {
    var r = { hrD: [], hrB: [], hc: [] };
    dist.forEach(function (d) { MEM.forEach(function (o) { if (o.house === "hr" && o.m.district === d) r.hrD.push(o); }); });
    var block = dist.length && S.districts[dist[0]] ? S.districts[dist[0]].block : pd.block;
    r.block = block;
    r.hrB = MEM.filter(function (o) { return o.house === "hr" && o.m.block === block; });
    r.hc = MEM.filter(function (o) { return o.house === "hc" && o.m.prefs && o.m.prefs.indexOf(pd.pref) >= 0; });
    r.hc.sort(function (a, b) { return (a.m.expiry || "").localeCompare(b.m.expiry || ""); });
    return r;
  }

  function routeAddress(pi, ci, ti) {
    if (!S.prefs[pi - 1]) { pageTop(); return; }
    if (CUR && CUR.pi === pi && CUR.ci === ci && CUR.ti === ti && $("result")) return;
    loading(true);
    loadPref(pi).then(function (pd) {
      loading(false);
      var rec = pd.cities[ci];
      if (!rec) { pageTop(); return; }
      var town = ti >= 0 ? rec.towns[ti] || "" : "";
      CUR = { pi: pi, ci: ci, ti: ti };
      pageAddress(pi, pd, rec, town);
    }).catch(function (e) { loading(false); setView('<div class="wrap"><div class="empty"><b>都道府県のデータを読み込めませんでした</b>' + esc(e.message) + "</div></div>"); });
  }

  // 名札（議員の名前が主役。写真は使わない）
  function plate(o, opt) {
    opt = opt || {};
    var st = "--pc:" + o.f.color;
    return '<a class="np' + (opt.big ? " np-big" : "") + '" href="#m-' + o.id + '" style="' + st + '"><span class="np-band" aria-hidden="true"></span><span class="np-y">' + esc(o.y) + '</span><span class="np-n">' + esc(o.name) + '</span><span class="np-b">' + badge(o.kaiha, { link: false, sm: !opt.big }) + '</span><span class="np-w">' + esc(houseName(o.house)) + " " + esc(o.where) + (o.terms ? "・" + esc(termsTxt(o.m.terms)) : "") + "</span>" + (BADGES[o.id] ? '<span class="np-ach">' + BADGES[o.id].map(function (x) { return "★" + esc(x.label.replace(/（.*/, "")); }).join(" ") + "</span>" : "") + "</a>";
  }
  // 政党ごとの内訳（政党カラー表でまとめる。表のどの政党にも当たらない「その他」は会派名ごと）
  function compBar(list, id) {
    var g = {}, order = [];
    list.forEach(function (o) {
      var key = o.f.family === "その他" ? o.kaiha : o.f.family;
      if (!g[key]) { g[key] = { k: o.kaiha, f: o.f, n: 0, names: {} }; order.push(key); }
      g[key].n++; g[key].names[o.kaiha] = 1;
    });
    order.forEach(function (k) { var x = g[k], nm = Object.keys(x.names); if (nm.length > 1) x.kList = nm; });
    var arr = order.map(function (k) { return g[k]; }).sort(function (a, b) { return b.n - a.n || a.k.localeCompare(b.k, "ja"); });
    var tot = list.length || 1;
    var h = '<div class="comp" id="' + id + '"><div class="comp-bar">' + arr.map(function (x, i) { return '<span class="cseg" data-i="' + i + '" style="flex:' + x.n + ";background:" + x.f.color + '" aria-label="' + esc(x.k) + " " + x.n + '人"></span>'; }).join("") + "</div>";
    h += '<ul class="comp-leg">' + arr.map(function (x) { return "<li>" + badge(x.k) + "<b>" + x.n + "</b>人</li>"; }).join("") + "</ul></div>";
    return { html: h, arr: arr, tot: tot };
  }
  function bindComp(root, c) {
    bindTip(root, ".cseg", function (el, t) { var x = c.arr[+el.getAttribute("data-i")]; tRow(t, x.f.color, x.n + "人（" + pct(x.n, c.tot) + "%）", (x.kList || [x.k]).join("／")); });
  }

  function pageAddress(pi, pd, rec, town) {
    var dist = districtsFor(rec, town), R = regionMembers(pd, dist);
    var all = R.hrD.concat(R.hc).concat(R.hrB), total = all.length;
    var place = pd.pref + (rec.parent ? rec.parent.n : "") + (rec.parent ? rec.n.replace(rec.parent.n, "") : rec.n.replace(/^.+?郡/, ""));
    var placeFull = pd.pref + rec.n + (town || "");
    var dLabel = !dist.length ? "選挙区：未取得" : dist.length === 1 ? dname(dist[0]) : dist.length + "つの小選挙区にまたがる";
    var h = '<div class="wrap page" id="result">';
    h += '<header class="ph ph-addr"><p class="ph-pre">' + esc(pd.pref) + (rec.parent ? "　" + esc(rec.parent.n) : "") + '</p><h1 class="ph-h" id="sum-h">' + esc(rec.parent ? rec.n.replace(rec.parent.n, "") : rec.n.replace(/^.+?郡/, "")) + (town ? '<span class="ph-town">' + esc(town) + "</span>" : "") + "</h1>";
    h += '<p class="ph-big">あなたの地域の国会議員 <b>' + total + "</b>人</p>";
    h += '<p class="ph-sub">' + esc(dLabel) + "・衆議院 小選挙区 " + R.hrD.length + "人／比例 " + esc(R.block || "") + "ブロック " + R.hrB.length + "人／参議院 選挙区 " + R.hc.length + "人</p>";
    if (S.townMiss) { h += '<p class="msg-inline">町丁目「' + esc(S.townMiss) + "」は住所データの中で見つからなかったため、市区町村までで表示しています。</p>"; S.townMiss = null; }
    h += "</header>";
    h += '<nav class="secnav" id="secnav" aria-label="この結果の項目"><button type="button" data-go="sec-members">議員</button><button type="button" data-go="sec-district">選挙区と得票</button><button type="button" data-go="sec-votes">議案への賛否</button><button type="button" data-go="sec-money">お金</button><button type="button" data-go="sec-share">シェア用カード</button></nav>';

    // 議員
    h += '<section class="sec" id="sec-members" aria-labelledby="h-members"><div class="sec-head"><h2 id="h-members">あなたの選挙区の議員 ' + R.hrD.length + "名</h2><p class=\"sec-note\">衆議院 " + esc(dist.map(dname).join("・") || "—") + "</p></div>";
    h += R.hrD.length ? '<div class="np-grid np-grid-big">' + R.hrD.map(function (o) { return plate(o, { big: true }); }).join("") + "</div>" : '<div class="empty"><b>議員が見つかりません</b>現在の名簿にこの選挙区の議員はいません（欠員の可能性があります）。</div>';
    var label = R.hc.length && R.hc[0].m.senkyoku ? R.hc[0].m.senkyoku : pd.pref;
    h += '<h3 class="h3">参議院 ' + esc(label) + "選挙区の議員 " + R.hc.length + "名</h3>";
    h += R.hc.length ? '<div class="np-grid">' + R.hc.map(function (o) { return plate(o); }).join("") + "</div>" : '<div class="empty">名簿に該当者がいません。</div>';
    h += '<h3 class="h3">衆議院 比例代表 ' + esc(R.block) + "ブロックの議員 " + R.hrB.length + "名</h3>";
    h += '<div class="np-grid np-grid-sm">' + R.hrB.map(function (o) { return plate(o); }).join("") + "</div>";
    var comp = compBar(all, "comp-addr");
    h += '<h3 class="h3">この ' + total + "人の政党の内訳</h3>" + comp.html;
    h += '<p class="note">参議院の比例代表（全国が1つの選挙区）は含めていません。出典：衆議院 議員一覧（' + esc(S.members.meta.hr_asof || "") + "）／" + esc(S.members.meta.hc_source || "") + "（" + esc(S.members.meta.hc_asof || "") + "）。</p>";
    h += shareBar(placeFull + "の国会議員は " + total + "人。" + (R.hrD.length ? "小選挙区（" + dist.map(dname).join("・") + "）：" + R.hrD.map(function (o) { return o.name + "（" + shortName(o.kaiha) + "）"; }).join("、") + "。" : "") + "政党の内訳：" + comp.arr.map(function (x) { return shortName(x.k) + x.n; }).join("・"), location.hash);
    h += "</section>";

    h += '<div class="cols"><section class="sec panel" id="sec-district" aria-labelledby="h-district"><h2 id="h-district">衆議院の小選挙区と得票</h2><div id="district"></div></section>';
    h += '<section class="sec panel" id="sec-place" aria-labelledby="h-place"><h2 id="h-place">自治体と政治資金</h2><div id="place"></div><div id="shikin"></div></section></div>';
    h += '<section class="sec panel" id="sec-votes" aria-labelledby="h-votes"><h2 id="h-votes">この地域の議員の会派は、議案にどう投票したか</h2><div id="votes"></div></section>';
    h += '<section class="sec panel" id="sec-money" aria-labelledby="h-money"><h2 id="h-money">' + esc(rec.parent ? rec.parent.n : rec.n) + "の予算・入札・補助金</h2><div id=\"money\"></div></section>";
    h += '<section class="sec" id="sec-share" aria-labelledby="h-share"><div class="sec-head"><h2 id="h-share">シェア用カード</h2><p class="sec-note">この1枚をスクリーンショットして使えます。</p></div>' + shareCardAddr(placeFull, dist, R, comp) + "</section>";
    h += addrPlate(true);
    h += "</div>";
    setView(h, placeFull + "の議員");
    bindAddr();
    $("addr").value = placeFull;
    bindComp($("view"), comp);
    each(".comp-card", function (el) { bindComp(el, comp); });
    renderDistrict(pd, rec, town, dist);
    renderPlace(pd, rec);
    renderVotesAddr(R);
    renderMoney(pd, rec);
  }

  function shareCardAddr(place, dist, R, comp) {
    var h = '<figure class="scard" aria-label="シェア用カード"><div class="sc-top"><span class="sc-site">住所から見る 地域の政治とお金</span><span class="sc-date">' + esc(S.meta.built.slice(0, 10)) + ' 時点</span></div>';
    h += '<p class="sc-place">' + esc(place) + "</p>";
    h += '<p class="sc-head">この地域の国会議員 <b>' + (R.hrD.length + R.hc.length + R.hrB.length) + "</b>人</p>";
    if (R.hrD.length) h += '<div class="sc-names"><span class="sc-lab">' + esc(dist.map(dname).join("・")) + "</span>" + R.hrD.map(function (o) { return '<span class="sc-nm">' + esc(o.name) + badge(o.kaiha, { link: false, sm: true }) + "</span>"; }).join("") + "</div>";
    if (R.hc.length) h += '<div class="sc-names sc-names-2"><span class="sc-lab">参議院 選挙区</span>' + R.hc.map(function (o) { return '<span class="sc-nm">' + esc(o.name) + badge(o.kaiha, { link: false, sm: true }) + "</span>"; }).join("") + "</div>";
    h += '<div class="comp-card">' + comp.html.replace('id="comp-addr"', 'id="comp-card"') + "</div>";
    h += '<p class="sc-src">出典：衆議院・参議院 議員名簿、スマートニュース メディア研究所、公職選挙法 別表第一 ほか（衆議院 比例 ' + esc(R.block) + "ブロック " + R.hrB.length + "人を含む）</p></figure>";
    return h;
  }

  function voteBars(r, me) {
    var arr = r.slice().sort(function (a, b) { return b.votes - a.votes; });
    var total = arr.reduce(function (s, x) { return s + x.votes; }, 0), max = arr.length ? arr[0].votes : 0;
    var h = '<div class="bars" role="list">';
    arr.forEach(function (x, i) {
      var f = fam(ep(x.party)), o = memByName(x.name, null), isMe = me && snorm(me) === snorm(x.name);
      h += '<div class="bar-row' + (isMe ? " me" : "") + '" role="listitem" data-i="' + i + '"><div class="bar-name">' + (o ? '<a href="#m-' + o.id + '">' + esc(x.name) + "</a>" : esc(x.name)) + " " + badge(ep(x.party), { sm: true }) + (i === 0 ? '<span class="flag">最多得票</span>' : "") + (isMe ? '<span class="flag me">この議員</span>' : "") + '</div><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + (x.votes / max * 100).toFixed(1) + "%;background:" + f.color + '"></div></div><span class="bar-v"><b>' + fmt(x.votes) + "</b>票 " + pct(x.votes, total, 1) + "%</span></div></div>";
    });
    return { html: h + "</div>", total: total, arr: arr };
  }
  function bindVoteBars(root, sets) {
    each(".bars", function (bs, bi) {
      bindTip(bs, ".bar-row", function (el, t) {
        var set = sets[bi]; if (!set) return;
        var x = set.vb.arr[+el.getAttribute("data-i")];
        tEl(t, "div", "tl", set.name);
        tRow(t, fam(ep(x.party)).color, fmt(x.votes) + "票（" + pct(x.votes, set.vb.total, 1) + "%）", x.name + "（" + x.party + "）");
      });
    }, root);
  }
  function renderDistrict(pd, rec, town, dist) {
    var h = "";
    if (!dist.length) { $("district").innerHTML = '<div class="empty"><b>選挙区を特定できませんでした</b>区割り表と住所の照合ができなかった市区町村です。各市区町村の選挙管理委員会で確認してください。</div>'; return; }
    var block = S.districts[dist[0]] && S.districts[dist[0]].block;
    if (dist.length === 1) {
      h += '<p class="big-district">' + esc(dname(dist[0])) + '</p><p class="district-meta">比例代表は ' + esc(block || "") + "ブロック</p>";
      if (rec.split && town) h += '<p class="note">' + esc(rec.n) + "は複数の選挙区に分かれていますが、" + esc(town) + "は区割り表で" + esc(dname(dist[0])) + "に含まれています。</p>";
    } else {
      h += '<div class="multi"><b>' + dist.length + "つの選挙区にまたがっています</b><br>" + (town ? esc(town) + "は番地・支所の管轄などで分かれるため、町丁目だけでは一つに決められません。" : esc(rec.n) + "は複数の選挙区に分かれています。町丁目まで入れると絞り込める場合があります。") + '<div class="tags">' + dist.map(function (d) { return '<span class="tag">' + esc(dname(d)) + "</span>"; }).join("") + "</div></div>";
      if (town && rec.geo && rec.geo[town]) h += '<p class="note">参考：町丁目の代表点（1点）は、簡略化した選挙区地図の上では ' + esc(dname(rec.geo[town])) + " の中にあります（正式な判定ではありません）。</p>";
      h += '<p class="district-meta">比例代表は ' + esc(block || "") + "ブロック</p>";
    }
    var sets = [];
    dist.forEach(function (d) {
      var r = S.districts[d] && S.districts[d].result2026; if (!r) return;
      var vb = voteBars(r); sets.push({ name: dname(d), vb: vb });
      h += '<h3 class="sub-h"><span>' + esc(dname(d)) + "の得票</span><span class=\"note\">2026年2月8日 第51回総選挙・有効票計 " + fmt(vb.total) + "</span></h3>" + vb.html;
    });
    h += '<p class="note">得票：' + link(ELEC_SRC, "矢内勇生 公開データ（ryomakom/lower_election_district2026 経由）") + "。党派は略称、得票の多い順。割合は候補者の得票合計に対する比。</p>";
    if (rec.split && rec.spec) {
      h += "<details><summary>区割り表の記述を見る（公職選挙法 別表第一）</summary>";
      Object.keys(rec.spec).forEach(function (d) { h += "<div><b>" + esc(dname(d)) + '</b></div><div class="spec">' + esc(rec.spec[d]) + "</div>"; });
      h += "</details>";
    }
    h += '<p class="note">判定：' + (rec.m === "law" ? "公職選挙法 別表第一（区割り表）の市区町村名・町丁目名との照合" : "区割り表では「" + esc((rec.note || "").replace(/^.*「(.+?)」.*$/, "$1")) + "」のようにまとめて書かれているため、町丁目の代表点と小選挙区の地図（gtfs-gis.jp, CC0）を重ねた位置による判定") + "。" + link(S.meta.law.source, "公職選挙法 別表第一") + "。投票所などの確定情報は各市区町村の選挙管理委員会で確認してください。</p>";
    $("district").innerHTML = h;
    bindVoteBars($("district"), sets);
  }
  function renderPlace(pd, rec) {
    var p = '<dl class="kv"><dt>団体コード</dt><dd>' + (rec.c ? esc(rec.c) : "なし") + (rec.parent ? "（" + esc(rec.parent.n) + " " + esc(rec.parent.c) + "）" : "") + "</dd>";
    p += "<dt>都道府県コード</dt><dd>" + esc(pd.code) + "</dd>";
    p += "<dt>公式サイト</dt><dd>" + (rec.url ? link(rec.url, shortUrl(rec.url)) : '<span class="muted-pill">未取得</span>') + "</dd>";
    if (pd.prefOffice && pd.prefOffice.url) p += "<dt>" + esc(pd.pref) + "</dt><dd>" + link(pd.prefOffice.url, shortUrl(pd.prefOffice.url)) + "</dd>";
    p += "</dl>";
    if (!rec.c) p += '<p class="note">住所データ上の旧区名のため団体コードはありません（浜松市は2024年1月に区を再編）。</p>';
    $("place").innerHTML = p;
    var M = S.members, anyShikin = M.hr.some(function (m) { return m.shikin; });
    var sh = '<h3 class="h3">議員の政治資金</h3><p class="p">国会議員の政治団体の収支報告書（令和6年分）は、総務省の' + link(M.meta.shikin_index || SEIJISHIKIN_SG, "国会議員関係政治団体の一覧") + "に候補者の五十音順で載っています。ページ内で議員名を検索してください。</p>";
    sh += '<p class="note">都道府県の選挙管理委員会に届け出た団体の分は、各都道府県のサイトで公表されています（' + link(SEIJISHIKIN_TOP, "総務省 政治資金") + "）。</p>";
    if (!anyShikin) sh += pending("議員ごとの報告書PDFへの直接リンク", "総務省 政治資金収支報告書（scripts/fetch_seijishikin_links.py）");
    $("shikin").innerHTML = sh;
  }

  // ---------- 住所ページの議案賛否（会派ごと）
  var VS = null;
  function renderVotesAddr(R) {
    var box = $("votes");
    box.innerHTML = '<div class="skeleton" style="width:40%"></div><div class="skeleton"></div><div class="skeleton" style="width:85%"></div>';
    getVotes().then(function () {
      if (!$("votes")) return;
      var V = S.votesHr, seen = {}, region = [];
      R.hrD.concat(R.hrB).forEach(function (o) { if (!seen[o.kaiha]) { seen[o.kaiha] = 1; region.push(o.kaiha); } });
      var current = S.curKaiha.map(function (i) { return V.kaiha[i]; });
      VS = { region: region, current: current, scope: "region", on: {}, q: "", qRaw: "", s: "", tag: "", noUnan: false, n: 15 };
      region.concat(current).forEach(function (k) { VS.on[k] = true; });
      var h = '<p class="note" style="margin:0 0 12px">個々の議員の投票ではなく、<b>会派としての賛否</b>です（衆議院は会派単位の記録のみ公表）。参議院の会派別賛否は未取得のため、' + link("#bills", "議案のページ") + "で議決の結果と原本へのリンクを見られます。</p>";
      h += '<div id="votes-body"></div>';
      box.innerHTML = h.replace('href="#bills" target="_blank" rel="noopener"', 'href="#bills"');
      drawHr();
    }).catch(function (e) { box.innerHTML = '<div class="empty"><b>議案データを読み込めませんでした</b>' + esc(e.message) + "</div>"; });
  }
  function tagSelect(id, val) {
    return '<select id="' + id + '" aria-label="政策分野（自動分類）"><option value="">すべての分野</option>' + S.ptags.rules.map(function (r) { return '<option value="' + r.id + '"' + (val === r.id ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select>";
  }
  function drawHr() {
    var V = S.votesHr, list = VS.scope === "all" ? VS.current : VS.region;
    var h = '<div class="chips" id="k-chips" role="group" aria-label="表示する会派">' + list.map(function (k) {
      var f = fam(k);
      return '<button type="button" class="chip" style="--pc:' + f.color + '" data-k="' + esc(k) + '" aria-pressed="' + (VS.on[k] !== false) + '"' + (V.kaiha.indexOf(k) >= 0 ? "" : ' title="会派としての賛否の記録がありません"') + "><i></i>" + esc(k) + "</button>";
    }).join("") + "</div>";
    var sessions = {}; V.bills.forEach(function (b) { sessions[b.s] = 1; });
    h += '<div class="filters" role="group" aria-label="絞り込み"><input type="search" id="f-q" placeholder="議案名で絞り込む（例：予算、税）" value="' + esc(VS.qRaw) + '" aria-label="議案名で絞り込む">';
    h += '<select id="f-s" aria-label="国会の回次"><option value="">すべての国会</option>' + Object.keys(sessions).sort(function (a, b) { return b - a; }).map(function (s) { return '<option value="' + s + '"' + (VS.s === s ? " selected" : "") + ">第" + s + "回国会</option>"; }).join("") + "</select>";
    h += tagSelect("f-g", VS.tag);
    h += '<label class="chk"><input type="checkbox" id="f-u"' + (VS.noUnan ? " checked" : "") + ">全会一致を除く</label><label class=\"chk\"><input type=\"checkbox\" id=\"f-all\"" + (VS.scope === "all" ? " checked" : "") + ">現在のすべての会派と比べる</label><span class=\"count\" id=\"f-count\"></span></div>";
    h += '<div id="hr-out"></div>';
    $("votes-body").innerHTML = h;
    each("#k-chips .chip", function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-k"); VS.on[k] = VS.on[k] === false; b.setAttribute("aria-pressed", String(VS.on[k])); VS.n = 15; drawHrOut(); }); });
    $("f-all").addEventListener("change", function () { VS.scope = this.checked ? "all" : "region"; drawHr(); });
    var t = null;
    $("f-q").addEventListener("input", function () { var q = this; clearTimeout(t); t = setTimeout(function () { VS.qRaw = q.value; VS.q = snorm(q.value); VS.n = 15; drawHrOut(); }, 180); });
    $("f-s").addEventListener("change", function () { VS.s = this.value; VS.n = 15; drawHrOut(); });
    $("f-g").addEventListener("change", function () { VS.tag = this.value; VS.n = 15; drawHrOut(); });
    $("f-u").addEventListener("change", function () { VS.noUnan = this.checked; VS.n = 15; drawHrOut(); });
    drawHrOut();
  }
  function drawHrOut() {
    var V = S.votesHr, out = $("hr-out");
    var list = (VS.scope === "all" ? VS.current : VS.region).filter(function (k) { return VS.on[k] !== false; });
    var noRec = list.filter(function (k) { return V.kaiha.indexOf(k) < 0; });
    var ks = list.filter(function (k) { return V.kaiha.indexOf(k) >= 0; }), kis = ks.map(function (k) { return V.kaiha.indexOf(k); });
    var rows = V.bills.filter(function (b) {
      if (VS.s && String(b.s) !== VS.s) return false;
      if (VS.q && b.key.indexOf(VS.q) < 0) return false;
      if (VS.tag && b.g.indexOf(VS.tag) < 0) return false;
      if (VS.noUnan && b.how === "全会一致") return false;
      for (var i = 0; i < kis.length; i++) if (b.y.indexOf(kis[i]) >= 0 || b.n.indexOf(kis[i]) >= 0) return true;
      return false;
    });
    $("f-count").textContent = "該当 " + fmt(rows.length) + " 件";
    if (!VS.region.length && VS.scope === "region") { out.innerHTML = '<div class="empty"><b>この地域の衆議院議員がいません</b>「現在のすべての会派と比べる」にチェックすると、全会派の記録を見られます。</div>'; return; }
    if (!ks.length) { out.innerHTML = '<div class="empty"><b>表示する会派がありません</b>' + (noRec.length ? esc(noRec.join("、")) + "は会派としての賛否の記録がありません。" : "上の会派ボタンを押して、表示する会派を選んでください。") + "</div>"; return; }
    if (!rows.length) { out.innerHTML = '<div class="empty"><b>条件に合う議案がありません</b>議案名・国会の回次・分野の条件をゆるめてください。</div>'; return; }
    var stats = ks.map(function (k, i) { var st = kaihaStats(kis[i], rows); st.k = k; return st; });
    var h = '<div class="viz"><h3 class="h3">会派ごとの賛成の割合</h3><p class="cap">表示中の ' + fmt(rows.length) + " 件のうち、その会派の賛否が記録された議案に占める賛成の割合。白＝賛成、斜線＝反対。</p>";
    stats.forEach(function (st, i) {
      var tot = st.y + st.n;
      h += '<div class="rate-row" data-i="' + i + '"><span class="rate-name">' + badge(st.k) + '</span><span class="rate-bar">' + yesBar(st.y, st.n) + '</span><span class="rate-v"><b>' + pct(st.y, tot) + "%</b> 賛成" + fmt(st.y) + "・反対" + fmt(st.n) + "</span></div>";
    });
    if (noRec.length) h += '<p class="note">' + esc(noRec.join("、")) + "：会派としての賛否の記録はありません（無所属の議員や、結成後まだ採決のない会派など）。</p>";
    h += "</div>";
    // ヒートマップ
    var w = out.clientWidth || 800, labelW = w < 600 ? 72 : 150;
    var maxCols = Math.max(12, Math.min(120, Math.floor((w - labelW) / 9)));
    var hb = rows.slice(0, maxCols).reverse();
    h += '<div class="viz"><h3 class="h3">議案ごとの賛否</h3><p class="cap">直近の ' + hb.length + " 件（左が古く、右が新しい）。1マス＝1議案。マスに触れると議案名と各会派の賛否が出ます。</p>";
    h += '<div class="legend"><span><i class="lg y"></i>賛成</span><span><i class="lg n"></i>反対</span><span><i class="lg u"></i>記録なし</span></div>';
    h += '<div class="heat-wrap"><div class="heat" id="heat">';
    ks.forEach(function (k, r) {
      h += '<div class="heat-row"><span class="heat-label">' + badge(k, { sm: true }) + '</span><div class="heat-cells" style="grid-template-columns:repeat(' + hb.length + ',minmax(0,1fr))">';
      hb.forEach(function (b, c) { var s = stance(b, kis[r]); h += '<span class="cell ' + s + '" data-c="' + c + '" aria-label="' + esc(b.t) + "：" + ST_LABEL[s] + '"></span>'; });
      h += "</div></div>";
    });
    h += '</div><div class="heat-axis"><span></span><div><span>' + (hb[0] ? esc(hb[0].dt || "第" + hb[0].s + "回") : "") + "</span><span>" + (hb.length ? esc(hb[hb.length - 1].dt || "") : "") + "</span></div></div></div></div>";
    // 一覧
    h += '<div class="viz"><h3 class="h3">議案の一覧</h3><p class="cap">国会回次の新しい順。議案名を押すと、その議案のページ（会派ごとの賛否）を開きます。</p><ul class="bill-list">';
    rows.slice(0, VS.n).forEach(function (b) {
      h += '<li class="bill"><div class="bill-t"><a href="#bill-hr-' + b.id + '">' + esc(b.t) + '</a></div><div class="bill-m">第' + b.s + "回国会・" + esc(b.k) + (b.dt ? "・" + esc(b.dt) : "") + "・本会議 " + esc(b.res) + (b.how ? "（" + esc(b.how) + "）" : "") + "・" + link(b.u, "審議経過（原本）") + "</div>" + billTags(b) + '<div class="stances">' +
        ks.map(function (k, i) { var s = stance(b, kis[i]); return '<span class="stance">' + badge(k, { sm: true, link: false }) + stPill(s) + "</span>"; }).join("") + "</div></li>";
    });
    h += "</ul>";
    if (rows.length > VS.n) h += '<button type="button" class="btn-sub more" id="more">さらに 30 件表示（残り ' + fmt(rows.length - VS.n) + " 件）</button>";
    h += "</div>";
    h += '<p class="note">出典：' + link(SMRI_HR, V.source) + "（データ更新 " + esc(V.asof) + "）。第196回国会（2018年）以降、衆議院本会議で会派の賛否が記録された議案。会派名が変わった場合、以前の名前での記録は別の会派として扱われます。</p>";
    out.innerHTML = h;
    if ($("more")) $("more").addEventListener("click", function () { VS.n += 30; drawHrOut(); });
    bindTip(out, ".rate-row[data-i]", function (el, t) {
      var st = stats[+el.getAttribute("data-i")], tot = st.y + st.n;
      tEl(t, "div", "tl", st.k);
      tRow(t, "#f4f5f7", fmt(st.y) + "件", "賛成"); tRow(t, null, fmt(st.n) + "件", "反対");
      tEl(t, "div", "tl", "賛成の割合 " + pct(st.y, tot, 1) + "%");
    });
    bindHeat(out, hb, ks, kis);
  }
  function bindHeat(out, hb, ks, kis) {
    each(".cell", function (c) {
      c.addEventListener("pointerenter", function (ev) {
        var ci = c.getAttribute("data-c"), b = hb[+ci];
        each('.cell[data-c="' + ci + '"]', function (x) { x.classList.add("hl"); }, out);
        tipShow(ev, function (t) {
          tEl(t, "div", "tv", b.t.length > 60 ? b.t.slice(0, 60) + "…" : b.t);
          tEl(t, "div", "tl", "第" + b.s + "回国会・" + b.k + (b.dt ? "・" + b.dt : "") + "・" + b.res);
          ks.forEach(function (k, i) { var s = stance(b, kis[i]); tRow(t, fam(k).color, ST_LABEL[s], k); });
        });
      });
      c.addEventListener("pointermove", tipMove);
      c.addEventListener("pointerleave", function () { tipHide(); each(".cell.hl", function (x) { x.classList.remove("hl"); }, out); });
    }, out);
  }

  // ---------- お金
  function renderMoney(pd, rec) {
    var box = $("money");
    box.innerHTML = '<div class="skeleton" style="width:50%"></div><div class="skeleton"></div>';
    var k = pd.code;
    var idx = S.finIndex ? Promise.resolve(S.finIndex) : getJSON("finance/index.json").then(function (d) { S.finIndex = d; return d; }, function () { S.finIndex = []; return []; });
    idx.then(function (list) {
      if (S.finance[k] !== undefined) return S.finance[k];
      if (list.indexOf(k) < 0) { S.finance[k] = null; return null; }
      return getJSON("finance/" + k + ".json").then(function (d) { S.finance[k] = d; return d; }, function () { S.finance[k] = null; return null; });
    }).then(function (fin) {
      if (!$("money")) return;
      var code = rec.parent ? rec.parent.c : rec.c, name = rec.parent ? rec.parent.n : rec.n;
      var links = fin && fin.links && fin.links[code], st = fin && fin.status && fin.status[code];
      var h = '<p class="p"><b>' + esc(name) + "</b> の公式サイトから見つかった原本・掲載ページ" + (rec.parent ? '<span class="note">（区ではなく市の単位で公表されています）</span>' : "") + "</p>";
      if (!fin) {
        h = '<div class="empty" id="kpi-money"><b>' + esc(pd.pref) + "の自治体は、予算・入札・補助金の原本リンクをまだ集めていません（未取得）</b>" + link(FIN_REPO, "arai-sarai-data/zenkoku-jichitai-db") + " の全国巡回で、収集が済んだ都道府県から順に表示されます（現在：" + esc((S.finIndex || []).map(function (c) { return S.prefs[+c - 1] ? S.prefs[+c - 1].name : c; }).join("・")) + "）。</div>";
        h += '<div class="fin-foot">決算は ' + link(KESSAN_URL, "総務省 市町村別決算状況調・決算カード") + '（全市区町村の原本 Excel・PDF）で見られます。<span class="note">サイト上の数値としての取り込みは未実施です。</span></div>';
        if (rec.url) h += '<p class="note">' + esc(name) + "の公式サイト：" + link(rec.url, shortUrl(rec.url)) + "</p>";
        box.innerHTML = h; return;
      }
      var total = 0;
      h += '<div class="fin-tiles">';
      Object.keys(KINDS).forEach(function (kind) {
        var L = links && links[kind];
        h += '<div class="fin"><h3>' + esc(KINDS[kind]) + '</h3><div class="note">' + esc(KIND_SUB[kind]) + "</div>";
        if (L && L.length) {
          total += L.length;
          h += '<div class="fin-n"><b>' + fmt(L.length) + "</b>件</div><ul>" + L.slice(0, 4).map(function (x) { return "<li>" + link(x.u, (x.t || shortUrl(x.u)) + (x.doc ? "（文書）" : "")) + "</li>"; }).join("") + "</ul>";
          if (L.length > 4) h += "<details><summary>残り " + (L.length - 4) + " 件を見る</summary><ul>" + L.slice(4).map(function (x) { return "<li>" + link(x.u, (x.t || shortUrl(x.u)) + (x.doc ? "（文書）" : "")) + "</li>"; }).join("") + "</ul></details>";
        } else if (st) h += '<p class="none">巡回しましたが、該当するページは見つかりませんでした（巡回 ' + esc(st.pages) + " ページ" + (st.error ? "、エラー: " + esc(st.error) : "") + "）。</p>";
        else h += '<p class="none"><span class="muted-pill">未取得</span> この都道府県は収集前です</p>';
        h += "</div>";
      });
      h += '</div><p class="note" id="kpi-money">原本リンク ' + fmt(total) + " 件。自治体サイトを機械的に巡回して見つけた原本・掲載ページの候補です。関係の薄いページが含まれることがあります。取得日 " + esc(((links && (links.budget || links.bids || links.grants) || [])[0] || {}).r || "") + "。</p>";
      h += '<div class="fin-foot">決算は ' + link(KESSAN_URL, "総務省 市町村別決算状況調・決算カード") + '（全市区町村の原本 Excel・PDF）で見られます。<span class="note">サイト上の数値としての取り込みは未実施です。</span></div>';
      h += '<p class="note">原本リンクの出典：' + link(FIN_REPO, "arai-sarai-data/zenkoku-jichitai-db") + "。</p>";
      box.innerHTML = h;
    });
  }

  // ====================================================================== 議員一覧
  var MF = { house: "", fam: "", pref: "", terms: "", q: "", n: 120 };
  function filterMembers(f) {
    var q = snorm(f.q || "");
    return MEM.filter(function (o) {
      if (f.house && o.house !== f.house) return false;
      if (f.fam && famSlug(o.f) !== f.fam) return false;
      if (f.pref && String(o.pi || "") !== f.pref) return false;
      if (f.block && o.block !== f.block) return false;
      if (f.hcpr && !(o.house === "hc" && !o.pi)) return false;
      if (f.terms) { var b = TERM_BUCKETS.filter(function (x) { return x.id === f.terms; })[0]; if (b && !(o.terms >= b.lo && o.terms <= b.hi)) return false; }
      if (q && o.key.indexOf(q) < 0 && snorm(o.kaiha).indexOf(q) < 0 && snorm(o.where).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (a.y || a.name).localeCompare(b.y || b.name, "ja"); });
  }
  function famsPresent() {
    var c = {}; MEM.forEach(function (o) { var s = famSlug(o.f); if (!c[s]) c[s] = { f: o.f, n: 0, hr: 0, hc: 0 }; c[s].n++; c[s][o.house]++; });
    return Object.keys(c).map(function (k) { return c[k]; }).sort(function (a, b) { return b.n - a.n; });
  }
  function pageMembers() {
    var M = S.members;
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">国会議員 <b>' + fmt(MEM.length) + '</b>人</h1><p class="ph-sub">衆議院 ' + fmt(M.hr.length) + "人・参議院 " + fmt(M.hc.length) + "人。名前を押すと、その議員のページ（会派の賛否・選挙区の得票）を開きます。</p></header>";
    h += '<div class="two-hemi"><div><h2 class="h3">衆議院</h2>' + seatBlock("hr") + '</div><div><h2 class="h3">参議院</h2>' + seatBlock("hc") + "</div></div>";
    h += '<section class="sec" aria-labelledby="ml-h"><div class="sec-head"><h2 id="ml-h">名前で探す・タグで絞り込む</h2></div>';
    h += '<div class="chips" id="m-fam" role="group" aria-label="政党で絞り込む"><button type="button" class="chip chip-all" data-f="" aria-pressed="true">すべての政党</button>' + famsPresent().map(function (x) { return '<button type="button" class="chip" style="--pc:' + x.f.color + '" data-f="' + famSlug(x.f) + '" aria-pressed="false"><i></i>' + esc(x.f.family) + " " + x.n + "</button>"; }).join("") + "</div>";
    h += '<div class="filters"><input type="search" id="m-q" placeholder="名前・読み・会派・選挙区で絞り込む" aria-label="名前で絞り込む"><select id="m-house" aria-label="議院"><option value="">衆議院・参議院</option><option value="hr">衆議院</option><option value="hc">参議院</option></select><select id="m-pref" aria-label="都道府県"><option value="">すべての都道府県</option>' + S.prefs.map(function (p, i) { return '<option value="' + (i + 1) + '">' + esc(p.name) + "</option>"; }).join("") + '</select><select id="m-terms" aria-label="当選回数"><option value="">当選回数すべて</option>' + TERM_BUCKETS.map(function (b) { return '<option value="' + b.id + '">' + b.label + "</option>"; }).join("") + '</select><select id="m-sort" aria-label="並べ替え"><option value="">読みの順</option><option value="terms">当選回数の多い順</option><option value="where">選挙区・ブロックの順</option></select><span class="count" id="m-count"></span></div>';
    h += '<p class="note">都道府県は、衆議院の小選挙区と参議院の選挙区の議員だけに付きます（比例代表の議員は「比例ブロック」のタグ）。並びは読みの五十音順（並べ替えで当選回数・選挙区の順にもできます）。</p><div id="m-out"></div></section></div>';
    setView(h, "国会議員一覧");
    bindSeatTips($("view"));
    MF = { house: "", fam: "", pref: "", terms: "", q: "", sort: "", n: 120 };
    function draw() {
      var list = filterMembers(MF);
      if (MF.sort === "terms") list.sort(function (a, b) { return b.terms - a.terms || (a.y || a.name).localeCompare(b.y || b.name, "ja"); });
      else if (MF.sort === "where") list.sort(function (a, b) { return a.house.localeCompare(b.house) || (a.pi || 99) - (b.pi || 99) || (a.m.district || a.block || "").localeCompare(b.m.district || b.block || "", "ja") || (a.y || a.name).localeCompare(b.y || b.name, "ja"); });
      $("m-count").textContent = fmt(list.length) + " 人";
      var o = list.length ? '<div class="np-grid np-grid-sm">' + list.slice(0, MF.n).map(function (x) { return plate(x); }).join("") + "</div>" : '<div class="empty"><b>条件に合う議員がいません</b>条件をゆるめてください。</div>';
      if (list.length > MF.n) o += '<button type="button" class="btn-sub more" id="m-more">さらに表示（残り ' + fmt(list.length - MF.n) + " 人）</button>";
      $("m-out").innerHTML = o;
      if ($("m-more")) $("m-more").addEventListener("click", function () { MF.n += 240; draw(); });
    }
    each("#m-fam .chip", function (b) { b.addEventListener("click", function () { MF.fam = b.getAttribute("data-f"); MF.n = 120; each("#m-fam .chip", function (c) { c.setAttribute("aria-pressed", String(c === b)); }); draw(); }); });
    var t = null;
    $("m-q").addEventListener("input", function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { MF.q = v; MF.n = 120; draw(); }, 150); });
    $("m-house").addEventListener("change", function () { MF.house = this.value; MF.n = 120; draw(); });
    $("m-pref").addEventListener("change", function () { MF.pref = this.value; MF.n = 120; draw(); });
    $("m-terms").addEventListener("change", function () { MF.terms = this.value; MF.n = 120; draw(); });
    $("m-sort").addEventListener("change", function () { MF.sort = this.value; MF.n = 120; draw(); });
    draw();
  }

  // ====================================================================== 議員ページ
  function candidateIn(o) {
    // 第51回総選挙の小選挙区の得票（議員の選挙区、または比例の議員は同じブロックで氏名が一致した候補）
    if (o.house !== "hr") return null;
    if (o.m.district) return { code: o.m.district, how: "district" };
    var k = snorm(o.name), hits = [];
    Object.keys(S.districts).forEach(function (c) {
      var d = S.districts[c]; if (d.block !== o.block) return;
      (d.result2026 || []).forEach(function (x) { if (snorm(x.name) === k) hits.push(c); });
    });
    return hits.length === 1 ? { code: hits[0], how: "name" } : null;
  }
  function pageMember(id) {
    var o = MEM_BY_ID[id];
    if (!o) { setView('<div class="wrap page"><div class="empty"><b>この議員のページは見つかりません</b>名簿が更新された可能性があります。<a href="#members">議員一覧</a>から探してください。</div></div>', "見つかりません"); return; }
    var m = o.m, tags = memTags(o);
    var h = '<div class="wrap page"><header class="ph ph-mem" style="--pc:' + o.f.color + '"><span class="ph-band" aria-hidden="true"></span><p class="ph-pre">' + esc(houseName(o.house)) + "　" + esc(o.where) + '</p><h1 class="ph-name">' + esc(o.name) + '</h1><p class="ph-yomi">' + esc(o.y) + '</p><p class="ph-badge">' + badge(o.kaiha, { full: true, big: true }) + '</p><div id="mem-ach"></div>';
    h += '<dl class="kv kv-row"><dt>当選回数</dt><dd>' + esc(termsTxt(m.terms) || "—") + "</dd>" + (m.expiry ? "<dt>任期満了</dt><dd>" + esc(m.expiry) + "</dd>" : "") + "<dt>選出</dt><dd>" + esc(o.sel) + "</dd>" + (m.url ? "<dt>紹介ページ</dt><dd>" + link(m.url, "参議院ホームページ") + "</dd>" : "") + "</dl>";
    h += tagLinks(tags) + "</header>";
    h += '<div class="cols"><section class="sec panel" aria-labelledby="h-elec"><h2 id="h-elec">選挙の得票</h2><div id="mem-elec"></div></section><section class="sec panel" aria-labelledby="h-rec"><h2 id="h-rec">' + esc(o.kaiha) + " の賛否の記録</h2><div id=\"mem-rec\"><div class=\"skeleton\"></div></div></section></div>";
    h += '<section class="sec panel" aria-labelledby="h-mbills"><h2 id="h-mbills">最近の議案と、この会派の賛否</h2><div id="mem-bills"><div class="skeleton"></div></div></section>';
    h += '<section class="sec" aria-labelledby="h-mshare"><div class="sec-head"><h2 id="h-mshare">シェア用カード</h2></div><div id="mem-card"></div></section>';
    h += '<section class="sec" aria-labelledby="h-same"><div class="sec-head"><h2 id="h-same">同じ会派の議員（' + esc(houseName(o.house)) + "）</h2></div>" + (function () { var s = MEM.filter(function (x) { return x.house === o.house && x.kaiha === o.kaiha && x !== o; }); return '<p class="p">' + esc(o.kaiha) + "：" + (s.length + 1) + '人。<a href="#party-' + famSlug(o.f) + '">' + esc(o.f.family) + "のページ</a>で全員を見られます。</p>"; })() + "</section></div>";
    setView(h, o.name + "（" + shortName(o.kaiha) + "）");
    // 得票
    var ci = candidateIn(o), eh = "";
    if (ci && S.districts[ci.code] && S.districts[ci.code].result2026) {
      var vb = voteBars(S.districts[ci.code].result2026, o.name);
      eh += '<h3 class="sub-h"><span>' + esc(dname(ci.code)) + "（第51回総選挙・2026年2月8日）</span><span class=\"note\">有効票計 " + fmt(vb.total) + "</span></h3>" + vb.html;
      if (ci.how === "name") eh += '<p class="note">この議員は比例代表で選ばれています。同じ比例ブロック内で氏名が一致した小選挙区の候補の得票を表示しています。</p>';
      else if (!vb.arr.some(function (x) { return snorm(x.name) === snorm(o.name); })) eh += '<p class="note">この選挙区の第51回総選挙の候補者に、同じ氏名は見つかりませんでした（その後の補欠選挙などの可能性があります）。</p>';
      eh += '<p class="note">' + link(ELEC_SRC, "出典：矢内勇生 公開データ") + "。得票の多い順。</p>";
      $("mem-elec").innerHTML = eh;
      bindVoteBars($("mem-elec"), [{ name: dname(ci.code), vb: vb }]);
    } else {
      $("mem-elec").innerHTML = o.house === "hr" ? '<div class="empty"><b>小選挙区の得票はありません</b>比例代表のみの立候補か、同じブロック内で氏名が一致する小選挙区の候補が見つかりませんでした。</div>' : pending("参議院選挙の得票", "総務省 選挙結果", "このサイトでは衆議院の第51回総選挙の得票だけを取り込んでいます");
    }
    $("mem-ach").innerHTML = badgeRow(o);
    getVotes().then(function () { if ($("mem-rec")) memberRecord(o); });
  }
  function memberRecord(o) {
    var V = S.votesHr, ki = o.house === "hr" ? V.kaiha.indexOf(o.kaiha) : -1;
    if (ki < 0) {
      $("mem-rec").innerHTML = o.house === "hc" ? pending("参議院の会派ごとの賛否", "参議院ホームページ 本会議投票結果（scripts/fetch_sangiin_votes.py）", "取得するまでは、議案ページで議決の結果と投票結果（原本）へのリンクを見られます") + '<p class="note"><a href="#bills">参議院の議案を見る</a></p>' : '<div class="empty"><b>会派としての賛否の記録はありません</b>' + esc(o.kaiha) + "は、衆議院の会派別賛否の記録に出てきません（無所属の議員や、結成後まだ採決のない会派など）。</div>";
      $("mem-bills").innerHTML = '<p class="note">表示できる会派の賛否の記録がありません。</p>';
      $("mem-card").innerHTML = memCard(o, null);
      return;
    }
    var st = kaihaStats(ki, V.bills), tot = st.y + st.n;
    var h = '<p class="big-stat"><b>' + fmt(tot) + '</b>件の議案で賛否の記録</p><div class="rate-big">' + yesBar(st.y, st.n) + '<div class="rb-l"><span><b>賛成 ' + fmt(st.y) + "</b>件（" + pct(st.y, tot) + "%）</span><span><b>反対 " + fmt(st.n) + "</b>件（" + pct(st.n, tot) + "%）</span></div></div>";
    // 分野ごと
    h += '<h3 class="h3">分野ごとの賛成の割合 <span class="auto">分野は自動分類</span></h3>';
    S.ptags.rules.forEach(function (r) {
      var bs = V.bills.filter(function (b) { return b.g.indexOf(r.id) >= 0; }), s2 = kaihaStats(ki, bs), t2 = s2.y + s2.n;
      if (!t2) return;
      h += '<div class="rate-row"><a class="rate-name tag tag-p" href="#tag-p-' + r.id + '">' + esc(r.label) + '</a><span class="rate-bar">' + yesBar(s2.y, s2.n) + '</span><span class="rate-v"><b>' + pct(s2.y, t2) + "%</b> " + s2.y + "/" + t2 + "件</span></div>";
    });
    h += '<p class="note">第196回国会以降、会派「' + esc(o.kaiha) + "」の名前で記録された賛否。議員個人の投票ではありません。" + link(SMRI_HR, "出典：国会議案データベース：衆議院") + "（" + esc(V.asof) + "）。</p>";
    h += shareBar(o.name + "（" + o.kaiha + "・" + houseName(o.house) + " " + o.where + "）の会派は、衆議院の議案 " + tot + "件で 賛成" + st.y + "件・反対" + st.n + "件（第196回国会以降）", "#m-" + o.id);
    $("mem-rec").innerHTML = h;
    var bills = V.bills.filter(function (b) { return stance(b, ki) !== "u"; }).slice(0, 20);
    $("mem-bills").innerHTML = '<ul class="bill-list">' + bills.map(function (b) { return '<li class="bill bill-row">' + stPill(stance(b, ki)) + '<div><div class="bill-t"><a href="#bill-hr-' + b.id + '">' + esc(b.t) + '</a></div><div class="bill-m">第' + b.s + "回国会・" + esc(b.dt) + "・" + esc(b.res) + (b.how ? "（" + esc(b.how) + "）" : "") + "・賛成" + b.y.length + "会派・反対" + b.n.length + "会派</div></div></li>"; }).join("") + '</ul><p class="more-link"><a href="#party-' + famSlug(o.f) + '">' + esc(o.f.family) + "のページで推移を見る</a></p>";
    $("mem-card").innerHTML = memCard(o, st);
  }
  function memCard(o, st) {
    var h = '<figure class="scard" style="--pc:' + o.f.color + '"><div class="sc-top"><span class="sc-site">住所から見る 地域の政治とお金</span><span class="sc-date">' + esc(S.meta.built.slice(0, 10)) + ' 時点</span></div><span class="sc-band" aria-hidden="true"></span>';
    h += '<p class="sc-place">' + esc(houseName(o.house)) + "　" + esc(o.where) + '</p><p class="sc-name">' + esc(o.name) + '</p><p class="sc-yomi">' + esc(o.y) + "</p><p>" + badge(o.kaiha, { full: true, big: true, link: false }) + "</p>";
    if (st) h += '<div class="sc-rate"><span>会派の賛否（衆議院 第196回国会以降）</span>' + yesBar(st.y, st.n) + '<div class="rb-l"><span><b>賛成 ' + fmt(st.y) + "</b>件</span><span><b>反対 " + fmt(st.n) + "</b>件</span></div></div>";
    h += '<p class="sc-src">出典：衆議院・参議院 議員名簿、スマートニュース メディア研究所「国会議案データベース」</p></figure>';
    return h;
  }

  // ====================================================================== 政党
  function pageParties() {
    var P = famsPresent();
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">政党・会派</h1><p class="ph-sub">議員の会派を、全サイト共通の政党カラー表で政党ごとにまとめています。並びは所属議員の多い順。</p></header>';
    h += '<div class="party-grid">' + P.map(function (x) {
      return '<a class="pcard" href="#party-' + famSlug(x.f) + '" style="--pc:' + x.f.color + '"><span class="pc-band" aria-hidden="true"></span><span class="pc-name">' + esc(x.f.family === "その他" ? "その他の会派" : x.f.family) + '</span><span class="pc-n"><b>' + x.n + '</b>人</span><span class="pc-s">衆 ' + x.hr + "・参 " + x.hc + "</span></a>";
    }).join("") + "</div>";
    h += '<div class="two-hemi"><div><h2 class="h3">衆議院</h2>' + seatBlock("hr") + '</div><div><h2 class="h3">参議院</h2>' + seatBlock("hc") + "</div></div></div>";
    setView(h, "政党・会派");
    bindSeatTips($("view"));
  }
  function famKaihaIdx(f) { var V = S.votesHr; return V.kaiha.map(function (k, i) { return fam(k) === f ? i : -1; }).filter(function (i) { return i >= 0; }); }
  function pageParty(slug) {
    var f = famBySlug(slug);
    if (!f) { setView('<div class="wrap page"><div class="empty"><b>この政党のページは見つかりません</b><a href="#parties">政党の一覧</a>から選んでください。</div></div>'); return; }
    var mem = MEM.filter(function (o) { return o.f === f; }), hr = mem.filter(function (o) { return o.house === "hr"; }), hc = mem.filter(function (o) { return o.house === "hc"; });
    var title = f.family === "その他" ? "その他の会派" : f.family;
    var kaihaNames = {}; mem.forEach(function (o) { kaihaNames[o.kaiha] = (kaihaNames[o.kaiha] || 0) + 1; });
    var h = '<div class="wrap page"><header class="ph ph-mem" style="--pc:' + f.color + '"><span class="ph-band" aria-hidden="true"></span><p class="ph-pre">政党・会派</p><h1 class="ph-name">' + esc(title) + '</h1><p class="ph-badge">' + Object.keys(kaihaNames).map(function (k) { return badge(k, { full: true, big: true, link: false }); }).join(" ") + "</p>";
    h += '<p class="ph-big">国会議員 <b>' + mem.length + "</b>人<span>衆議院 " + hr.length + "人・参議院 " + hc.length + "人</span></p>";
    h += '<p class="note">色は全サイト共通の政党カラー表（' + esc(f.match.length ? "会派名に「" + f.match.join("」「") + "」を含む" : f.family === "その他" ? "表のどの政党にも当たらない会派" : "") + "）でまとめたものです。</p></header>";
    h += '<section class="sec panel" aria-labelledby="h-trend"><h2 id="h-trend">衆議院の議案への賛成の割合の推移</h2><div id="party-trend"><div class="skeleton"></div></div></section>';
    h += '<section class="sec" aria-labelledby="h-pm"><div class="sec-head"><h2 id="h-pm">所属議員 ' + mem.length + "人</h2><p class=\"sec-note\">読みの五十音順</p></div>";
    if (hr.length) h += '<h3 class="h3">衆議院 ' + hr.length + '人</h3><div class="np-grid np-grid-sm">' + filterMembers({ house: "hr", fam: slug }).map(function (o) { return plate(o); }).join("") + "</div>";
    if (hc.length) h += '<h3 class="h3">参議院 ' + hc.length + '人</h3><div class="np-grid np-grid-sm">' + filterMembers({ house: "hc", fam: slug }).map(function (o) { return plate(o); }).join("") + "</div>";
    if (!mem.length) h += '<div class="empty">現在の名簿に所属議員はいません。</div>';
    h += shareBar(title + "の国会議員は " + mem.length + "人（衆議院 " + hr.length + "人・参議院 " + hc.length + "人）", "#party-" + slug) + "</section></div>";
    setView(h, title);
    getVotes().then(function () { if ($("party-trend")) partyTrend(f, slug); });
  }
  function partyTrend(f, slug) {
    var V = S.votesHr, idx = famKaihaIdx(f), box = $("party-trend");
    if (!idx.length) { box.innerHTML = '<div class="empty"><b>衆議院の会派別賛否の記録がありません</b>この政党に当たる会派名は、衆議院の賛否の記録（第196回国会以降）に出てきません。</div>'; return; }
    // 線は会派名ごと（同じ政党カラーの会派でも、別の会派名は別の線）
    var sessions = {}; V.bills.forEach(function (b) { sessions[b.s] = 1; });
    var ss = Object.keys(sessions).map(Number).sort(function (a, b) { return a - b; });
    var series = idx.map(function (ki) { var st = kaihaStats(ki, V.bills); return { ki: ki, k: V.kaiha[ki], st: st }; }).filter(function (x) { return x.st.y + x.st.n; });
    var h = '<p class="cap">国会（回次）ごとに、その会派の賛否が記録された議案のうち賛成の割合。会派名が変わると別の線になります（線の形で見分けられるよう、点の形を変えています）。</p>';
    h += lineChart(series, ss, f.color);
    h += '<table class="tbl"><thead><tr><th scope="col">会派名（記録の名前）</th><th scope="col">記録のある国会</th><th scope="col">賛成</th><th scope="col">反対</th><th scope="col">賛成の割合</th></tr></thead><tbody>' + series.map(function (x, i) {
      var se = Object.keys(x.st.per).map(Number).sort(function (a, b) { return a - b; });
      return "<tr><td>" + MARKS[i % MARKS.length].sym + " " + esc(x.k) + "</td><td>第" + se[0] + "〜" + se[se.length - 1] + "回</td><td>" + fmt(x.st.y) + "</td><td>" + fmt(x.st.n) + "</td><td><b>" + pct(x.st.y, x.st.y + x.st.n, 1) + "%</b></td></tr>";
    }).join("") + "</tbody></table>";
    // 分野別（現在の会派名＝直近の記録がある会派）
    var cur = series.filter(function (x) { return S.curKaiha.indexOf(x.ki) >= 0; });
    cur.forEach(function (x) {
      h += '<h3 class="h3">' + esc(x.k) + "：分野ごとの賛成の割合 <span class=\"auto\">分野は自動分類</span></h3>";
      S.ptags.rules.forEach(function (r) {
        var bs = V.bills.filter(function (b) { return b.g.indexOf(r.id) >= 0; }), s2 = kaihaStats(x.ki, bs), t2 = s2.y + s2.n;
        if (t2) h += '<div class="rate-row"><a class="rate-name tag tag-p" href="#tag-p-' + r.id + '">' + esc(r.label) + '</a><span class="rate-bar">' + yesBar(s2.y, s2.n) + '</span><span class="rate-v"><b>' + pct(s2.y, t2) + "%</b> " + s2.y + "/" + t2 + "件</span></div>";
      });
    });
    h += '<p class="note">' + link(SMRI_HR, "出典：スマートニュース メディア研究所 国会議案データベース：衆議院") + "（" + esc(V.asof) + "）。会派としての賛否。</p>";
    box.innerHTML = h;
    bindLine(box, series, ss);
  }
  var MARKS = [{ sym: "●", shape: "c" }, { sym: "■", shape: "s" }, { sym: "▲", shape: "t" }, { sym: "◆", shape: "d" }, { sym: "○", shape: "o" }];
  function mark(shape, x, y, r) {
    if (shape === "s") return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '"/>';
    if (shape === "t") return '<path d="M' + x + " " + (y - r * 1.2) + "L" + (x + r * 1.1) + " " + (y + r * 0.8) + "L" + (x - r * 1.1) + " " + (y + r * 0.8) + 'Z"/>';
    if (shape === "d") return '<path d="M' + x + " " + (y - r * 1.25) + "L" + (x + r * 1.25) + " " + y + "L" + x + " " + (y + r * 1.25) + "L" + (x - r * 1.25) + " " + y + 'Z"/>';
    if (shape === "o") return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="var(--panel)"/>';
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
  }
  function lineChart(series, ss, color) {
    var W = 760, H = 240, L = 40, Rr = 12, T = 12, B = 28, iw = W - L - Rr, ih = H - T - B;
    var x = function (i) { return L + (ss.length > 1 ? i / (ss.length - 1) * iw : iw / 2); }, y = function (v) { return T + (1 - v) * ih; };
    var s = '<div class="line-wrap"><svg class="line" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="国会ごとの賛成の割合の推移">';
    [0, 0.5, 1].forEach(function (v) { s += '<line class="grid" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v * 100 + "%</text>"; });
    ss.forEach(function (sv, i) { if (i === 0 || i === ss.length - 1 || i % 4 === 0) s += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">第' + sv + "回</text>"; });
    series.forEach(function (se, si) {
      var d = "", pen = false, dots = "";
      ss.forEach(function (sv, i) { var p = se.st.per[sv]; if (!p) { pen = false; return; } var v = p[0] / (p[0] + p[1]); d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; dots += mark(MARKS[si % MARKS.length].shape, x(i), y(v), 4); });
      s += '<path class="halo" d="' + d + '"/><path class="ln" d="' + d + '" stroke="' + color + '"/><g class="mk" fill="' + color + '">' + dots + "</g>";
    });
    s += '<line class="xh" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/><rect class="hit" x="' + L + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/></svg></div>';
    return s;
  }
  function bindLine(box, series, ss) {
    var svg = box.querySelector("svg.line"); if (!svg) return;
    var hit = svg.querySelector(".hit"), xh = svg.querySelector(".xh");
    function at(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * 760;
      var i = Math.max(0, Math.min(ss.length - 1, Math.round((px - 40) / (760 - 52) * (ss.length - 1))));
      var xx = 40 + (ss.length > 1 ? i / (ss.length - 1) * (760 - 52) : 0);
      xh.setAttribute("x1", xx); xh.setAttribute("x2", xx); xh.style.display = "";
      tipShow(ev, function (t) {
        tEl(t, "div", "tl", "第" + ss[i] + "回国会");
        var any = false;
        series.forEach(function (se, si) { var p = se.st.per[ss[i]]; if (p) { any = true; tRow(t, null, MARKS[si % MARKS.length].sym + " " + pct(p[0], p[0] + p[1]) + "%", se.k + "（賛成" + p[0] + "・反対" + p[1] + "）"); } });
        if (!any) tEl(t, "div", "tl", "この国会では記録なし");
      });
    }
    hit.addEventListener("pointermove", at); hit.addEventListener("pointerenter", at);
    hit.addEventListener("pointerleave", function () { tipHide(); xh.style.display = "none"; });
  }

  // ====================================================================== 議案
  var BF = { house: "hr", tag: "", q: "", split: false, n: 30 };
  function pageBills(preTag, preLife) {
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">議案</h1><p class="ph-sub" id="b-sub"></p></header>';
    h += '<div class="house-tabs" role="group" aria-label="議院"><button type="button" data-h="hr">衆議院</button><button type="button" data-h="hc">参議院</button></div>';
    h += '<div class="chips" id="b-life" role="group" aria-label="暮らしテーマ（自動分類）で絞り込む"></div><div class="chips" id="b-tags" role="group" aria-label="分野（自動分類）で絞り込む"></div>';
    h += '<div class="filters"><input type="search" id="b-q" placeholder="議案名で絞り込む（例：税、子ども、防衛）" aria-label="議案名で絞り込む"><label class="chk"><input type="checkbox" id="b-split">賛否が分かれた議案だけ</label><select id="b-sort" aria-label="並べ替え"><option value="new">新しい順</option><option value="old">古い順</option><option value="split">賛否が割れた順（衆議院）</option><option value="name">件名の順</option></select><span class="count" id="b-count"></span></div><div id="b-out"><div class="skeleton"></div></div></div>';
    setView(h, "議案");
    BF = { house: "hr", tag: preTag || "", life: preLife || "", q: "", split: false, sort: "new", n: 30 };
    getVotes().then(function () {
      if (!$("b-out")) return;
      each(".house-tabs button", function (b) { b.addEventListener("click", function () { BF.house = b.getAttribute("data-h"); BF.n = 30; drawBills(); }); });
      var t = null;
      $("b-q").addEventListener("input", function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { BF.q = snorm(v); BF.n = 30; drawBills(); }, 160); });
      $("b-split").addEventListener("change", function () { BF.split = this.checked; BF.n = 30; drawBills(); });
      $("b-sort").addEventListener("change", function () { BF.sort = this.value; BF.n = 30; drawBills(); });
      drawBills();
    });
  }
  function billsFiltered(f) {
    var V = f.house === "hr" ? S.votesHr : S.votesHc;
    return V.bills.filter(function (b) {
      if (f.tag && b.g.indexOf(f.tag) < 0) return false;
      if (f.life && b.lt.indexOf(f.life) < 0) return false;
      if (f.q && b.key.indexOf(f.q) < 0) return false;
      if (f.split && b.how === "全会一致") return false;
      return true;
    });
  }
  function drawBills() {
    var V = BF.house === "hr" ? S.votesHr : S.votesHc;
    each(".house-tabs button", function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-h") === BF.house)); });
    $("b-sub").innerHTML = BF.house === "hr" ? "衆議院 本会議で会派の賛否が記録された議案 " + fmt(V.bills.length) + "件（第196回国会以降）。" + src(SMRI_HR, "国会議案データベース：衆議院（" + V.asof + "）") : "参議院 本会議で議決された議案 " + fmt(V.bills.length) + "件。会派ごとの賛否は未取得のため、議決の結果と投票結果（原本）へのリンクを表示します。" + src(SMRI_HC, "国会議案データベース：参議院（" + V.asof + "）");
    var counts = {}; V.bills.forEach(function (b) { b.g.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
    $("b-tags").innerHTML = '<button type="button" class="chip chip-all" data-t="" aria-pressed="' + (!BF.tag) + '">すべての分野</button>' + S.ptags.rules.map(function (r) { return '<button type="button" class="chip chip-tag" data-t="' + r.id + '" aria-pressed="' + (BF.tag === r.id) + '">' + esc(r.label) + " " + (counts[r.id] || 0) + "</button>"; }).join("") + '<span class="auto">分野は件名のキーワードによる自動分類（<a href="#tags">規則</a>）</span>';
    each("#b-tags .chip", function (b) { b.addEventListener("click", function () { BF.tag = b.getAttribute("data-t"); BF.n = 30; drawBills(); }); });
    var lc = {}; V.bills.forEach(function (b) { b.lt.forEach(function (g) { lc[g] = (lc[g] || 0) + 1; }); });
    $("b-life").innerHTML = '<span class="lab-row">暮らしテーマ</span><button type="button" class="chip chip-all" data-l="" aria-pressed="' + (!BF.life) + '">すべて</button>' + S.ltags.rules.map(function (r) { return '<button type="button" class="chip chip-tag" data-l="' + r.id + '" aria-pressed="' + (BF.life === r.id) + '">' + esc(r.label) + " " + (lc[r.id] || 0) + "</button>"; }).join("") + '<span class="auto">件名のキーワードによる自動分類（<a href="#tags">規則</a>）</span>';
    each("#b-life .chip", function (b) { b.addEventListener("click", function () { BF.life = b.getAttribute("data-l"); BF.n = 30; drawBills(); }); });
    var rows = sortBills(billsFiltered(BF), BF.sort);
    $("b-count").textContent = "該当 " + fmt(rows.length) + " 件";
    $("b-out").innerHTML = billListHtml(rows, BF.house, BF.n) + (rows.length > BF.n ? '<button type="button" class="btn-sub more" id="b-more">さらに 60 件表示（残り ' + fmt(rows.length - BF.n) + " 件）</button>" : "");
    if ($("b-more")) $("b-more").addEventListener("click", function () { BF.n += 60; drawBills(); });
  }
  function splitKey(b) { return b.y && b.n && b.y.length && b.n.length ? Math.min(b.y.length, b.n.length) * 100 - Math.abs(b.y.length - b.n.length) : -1; }
  function sortBills(rows, how) {
    rows = rows.slice();
    if (how === "old") rows.reverse();
    else if (how === "split") rows.sort(function (a, b) { return splitKey(b) - splitKey(a) || a.ord - b.ord; });
    else if (how === "name") rows.sort(function (a, b) { return a.t.localeCompare(b.t, "ja") || a.ord - b.ord; });
    return rows;
  }
  function billListHtml(rows, house, n) {
    if (!rows.length) return '<div class="empty"><b>条件に合う議案がありません</b>条件をゆるめてください。</div>';
    var V = house === "hr" ? S.votesHr : S.votesHc;
    return '<ul class="bill-list">' + rows.slice(0, n).map(function (b) {
      var yn = house === "hr" ? '<div class="yn-line"><span class="yn"><b>賛成 ' + b.y.length + '</b><span>会派</span></span><span class="yn n"><b>反対 ' + b.n.length + '</b><span>会派</span></span><span class="yn-badges">' + b.y.map(function (k) { return badge(V.kaiha[k], { sm: true, link: false }); }).join("") + (b.n.length ? '<span class="vs">／反対</span>' + b.n.map(function (k) { return badge(V.kaiha[k], { sm: true, link: false }); }).join("") : "") + "</span></div>" : "";
      return '<li class="bill"><div class="bill-t"><a href="#bill-' + house + "-" + b.id + '">' + esc(b.t) + '</a></div><div class="bill-m">' + (house === "hc" ? esc(b.dt) + "・" : "") + "第" + b.s + "回国会・" + esc(b.k) + (house === "hr" && b.dt ? "・" + esc(b.dt) : "") + "・" + esc(b.res) + (b.how ? "（" + esc(b.how) + "）" : "") + "</div>" + yn + billTags(b) + "</li>";
    }).join("") + "</ul>";
  }
  function pageBill(house, id) {
    var h0 = '<div class="wrap page"><div id="bill-page"><div class="skeleton"></div></div></div>';
    setView(h0, "議案");
    getVotes().then(function () {
      var b = BILL_BY[house][id], box = $("bill-page");
      if (!box) return;
      if (!b) { box.innerHTML = '<div class="empty"><b>この議案のページは見つかりません</b><a href="#bills">議案の一覧</a>から探してください。</div>'; return; }
      var V = house === "hr" ? S.votesHr : S.votesHc;
      var h = '<header class="ph ph-bill"><p class="ph-pre">' + houseName(house) + "・第" + b.s + "回国会・" + esc(b.k) + "</p><h1 class=\"ph-bill-t\">" + esc(b.t) + "</h1>" + billTags(b);
      h += '<dl class="kv kv-row"><dt>本会議の結果</dt><dd>' + esc(b.res) + (b.how ? "（" + esc(b.how) + "）" : "") + "</dd><dt>" + (house === "hr" ? "審議の状況" : "議決日") + "</dt><dd>" + esc(house === "hr" ? b.st || "" : b.dt) + (house === "hr" && b.dt ? "（" + esc(b.dt) + "）" : "") + "</dd><dt>原本</dt><dd>" + link(b.u, house === "hr" ? "衆議院 審議経過" : "参議院 議案情報") + (b.vu ? "・" + link(b.vu, "投票結果") : "") + "</dd></dl></header>";
      if (house === "hr") {
        h += '<section class="sec" aria-labelledby="h-yn"><h2 id="h-yn" class="yn-head">この議案、<span class="y">賛成 <b>' + b.y.length + '</b>会派</span>・<span class="n">反対 <b>' + b.n.length + "</b>会派</span></h2>";
        h += '<div class="yn-cols"><div class="yn-col y"><h3>' + stPill("y") + " " + b.y.length + "会派</h3>" + (b.y.length ? b.y.map(function (k) { return '<p class="yn-k">' + badge(V.kaiha[k], { full: true, big: true }) + "</p>"; }).join("") : '<p class="note">なし</p>') + '</div><div class="yn-col n"><h3>' + stPill("n") + " " + b.n.length + "会派</h3>" + (b.n.length ? b.n.map(function (k) { return '<p class="yn-k">' + badge(V.kaiha[k], { full: true, big: true }) + "</p>"; }).join("") : '<p class="note">なし</p>') + "</div></div>";
        h += '<p class="note">本会議で賛否が記録された会派だけを表示しています（会派としての賛否。議員個人の投票ではありません）。' + link(SMRI_HR, "出典：国会議案データベース：衆議院") + "（" + esc(V.asof) + "）／" + link(b.u, "衆議院 審議経過（原本）") + "。</p>";
        h += shareBar("この議案、賛成" + b.y.length + "会派・反対" + b.n.length + "会派：" + (b.t.length > 60 ? b.t.slice(0, 60) + "…" : b.t) + "（衆議院 第" + b.s + "回国会・" + b.res + "）", "#bill-hr-" + b.id) + "</section>";
        h += '<section class="sec" aria-labelledby="h-bcard"><div class="sec-head"><h2 id="h-bcard">シェア用カード</h2></div><figure class="scard"><div class="sc-top"><span class="sc-site">住所から見る 地域の政治とお金</span><span class="sc-date">第' + b.s + "回国会・" + esc(b.dt || "") + '</span></div><p class="sc-billt">' + esc(b.t) + '</p><p class="sc-head">賛成 <b>' + b.y.length + "</b>会派・反対 <b>" + b.n.length + '</b>会派</p><div class="sc-yn"><div><span class="sc-lab">賛成</span>' + b.y.map(function (k) { return badge(V.kaiha[k], { link: false }); }).join("") + '</div><div><span class="sc-lab">反対</span>' + (b.n.map(function (k) { return badge(V.kaiha[k], { link: false }); }).join("") || "なし") + '</div></div><p class="sc-src">出典：スマートニュース メディア研究所「国会議案データベース：衆議院」／衆議院 審議経過。結果：' + esc(b.res) + "</p></figure></section>";
        // 同じ分野の議案
      } else {
        h += '<section class="sec">' + pending("参議院の会派ごとの賛否", "参議院ホームページ 本会議投票結果（scripts/fetch_sangiin_votes.py）", "取得するまでは、投票結果（原本）のページで議員ごとの賛否を見られます") + (b.vu ? '<p class="p">' + link(b.vu, "参議院 本会議 投票結果（原本）を開く") + "</p>" : "") + shareBar("参議院で議決：" + (b.t.length > 60 ? b.t.slice(0, 60) + "…" : b.t) + "（" + b.dt + "・" + b.res + (b.how ? "・" + b.how : "") + "）", "#bill-hc-" + b.id) + "</section>";
      }
      var same = V.bills.filter(function (x) { return x !== b && x.g[0] === b.g[0] && x.g[0] !== "none"; }).slice(0, 8);
      if (same.length) h += '<section class="sec" aria-labelledby="h-same-b"><div class="sec-head"><h2 id="h-same-b">同じ分野（' + esc(PTAG[b.g[0]].label) + "）の最近の議案</h2></div>" + billListHtml(same, house, 8) + '<p class="more-link"><a href="#tag-p-' + b.g[0] + '">' + esc(PTAG[b.g[0]].label) + "の議案をすべて見る</a></p></section>";
      box.innerHTML = h;
      document.title = b.t.slice(0, 40) + "｜住所から見る 地域の政治とお金";
    });
  }

  // ====================================================================== タグ
  function allMemberTags() {
    var c = {};
    MEM.forEach(function (o) { memTags(o).forEach(function (t) { if (!c[t.id]) c[t.id] = { id: t.id, label: t.label, n: 0 }; c[t.id].n++; }); });
    return c;
  }
  function pageTags() {
    var h = '<div class="wrap page"><header class="ph"><h1 class="ph-h">タグ一覧</h1><p class="ph-sub">議案は政策分野、議員は政党・議院・都道府県・比例ブロック・当選回数で分類しています。タグを押すと、そのタグの議案・議員の一覧を開きます。</p></header>';
    h += '<section class="sec" aria-labelledby="h-tp"><div class="sec-head"><h2 id="h-tp">議案の政策分野 <span class="auto">自動分類</span></h2><p class="sec-note">件名（と議案の種類）に下のキーワードが含まれると、そのタグが付きます。1つの議案に複数付くことがあります。人の判断は入れていません（' + esc("scripts/policy_tags.py") + "、テスト付き）。</p></div><div id=\"tp\"><div class=\"skeleton\"></div></div></section>";
    h += '<section class="sec" aria-labelledby="h-tl"><div class="sec-head"><h2 id="h-tl">議案の暮らしテーマ <span class="auto">自動分類</span></h2><p class="sec-note">件名に下のキーワードが含まれると、そのテーマが付きます（scripts/life_tags.py、テスト付き）。</p></div><div id="tl"><div class="skeleton"></div></div></section>';
    var mt = allMemberTags(), keys = Object.keys(mt);
    function grp(prefix) { return keys.filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return mt[k]; }); }
    h += '<section class="sec" aria-labelledby="h-tm"><div class="sec-head"><h2 id="h-tm">議員のタグ</h2></div>';
    h += '<h3 class="h3">政党</h3><div class="tagcloud">' + famsPresent().map(function (x) { return famBadge(x.f, (x.f.family === "その他" ? "その他の会派" : x.f.family) + " " + x.n); }).join("") + "</div>";
    h += '<h3 class="h3">議院</h3><div class="tagcloud">' + grp("house-").map(tagChip).join("") + "</div>";
    h += '<h3 class="h3">当選回数</h3><div class="tagcloud">' + TERM_BUCKETS.map(function (b) { return mt["terms-" + b.id]; }).filter(Boolean).map(tagChip).join("") + "</div>";
    h += '<h3 class="h3">比例代表</h3><div class="tagcloud">' + grp("block-").sort(function (a, b) { return +a.id.slice(6) - +b.id.slice(6); }).concat(grp("hcpr")).map(tagChip).join("") + "</div>";
    h += '<h3 class="h3">都道府県（小選挙区・選挙区）</h3><div class="tagcloud">' + grp("pref-").sort(function (a, b) { return +a.id.slice(5) - +b.id.slice(5); }).map(tagChip).join("") + "</div></section></div>";
    setView(h, "タグ一覧");
    getVotes().then(function () {
      if (!$("tp")) return;
      $("tl").innerHTML = '<table class="tbl"><thead><tr><th scope="col">テーマ</th><th scope="col">衆議院</th><th scope="col">参議院</th><th scope="col">キーワード（件名）／除外</th></tr></thead><tbody>' + S.ltags.rules.map(function (r) {
        var st = lifeStats(r.id);
        return '<tr><td><a class="tag tag-life" href="#life-' + r.id + '">' + esc(r.label) + "</a></td><td>" + fmt(st.rows.length) + "件</td><td>" + fmt(st.rowsHc.length) + '件</td><td class="kw">' + esc(r.words.join("・")) + (r.exclude_kinds.length ? "／除く種類：" + esc(r.exclude_kinds.join("・")) : "") + (r.exclude_words && r.exclude_words.length ? "／除く語：" + esc(r.exclude_words.join("・")) : "") + "</td></tr>";
      }).join("") + "</tbody></table>";
      var c = { hr: {}, hc: {} };
      ["hr", "hc"].forEach(function (hh) { (hh === "hr" ? S.votesHr : S.votesHc).bills.forEach(function (b) { b.g.forEach(function (g) { c[hh][g] = (c[hh][g] || 0) + 1; }); }); });
      $("tp").innerHTML = '<table class="tbl"><thead><tr><th scope="col">分野</th><th scope="col">衆議院</th><th scope="col">参議院</th><th scope="col">キーワード（件名）／議案の種類</th></tr></thead><tbody>' + S.ptags.rules.map(function (r) {
        return '<tr><td><a class="tag tag-p" href="#tag-p-' + r.id + '">' + esc(r.label) + "</a></td><td>" + fmt(c.hr[r.id] || 0) + "件</td><td>" + fmt(c.hc[r.id] || 0) + '件</td><td class="kw">' + (r.id === "none" ? "どの規則にも当たらない議案" : esc(r.words.join("・")) + (r.kinds.length ? "／種類：" + esc(r.kinds.join("・")) : "")) + "</td></tr>";
      }).join("") + "</tbody></table>";
    });
  }
  function tagChip(t) { return '<a class="tag tag-l" href="#tag-' + t.id + '">' + esc(t.label) + " <b>" + t.n + "</b></a>"; }
  function pageTag(tid) {
    var m;
    if ((m = tid.match(/^p-([a-z]+)$/))) {
      var r = PTAG[m[1]];
      if (!r) { pageTags(); return; }
      var h = '<div class="wrap page"><header class="ph"><p class="ph-pre">議案の政策分野（自動分類）</p><h1 class="ph-h">' + esc(r.label) + '</h1><p class="ph-sub">' + (r.id === "none" ? "どの規則にも当たらなかった議案" : "件名に「" + esc(r.words.slice(0, 12).join("」「")) + "」" + (r.words.length > 12 ? "など" : "") + "を含む議案" + (r.kinds.length ? "、または種類が「" + esc(r.kinds.join("」「")) + "」の議案" : "")) + '。<a href="#tags">規則の全文</a></p></header><div id="tag-out"><div class="skeleton"></div></div></div>';
      setView(h, r.label + "の議案");
      getVotes().then(function () {
        if (!$("tag-out")) return;
        var V = S.votesHr, rows = billsFiltered({ house: "hr", tag: r.id }), rowsHc = billsFiltered({ house: "hc", tag: r.id });
        var kr = S.curKaiha.map(function (ki) { var st = kaihaStats(ki, rows); return { k: V.kaiha[ki], y: st.y, n: st.n }; }).filter(function (x) { return x.y + x.n; }).sort(function (a, b) { return b.y / (b.y + b.n) - a.y / (a.y + a.n) || (b.y + b.n) - (a.y + a.n); });
        var o = '<p class="ph-big">衆議院 <b>' + fmt(rows.length) + "</b>件・参議院 <b>" + fmt(rowsHc.length) + "</b>件</p>";
        if (kr.length) {
          o += '<section class="sec panel"><h2>この分野の議案への、会派ごとの賛成の割合（衆議院）</h2><p class="cap">第' + S.maxS + "回国会に記録のある会派。その会派名で賛否が記録された議案のうち賛成の割合の高い順。</p>";
          kr.forEach(function (x) { o += '<div class="rate-row"><span class="rate-name">' + badge(x.k) + '</span><span class="rate-bar">' + yesBar(x.y, x.n) + '</span><span class="rate-v"><b>' + pct(x.y, x.y + x.n) + "%</b> " + x.y + "/" + (x.y + x.n) + "件</span></div>"; });
          o += '<p class="note">' + link(SMRI_HR, "出典：国会議案データベース：衆議院") + "（" + esc(V.asof) + "）。</p>" + shareBar("「" + r.label + "」の議案（自動分類・衆議院 " + rows.length + "件）への会派ごとの賛成の割合：" + kr.map(function (x) { return shortName(x.k) + " " + pct(x.y, x.y + x.n) + "%"; }).join("、"), "#tag-p-" + r.id) + "</section>";
        }
        o += '<section class="sec"><div class="sec-head"><h2>衆議院の議案（新しい順）</h2></div>' + billListHtml(rows, "hr", 40) + (rows.length > 40 ? '<p class="more-link"><a href="#bills">議案のページで続きを見る</a></p>' : "") + "</section>";
        o += '<section class="sec"><div class="sec-head"><h2>参議院の議案（新しい順）</h2></div>' + billListHtml(rowsHc, "hc", 20) + "</section>";
        $("tag-out").innerHTML = o;
      });
      return;
    }
    var f = {}, label = "", mt = allMemberTags();
    if ((m = tid.match(/^house-(hr|hc)$/))) { f.house = m[1]; label = houseName(m[1]); }
    else if ((m = tid.match(/^pref-(\d+)$/))) { f.pref = m[1]; label = S.prefs[+m[1] - 1] ? S.prefs[+m[1] - 1].name : ""; }
    else if ((m = tid.match(/^block-(\d+)$/))) { f.block = BLOCKS[+m[1] - 1]; label = "衆議院 比例 " + (f.block || "") + "ブロック"; }
    else if (tid === "hcpr") { f.hcpr = true; label = "参議院 比例代表"; }
    else if ((m = tid.match(/^terms-(t\d)$/))) { f.terms = m[1]; label = (TERM_BUCKETS.filter(function (b) { return b.id === m[1]; })[0] || {}).label || ""; }
    if (!label) { pageTags(); return; }
    var list = filterMembers(f), comp = compBar(list, "comp-tag");
    var h2 = '<div class="wrap page"><header class="ph"><p class="ph-pre">議員のタグ</p><h1 class="ph-h">' + esc(label) + '</h1><p class="ph-big">国会議員 <b>' + list.length + "</b>人</p></header>";
    h2 += '<section class="sec"><h2 class="h3">政党の内訳</h2>' + comp.html + shareBar("「" + label + "」の国会議員は " + list.length + "人。政党の内訳：" + comp.arr.map(function (x) { return shortName(x.k) + x.n; }).join("・"), "#tag-" + tid) + "</section>";
    h2 += '<section class="sec"><div class="sec-head"><h2>議員（読みの順）</h2></div><div class="np-grid np-grid-sm">' + list.map(function (o) { return plate(o); }).join("") + '</div></section><p class="more-link"><a href="#tags">ほかのタグを見る</a></p></div>';
    setView(h2, label + "の議員");
    bindComp($("view"), comp);
    void mt;
  }

  // ====================================================================== 暮らしテーマ（#life・#life-テーマ）。件名のキーワードによる自動分類
  function lifeStats(id) {
    var V = S.votesHr, rows = billsFiltered({ house: "hr", life: id }), rowsHc = billsFiltered({ house: "hc", life: id });
    var un = rows.filter(function (b) { return b.how === "全会一致"; }).length;
    var kr = S.curKaiha.map(function (ki) { var st = kaihaStats(ki, rows); return { ki: ki, k: V.kaiha[ki], y: st.y, n: st.n }; }).filter(function (x) { return x.y + x.n; })
      .sort(function (a, b) { return b.y / (b.y + b.n) - a.y / (a.y + a.n) || (b.y + b.n) - (a.y + a.n) || a.ki - b.ki; });
    var sp = rows.filter(function (b) { return b.y.length && b.n.length; }).sort(function (a, b) { return splitKey(b) - splitKey(a) || a.ord - b.ord; });
    return { rows: rows, rowsHc: rowsHc, un: un, kr: kr, sp: sp };
  }
  function lifeRule(r) { return "件名に「" + r.words.join("」「") + "」のどれかを含む議案" + (r.exclude_kinds.length ? "（種類が「" + r.exclude_kinds.join("」「") + "」のものを除く）" : "") + (r.exclude_words && r.exclude_words.length ? "。「" + r.exclude_words.join("」「") + "」の語は除いて判定" : ""); }
  function pageLife(id) {
    var r = LTAG[id];
    if (!r) {
      var h0 = '<div class="wrap page"><header class="ph"><p class="ph-pre">暮らしの視点で議案を探す</p><h1 class="ph-h">暮らしテーマ</h1><p class="ph-sub">議案を、暮らしに関わるテーマで分けました。件名のキーワードによる<b>自動分類</b>です（scripts/life_tags.py、テスト付き）。テーマを押すと、そのテーマの議案・会派ごとの賛否・全会一致の割合を開きます。</p></header><div class="life-grid" id="life-grid"><div class="skeleton"></div></div><p class="more-link"><a href="#rankings-kurashi">暮らしテーマ別のランキング</a><a href="#bills">議案の一覧で絞り込む</a></p></div>';
      setView(h0, "暮らしテーマ");
      getVotes().then(function () {
        if (!$("life-grid")) return;
        $("life-grid").innerHTML = S.ltags.rules.map(function (x) { var st = lifeStats(x.id); return '<a class="life-tile" href="#life-' + x.id + '"><b>' + esc(x.label) + "</b><span>" + esc(x.desc) + '</span><span class="lt-n">衆議院 ' + fmt(st.rows.length) + "件・参議院 " + fmt(st.rowsHc.length) + "件／全会一致 " + pct(st.un, st.rows.length) + "%</span></a>"; }).join("");
      });
      return;
    }
    var h = '<div class="wrap page"><header class="ph"><p class="ph-pre"><a href="#life">暮らしテーマ</a>（自動分類）</p><h1 class="ph-h">' + esc(r.label) + '</h1><p class="ph-sub">' + esc(r.desc) + "。" + esc(lifeRule(r)) + '。<a href="#tags">規則の全文</a></p></header><div id="life-out"><div class="skeleton"></div></div></div>';
    setView(h, r.label + "の議案");
    getVotes().then(function () {
      if (!$("life-out")) return;
      var V = S.votesHr, st = lifeStats(id);
      var o = '<p class="ph-big">衆議院 <b>' + fmt(st.rows.length) + "</b>件・参議院 <b>" + fmt(st.rowsHc.length) + "</b>件<span>衆議院のうち全会一致 " + fmt(st.un) + "件（" + pct(st.un, st.rows.length, 1) + "%）・賛否が分かれた " + fmt(st.rows.length - st.un) + "件</span></p>";
      o += '<p class="more-link"><a href="#bills-l-' + id + '">議案の一覧で絞り込み・並べ替え</a><a href="#rank-life' + id + '">このテーマのランキング</a></p>';
      if (st.kr.length) {
        o += '<section class="sec panel"><h2>会派ごとの賛成の割合（衆議院）</h2><p class="cap">第' + S.maxS + "回国会に記録のある全会派に同じ計算：その会派名で賛否が記録されたこのテーマの議案のうち、賛成の割合。並びは数値の順。高い・低いに良し悪しはありません。</p>";
        st.kr.forEach(function (x) { o += '<div class="rate-row"><span class="rate-name">' + badge(x.k) + '</span><span class="rate-bar">' + yesBar(x.y, x.n) + '</span><span class="rate-v"><b>' + pct(x.y, x.y + x.n) + "%</b> 賛成" + x.y + "・反対" + x.n + "</span></div>"; });
        o += '<p class="note">' + link(SMRI_HR, "出典：国会議案データベース：衆議院") + "（" + esc(V.asof) + "）。</p></section>";
      }
      if (st.sp.length) o += '<section class="sec"><div class="sec-head"><h2>賛否が割れた議案（衆議院・上位5件）</h2><p class="sec-note">賛成会派と反対会派の数の少ないほうが多い順</p></div>' + billListHtml(st.sp, "hr", 5) + "</section>";
      o += '<section class="sec"><div class="sec-head"><h2>衆議院の議案（新しい順）</h2></div>' + billListHtml(st.rows, "hr", 30) + (st.rows.length > 30 ? '<p class="more-link"><a href="#bills-l-' + id + '">続きを議案の一覧で見る（' + fmt(st.rows.length - 30) + "件）</a></p>" : "") + "</section>";
      o += '<section class="sec"><div class="sec-head"><h2>参議院の議案（新しい順）</h2></div>' + billListHtml(st.rowsHc, "hc", 15) + "</section>";
      o += shareBar("「" + r.label + "」の議案（自動分類）：衆議院 " + st.rows.length + "件、うち全会一致 " + pct(st.un, st.rows.length) + "%。会派ごとの賛成の割合はサイトで", "#life-" + id);
      $("life-out").innerHTML = o;
    });
  }

  // ====================================================================== 横断検索（入力中に候補表示）
  var SQ = { items: [], sel: -1, last: "" };
  function initSearch() {
    var q = $("q"), list = $("q-list"), t = null;
    q.addEventListener("focus", function () { getVotes().catch(function () {}); });
    q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { suggest(q.value); }, 90); });
    q.addEventListener("keydown", function (ev) {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (list.hidden) suggest(q.value);
        var n = SQ.items.length; if (!n) return;
        SQ.sel = ev.key === "ArrowDown" ? (SQ.sel + 1) % n : (SQ.sel - 1 + n) % n;
        markSel();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        var it = SQ.items[SQ.sel >= 0 ? SQ.sel : -1];
        if (it) { pick(it); return; }
        S.lastQuery = q.value; closeSuggest();
        if (location.hash === "#search") pageSearch(); else location.hash = "#search";
      } else if (ev.key === "Escape") closeSuggest();
    });
    list.addEventListener("pointerdown", function (ev) { var li = ev.target.closest("li[data-i]"); if (li) { ev.preventDefault(); pick(SQ.items[+li.getAttribute("data-i")]); } });
    document.addEventListener("pointerdown", function (ev) { if (!ev.target.closest(".gsearch")) closeSuggest(); });
  }
  function closeSuggest() { var l = $("q-list"); if (l) { l.hidden = true; $("q").setAttribute("aria-expanded", "false"); $("q").removeAttribute("aria-activedescendant"); } SQ.sel = -1; }
  function markSel() {
    each("#q-list li[data-i]", function (li) { var on = +li.getAttribute("data-i") === SQ.sel; li.setAttribute("aria-selected", String(on)); if (on) { $("q").setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); } });
  }
  function pick(it) { closeSuggest(); $("q").value = ""; if (location.hash === it.href) route(); else location.hash = it.href; }
  function searchAll(raw, lim) {
    var q = snorm(raw), out = { m: [], p: [], d: [], t: [], b: [] };
    if (!q) return out;
    lim = lim || {};
    // 議員（名前・読み。前方一致を先に）
    var ms = MEM.map(function (o) { var i = o.key.indexOf(q); return i < 0 ? null : { o: o, s: (snorm(o.name).indexOf(q) === 0 || snorm(o.y).indexOf(q) === 0) ? 0 : 1 }; }).filter(Boolean)
      .sort(function (a, b) { return a.s - b.s || (a.o.y || a.o.name).localeCompare(b.o.y || b.o.name, "ja"); });
    out.m = ms.slice(0, lim.m || 8).map(function (x) { var o = x.o; return { type: "議員", href: "#m-" + o.id, html: '<span class="sg-n">' + esc(o.name) + '</span><span class="sg-y">' + esc(o.y) + "</span>" + badge(o.kaiha, { sm: true, link: false }) + '<span class="sg-s">' + esc(houseName(o.house) + " " + o.where) + "</span>", o: o }; });
    out.mTotal = ms.length;
    // 政党（略称・会派名・読み）
    var seen = {};
    MEM.forEach(function (o) {
      var f = o.f, s = famSlug(f); if (seen[s]) return;
      var keys = [f.family, FAM_YOMI[f.family] || ""].concat(f.match);
      var kaihas = MEM.filter(function (x) { return x.f === f; }).map(function (x) { return x.kaiha; });
      if (keys.concat(kaihas).some(function (k) { return snorm(k).indexOf(q) >= 0 || (FAM_YOMI[f.family] && FAM_YOMI[f.family].split(" ").some(function (y) { return y.indexOf(q) === 0; })); })) {
        seen[s] = 1;
        var n = kaihas.length;
        out.p.push({ type: "政党", href: "#party-" + s, html: famBadge(f, f.family === "その他" ? "その他の会派" : f.family).replace(/^<a /, "<span ").replace(/<\/a>$/, "</span>").replace(/ href="[^"]*"/, "") + '<span class="sg-s">国会議員 ' + n + "人</span>" });
      }
    });
    // 選挙区
    Object.keys(S.districts).forEach(function (k) {
      if (out.d.length >= (lim.d || 4)) return;
      if (snorm(S.districts[k].name).indexOf(q) === 0 || (q.length >= 2 && snorm(S.districts[k].name).indexOf(q) >= 0)) {
        var o = MEM.filter(function (x) { return x.m.district === k; })[0];
        out.d.push({ type: "選挙区", href: o ? "#m-" + o.id : "#members", html: '<span class="sg-n">' + esc(S.districts[k].name) + "</span>" + (o ? '<span class="sg-s">議員：' + esc(o.name) + "</span>" + badge(o.kaiha, { sm: true, link: false }) : "") });
      }
    });
    // タグ
    S.ptags.rules.forEach(function (r) { if (snorm(r.label).indexOf(q) >= 0) out.t.push({ type: "分野タグ", href: "#tag-p-" + r.id, html: '<span class="tag tag-p">' + esc(r.label) + '</span><span class="sg-s">議案の政策分野（自動分類）</span>' }); });
    // 議案（読み込み済みのとき）
    if (S.votesHr && q.length >= 1) {
      var bs = [];
      [S.votesHr, S.votesHc].forEach(function (V, vi) { V.bills.forEach(function (b) { if (b.key.indexOf(q) >= 0) bs.push(b); }); });
      out.bTotal = bs.length;
      out.b = bs.slice(0, lim.b || 5).map(function (b) { return { type: "議案", href: "#bill-" + b.h + "-" + b.id, html: '<span class="sg-b">' + esc(b.t.length > 46 ? b.t.slice(0, 46) + "…" : b.t) + '</span><span class="sg-s">' + houseName(b.h) + " 第" + b.s + "回・" + esc(b.res) + "</span>", b: b }; });
    }
    return out;
  }
  function suggest(raw) {
    var list = $("q-list"), r = searchAll(raw);
    SQ.items = [].concat(r.p, r.m, r.d, r.t, r.b);
    SQ.sel = -1;
    if (!snorm(raw)) { closeSuggest(); return; }
    var h = "", i = 0;
    [["政党", r.p], ["議員", r.m], ["選挙区", r.d], ["分野タグ", r.t], ["議案", r.b]].forEach(function (g) {
      if (!g[1].length) return;
      h += '<li class="sg-h" role="presentation">' + g[0] + (g[0] === "議員" && r.mTotal > g[1].length ? "（" + r.mTotal + "人中）" : "") + (g[0] === "議案" && r.bTotal > g[1].length ? "（" + fmt(r.bTotal) + "件中）" : "") + "</li>";
      g[1].forEach(function (it) { h += '<li role="option" id="sg' + i + '" data-i="' + i + '" aria-selected="false">' + it.html + "</li>"; i++; });
    });
    if (!i) h = '<li class="sg-none" role="presentation">見つかりませんでした。漢字・ひらがな・一部だけでも探せます。</li>';
    else h += '<li class="sg-foot" role="presentation">Enterで検索結果の一覧へ</li>';
    if (!S.votesHr) h += '<li class="sg-foot" role="presentation">議案のデータを読み込み中…</li>';
    list.innerHTML = h; list.hidden = false; $("q").setAttribute("aria-expanded", "true");
  }
  function pageSearch() {
    var raw = S.lastQuery || "";
    var h = '<div class="wrap page"><header class="ph"><p class="ph-pre">検索結果</p><h1 class="ph-h">「' + esc(raw) + '」</h1></header><div id="s-out"><div class="skeleton"></div></div></div>';
    setView(h, "検索結果");
    if (!raw) { $("s-out").innerHTML = '<div class="empty"><b>検索語がありません</b>上の検索欄に、議員名・政党名・議案名を入れてください。</div>'; return; }
    getVotes().then(function () {
      if (!$("s-out")) return;
      var r = searchAll(raw, { m: 200, b: 100, d: 20 }), o = "";
      if (r.p.length) o += '<section class="sec"><h2 class="h3">政党</h2><div class="tagcloud">' + r.p.map(function (x) { return '<a class="sres" href="' + x.href + '">' + x.html + "</a>"; }).join("") + "</div></section>";
      if (r.m.length) o += '<section class="sec"><h2 class="h3">議員 ' + r.mTotal + '人</h2><div class="np-grid np-grid-sm">' + r.m.map(function (x) { return plate(x.o); }).join("") + "</div></section>";
      if (r.d.length) o += '<section class="sec"><h2 class="h3">選挙区</h2><div class="tagcloud">' + r.d.map(function (x) { return '<a class="sres" href="' + x.href + '">' + x.html + "</a>"; }).join("") + "</div></section>";
      if (r.t.length) o += '<section class="sec"><h2 class="h3">分野タグ</h2><div class="tagcloud">' + r.t.map(function (x) { return '<a class="sres" href="' + x.href + '">' + x.html + "</a>"; }).join("") + "</div></section>";
      if (r.b.length) {
        var hr = r.b.filter(function (x) { return x.b.h === "hr"; }).map(function (x) { return x.b; }), hc = r.b.filter(function (x) { return x.b.h === "hc"; }).map(function (x) { return x.b; });
        o += '<section class="sec"><h2 class="h3">議案 ' + fmt(r.bTotal) + "件" + (r.bTotal > r.b.length ? "（先頭の " + r.b.length + "件）" : "") + "</h2>" + (hr.length ? billListHtml(hr, "hr", 100) : "") + (hc.length ? billListHtml(hc, "hc", 100) : "") + "</section>";
      }
      $("s-out").innerHTML = o || '<div class="empty"><b>見つかりませんでした</b>漢字・ひらがな・名前の一部でも探せます。議案はひらがなでは探せないため、件名の漢字で入れてください。</div>';
    });
  }

  // ---------- 出典
  function renderSources() {
    var M = S.members.meta, meta = S.meta;
    var h = "<details><summary>データ源・ライセンスを見る</summary><ul>";
    h += "<li>住所（都道府県・市区町村・町丁目）：" + link("https://github.com/geolonia/japanese-addresses", "Geolonia 住所データ") + "（CC BY 4.0）</li>";
    h += "<li>小選挙区の区割り：" + link(meta.law.source, "公職選挙法 別表第一") + "（e-Gov法令検索のデータ。" + link("https://github.com/Kohei-Wada/houritsu", "Kohei-Wada/houritsu") + " 経由、" + esc(meta.law.revision || "") + "）</li>";
    h += "<li>小選挙区の地図（区割り表で市区町村名が出てこない北海道の振興局管内・東京都の島しょ部の判定と参考表示のみ）：gtfs-gis.jp 選挙区ポリゴン（CC0）を簡略化した " + link("https://github.com/n1n9-jp/senkyoku2022", "n1n9-jp/senkyoku2022") + "</li>";
    h += "<li>選挙区と比例ブロックの対応・市区町村コード：" + link("https://github.com/mu373/election-202602-shugiin", "mu373/election-202602-shugiin") + "（データ CC0）</li>";
    h += "<li>第51回総選挙 小選挙区の得票：矢内勇生 公開データ（" + link(ELEC_SRC, "ryomakom/lower_election_district2026") + " 経由）</li>";
    h += "<li>衆議院議員：" + esc(M.hr_source || "") + "（" + esc(M.hr_asof || "") + "）</li>";
    h += "<li>参議院議員・会派、衆参の議案と会派別賛否：スマートニュース メディア研究所 " + link(SMRI_HR, "house-of-representatives") + "・" + link(SMRI_HC, "house-of-councillors") + "（MIT。著作権表記：スマートニュース メディア研究所）</li>";
    h += "<li>議員の読み（検索用）：" + link("https://github.com/skbnw/replit-politician-directory", "skbnw/replit-politician-directory") + "（MIT）・house-of-councillors の「読み方」</li>";
    h += "<li>政党カラー：全サイト共通の色表（party-colors.json）。区別のためだけの色です。</li>";
    h += "<li>政治資金収支報告書：" + link(SEIJISHIKIN_TOP, "総務省 政治資金") + "（原本へのリンクのみ）</li>";
    h += "<li>自治体の公式サイト・予算／入札／補助金の原本リンク：" + link(FIN_REPO, "arai-sarai-data/zenkoku-jichitai-db") + "</li>";
    h += "</ul></details>";
    h += '<details><summary>ビルドの記録</summary><div class="spec">' + (meta.log || []).map(esc).join("<br>") + "</div></details>";
    $("sources").innerHTML = h;
    $("built").textContent = "データ作成：" + meta.built;
  }

  // 画面幅が変わったらヒートマップの列数を合わせ直す
  var rz = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () { if (Math.abs(window.innerWidth - lastW) < 40) return; lastW = window.innerWidth; if (VS && $("hr-out")) drawHrOut(); }, 200);
  });

  // テスト用（自動テストから政党の照合を確かめる）
  window.__chiiki = { fam: function (n) { return fam(n).family; }, efam: function (n) { return fam(ep(n)).family; }, snorm: snorm, onColor: onColor };
})();
