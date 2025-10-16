// scripts/update-readme.js
// Node 20+, no deps. Uses Reddit OAuth (client_credentials) for reliability.

const fs = require("fs");

const UA = "github.com/lawrence-readme-updater (contact: none)";
const SUBREDDIT = "ProgrammerHumor";
const README = "README.md";

function log(...a) { console.log("[updater]", ...a); }

async function getToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_SECRET;
  if (!id || !secret) throw new Error("Missing REDDIT_CLIENT_ID / REDDIT_SECRET");

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

function firstGalleryImage(p) {
  const mm = p.media_metadata || {};
  for (const k of Object.keys(mm)) {
    const v = mm[k];
    if (v?.status !== "valid") continue;
    if (v?.s?.u) return v.s.u.replace(/&amp;/g, "&");
    const variants = v.p;
    if (variants?.length) return variants[variants.length - 1].u.replace(/&amp;/g, "&");
  }
  return null;
}

function pickImagePost(listing) {
  const children = listing?.data?.children ?? [];
  for (const ch of children) {
    const p = ch?.data ?? {};
    if (p.over_18 || p.stickied) continue;

    const title = p.title || "(no title)";
    const permalink = `https://www.reddit.com${p.permalink || "#"}`;
    const link = p.url_overridden_by_dest || p.url || "";
    const hint = p.post_hint || "";
    const domain = p.domain || "";

    // 1) direct image
    if (/\.(png|jpg|jpeg|gif)$/i.test(link)) {
      return { title, permalink, image: link };
    }
    // 2) hint=image
    if (hint === "image" && link) {
      return { title, permalink, image: link };
    }
    // 3) gallery
    if (p.is_gallery || (domain === "reddit.com" && (p.url || "").includes("gallery"))) {
      const img = firstGalleryImage(p);
      if (img) return { title, permalink, image: img };
    }
    // 4) preview
    const src = p.preview?.images?.[0]?.source?.url;
    if (src) {
      return { title, permalink, image: src.replace(/&amp;/g, "&") };
    }
    // 5) Imgur without extension
    if (link.includes("imgur.com")) {
      return { title, permalink, image: link.endsWith(".jpg") ? link : `${link}.jpg` };
    }
  }
  return null;
}

function injectIntoReadme(block) {
  const start = "<!-- START_MEME -->";
  const end = "<!-- END_MEME -->";
  if (!fs.existsSync(README)) {
    log("README.md not found; aborting.");
    return false;
  }
  const content = fs.readFileSync(README, "utf-8");
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(content)) {
    log("Markers not found; leaving README unchanged.");
    return false;
  }
  const newBlock = [
    start,
    "The top voted meme for today is...",
    "",
    `[*${block.title}*](${block.permalink})`,
    "",
    `![ProgrammerHumor Meme of the Day](${block.image})`,
    end,
  ].join("\n");

  const updated = content.replace(re, newBlock);
  if (updated === content) {
    log("No visible change.");
    return false;
  }
  fs.writeFileSync(README, updated);
  log("README updated.");
  return true;
}

async function main() {
  try {
    const token = await getToken();

    const url = `https://oauth.reddit.com/r/${SUBREDDIT}/top?t=day&limit=50&raw_json=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Authorization": `Bearer ${token}`,
      },
    });
    log("HTTP", res.status, res.headers.get("content-type"));
    if (!res.ok) throw new Error(`listing HTTP ${res.status} ${await res.text()}`);
    const listing = await res.json();

    const post = pickImagePost(listing);
    if (!post) {
      log("No suitable image found — keeping existing content.");
      return; // do nothing (keeps old meme, avoids awkward fallback)
    }

    injectIntoReadme(post);
  } catch (e) {
    console.error("[updater] crashed:", e);
    // Intentionally do nothing else: workflow should still succeed.
  }
}

main();
