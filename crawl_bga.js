/**
 * Crawl tất cả asset của một game trên Board Game Arena.
 *
 * Cách dùng:  node crawl_bga.js [game_name] [out_dir]
 * Ví dụ:      node crawl_bga.js splendor
 * Yêu cầu Node.js 18+ (dùng fetch có sẵn).
 */
const fs = require("fs");
const path = require("path");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const CDN = "https://x.boardgamearena.net/data";

// Các file thường có trong mọi game BGA nhưng không phải lúc nào cũng được JS/CSS tham chiếu
const COMMON = [
  "img/game_box.png", "img/game_box75.png", "img/game_box180.png", "img/game_box180_es.png",
  "img/game_icon.png", "img/game_banner.jpg", "img/publisher.png", "img/publisher2.png",
  "img/game_display0.jpg", "img/game_display1.jpg", "img/game_display2.jpg",
  "img/game_display3.jpg", "img/game_display4.jpg", "img/game_display5.jpg",
  "img/game_display6.jpg", "img/game_display7.jpg", "img/game_title.png",
  "img/game_title_en.png", "img/background.jpg", "img/bg.jpg", "img/bg1.jpg", "img/bg2.jpg",
];
const ASSET_EXT = "png|jpe?g|gif|svg|webp|mp3|ogg|wav|m4a|json|js|css|woff2?|ttf|otf";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function fetchBuf(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://boardgamearena.com/" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 403 || res.status === 404) return null;
    } catch {}
    await sleep(1000 * (1 + attempt));
  }
  return null;
}

async function gameInfo(game) {
  const buf = await fetchBuf(`https://boardgamearena.com/gamepanel?game=${game}`);
  const html = buf ? buf.toString("utf-8") : "";
  const g = escapeRe(game);
  const m = html.match(new RegExp(`\\{"id":\\d+,"name":"${g}".*?"media":(\\{.*?\\}\\}),`));
  const v = html.match(new RegExp(`"name":"${g}","display_name_en":"[^"]*","version":"([^"]+)"`));
  if (!v) {
    console.error(`Không tìm thấy game '${game}' trên BGA`);
    process.exit(1);
  }
  return [v[1], m ? JSON.parse(m[1]) : {}];
}

function refsIn(text, isCss) {
  const found = new Set();
  for (const [, u] of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) found.add(u);
  if (!isCss) {
    for (const [, u] of text.matchAll(new RegExp(`['"\`]([^'"\`\\s]+\\.(?:${ASSET_EXT}))['"\`]`, "g")))
      found.add(u);
    // các path img/... được ghép chuỗi trong JS
    for (const [, u] of text.matchAll(new RegExp(`(img/[\\w\\-./]+\\.(?:${ASSET_EXT}))`, "g")))
      found.add(u);
  }
  return found;
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

async function main() {
  const game = process.argv[2] || "splendor";
  const out = process.argv[3] || `assets_${game}`;
  const [version, media] = await gameInfo(game);
  const base = `${CDN}/themereleases/current/games/${game}/${version}/`;
  console.log(`Game: ${game}  version: ${version}\nBase: ${base}`);

  const queue = [`${game}.js`, `${game}.css`, ...COMMON];
  const seen = new Set();
  const saved = [];
  const missing = [];

  while (queue.length) {
    const rel = queue.shift().split("?")[0].split("#")[0];
    if (seen.has(rel) || rel.startsWith("data:") || rel.startsWith("http")) continue;
    seen.add(rel);
    const data = await fetchBuf(new URL(rel, base).href);
    if (!data) {
      missing.push(rel);
      continue;
    }
    save(path.join(out, "game", rel), data);
    saved.push(rel);
    console.log(`  [ok] ${rel} (${data.length.toLocaleString("en-US")} B)`);
    if (rel.endsWith(".js") || rel.endsWith(".css")) {
      const text = data.toString("utf-8");
      const isCss = rel.endsWith(".css");
      // âm thanh gọi qua playSound("x") nằm ở img/x.mp3 và img/x.ogg
      for (const [, snd] of text.matchAll(/playSound\(\s*['"]([\w\-]+)['"]/g))
        queue.push(`img/${snd}.mp3`, `img/${snd}.ogg`);
      for (const ref of refsIn(text, isCss)) {
        if (ref.startsWith("http")) continue;
        // url() trong CSS là tương đối với file CSS; trong JS là tương đối với gốc game
        let joined;
        try {
          joined = new URL(ref, isCss ? base + rel : base).href;
        } catch {
          continue;
        }
        if (joined.startsWith(base)) queue.push(joined.slice(base.length));
      }
    }
  }

  // Media do BGA host riêng (box, banner, icon, title, ảnh giới thiệu, logo NXB)
  console.log("Media:");
  for (const [kind, entries] of Object.entries(media)) {
    for (const [key, h] of Object.entries(entries)) {
      for (const name of [`${key}.png`, `${key}.jpg`, `${key}_280.png`]) {
        const data = await fetchBuf(`${CDN}/gamemedia/${game}/${kind}/${name}?h=${h}`);
        if (data) {
          save(path.join(out, "gamemedia", kind, name), data);
          saved.push(`gamemedia/${kind}/${name}`);
          console.log(`  [ok] ${kind}/${name} (${data.length.toLocaleString("en-US")} B)`);
        }
      }
    }
  }

  fs.writeFileSync(
    path.join(out, "manifest.json"),
    JSON.stringify({ game, version, base, saved, not_found: missing }, null, 2),
    "utf-8"
  );
  console.log(`\nXong: ${saved.length} file -> ${path.resolve(out)}`);
}

main();
