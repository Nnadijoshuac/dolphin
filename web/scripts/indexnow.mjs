/**
 * Tells IndexNow search engines (Bing - which Copilot and ChatGPT search draw on - Yandex, Seznam, Naver,
 * Yep) that every page in the live sitemap exists or changed (2026-10-19). Run after a deploy that adds or
 * changes pages: `npm run indexnow`. Google does not take IndexNow; it reads the sitemap from Search Console.
 *
 * The key is public by design: IndexNow proves ownership by finding the same key at /<key>.txt on the site.
 */
const SITE = "https://www.dolphinamp.xyz";
const KEY = "1a569e11b438671d7363c4d6f9babef8";

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
if (urls.length === 0) throw new Error("The sitemap listed no URLs.");

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls.slice(0, 10_000) }),
});
console.log(`IndexNow: ${response.status} ${response.statusText} for ${urls.length} URLs`);
if (response.status >= 300) console.log(await response.text());
