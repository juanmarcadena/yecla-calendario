// Scrape ADECMAC Segunda División standings -> league.json
import { writeFileSync } from "node:fs";
const SRC = "https://adecmac.com/segunda-division/";
const res = await fetch(SRC, { headers: {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
}});
if (!res.ok) { console.error("fetch failed", res.status); process.exit(1); }
const html = await res.text();

// The page can have multiple tables (a fixtures/scoreboard table + the standings).
// Pick the STANDINGS table specifically, not just the first <table>.
const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
const tbl =
  tables.find((t) => /sp-league-table/.test(t)) ||
  tables.find((t) => /data-rank/.test(t) && /data-pts/.test(t)) ||
  tables.find((t) => />\s*Pos\s*</.test(t) && />\s*PTS\s*</.test(t));
if (!tbl) { console.error("no standings table found among", tables.length, "tables"); process.exit(1); }

const rows = [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
const table = [];
for (const r of rows) {
  const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
    .map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  if (cells.length >= 10 && cells[0] !== "Pos" && /^\d+$/.test(cells[0])) {
    const [pos, club, pj, g, e, p, gf, gc, dg, pts] = cells;
    table.push({ pos: +pos, club, pj: +pj, g: +g, e: +e, p: +p, gf: +gf, gc: +gc, dg, pts: +pts });
  }
}
if (!table.length) { console.error("no rows parsed"); process.exit(1); }
writeFileSync("league.json", JSON.stringify({ table, at: Date.now(), source: SRC }));
console.log("wrote league.json:", table.length, "teams; leader", table[0].club, "| last", table[table.length-1].club);
