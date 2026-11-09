// Scrape ADECMAC Segunda División per-player stats (goals + cards) -> players.json
//
// adecmac.com runs WordPress + SportsPress, whose REST API exposes every match
// ("event") with a per-player `performance` block. There is no published
// goleadores/amonestaciones list for the current season, so we sum the
// per-match numbers ourselves.
//
// Env overrides: LEAGUE (slug, default "segunda-division"),
//                SEASON (slug, default = newest season that has events in LEAGUE).
import { writeFileSync } from "node:fs";

const API = "https://adecmac.com/wp-json/sportspress/v2";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
};

async function get(path) {
  const res = await fetch(API + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return { data: await res.json(), pages: +(res.headers.get("x-wp-totalpages") || 1) };
}
async function getAll(path) {
  const sep = path.includes("?") ? "&" : "?";
  const first = await get(`${path}${sep}per_page=100&page=1`);
  const out = [...first.data];
  for (let p = 2; p <= first.pages; p++) out.push(...(await get(`${path}${sep}per_page=100&page=${p}`)).data);
  return out;
}
const decode = (s) => String(s ?? "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const num = (v) => (Number.parseInt(v, 10) || 0);

const leagueSlug = process.env.LEAGUE || "segunda-division";
const leagues = await getAll("/leagues");
const league = leagues.find((l) => l.slug === leagueSlug);
if (!league) { console.error("league not found:", leagueSlug); process.exit(1); }

const seasons = (await getAll("/seasons")).sort((a, b) => b.id - a.id);
let season, events;
for (const s of process.env.SEASON ? seasons.filter((s) => s.slug === process.env.SEASON) : seasons) {
  events = await getAll(`/events?leagues=${league.id}&seasons=${s.id}`);
  if (events.length) { season = s; break; }
}
if (!season) { console.error("no season with events for", leagueSlug, process.env.SEASON || ""); process.exit(1); }

const teamName = new Map((await getAll("/teams?_fields=id,title")).map((t) => [t.id, decode(t.title.rendered)]));

// Aggregate per (player, team) — a player could in theory appear for two teams.
const stats = new Map();
let played = 0, withStats = 0, goalsInScores = 0, goalsRecorded = 0;
for (const ev of events) {
  const scores = (ev.main_results || []).map((r) => (r === "" ? null : num(r)));
  if (scores.length && scores.every((s) => s !== null)) { played++; goalsInScores += scores.reduce((a, b) => a + b, 0); }
  let any = false;
  for (const [teamId, rows] of Object.entries(ev.performance || {})) {
    if (teamId === "0" || !rows || typeof rows !== "object") continue;
    for (const [playerId, r] of Object.entries(rows)) {
      if (playerId === "0" || !r || typeof r !== "object") continue; // "0" = team totals row
      const goals = num(r.goals), yellow = num(r.yellowcards), red = num(r.redcards), own = num(r.owngoals);
      if (!(goals || yellow || red || own)) continue;
      any = true;
      goalsRecorded += goals + own;
      const key = `${playerId}:${teamId}`;
      const s = stats.get(key) || { id: +playerId, teamId: +teamId, number: null, goals: 0, yellow: 0, red: 0, owngoals: 0, matches: [] };
      s.goals += goals; s.yellow += yellow; s.red += red; s.owngoals += own;
      if (r.number) s.number = r.number;
      s.matches.push({ date: ev.date.slice(0, 10), event: decode(ev.title.rendered), goals, yellow, red, owngoals: own });
      stats.set(key, s);
    }
  }
  if (any) withStats++;
}

// Resolve player names (include= accepts a list; batch to keep URLs short).
const ids = [...new Set([...stats.values()].map((s) => s.id))];
const names = new Map();
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100);
  for (const p of (await get(`/players?include=${batch.join(",")}&per_page=100&_fields=id,title,number,link`)).data)
    names.set(p.id, { name: decode(p.title.rendered), number: p.number, link: p.link });
}

const players = [...stats.values()].map((s) => {
  const info = names.get(s.id) || {};
  return {
    id: s.id, name: info.name || `#${s.id}`, number: s.number ?? info.number ?? null,
    club: teamName.get(s.teamId) || String(s.teamId),
    goals: s.goals, yellow: s.yellow, red: s.red, owngoals: s.owngoals,
    link: info.link || null,
    matches: s.matches.sort((a, b) => a.date.localeCompare(b.date)),
  };
}).sort((a, b) => b.goals - a.goals || b.yellow + b.red - (a.yellow + a.red) || a.name.localeCompare(b.name));

writeFileSync("players.json", JSON.stringify({
  league: decode(league.name), season: decode(season.name),
  coverage: { events: events.length, played, withStats, goalsInScores, goalsRecorded },
  players, at: Date.now(), source: `${API}/events?leagues=${league.id}&seasons=${season.id}`,
}));
console.log(`wrote players.json: ${league.name} / ${season.name} — ${players.length} players, ` +
  `${withStats}/${played} played matches with stats, ${goalsRecorded}/${goalsInScores} goals attributed`);
