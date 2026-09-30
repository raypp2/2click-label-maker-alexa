'use strict';

const { iconBodyToAvg } = require('./avg');

const ICONIFY_API = process.env.ICONIFY_API || 'https://api.iconify.design';

// Same single-color sets as the label maker's web UI: multicolor sets print poorly.
const ICON_SETS = [
    'tabler', 'lucide', 'mdi', 'material-symbols', 'ph', 'fluent',
    'icon-park-outline', 'iconoir', 'streamline', 'game-icons',
].join(',');

const SEARCH_LIMIT = 64;       // Iconify's minimum is 32; extra headroom covers icons AVG can't draw
const MAX_RESULTS = 32;        // 4 pages of 8 on screen
const FETCH_TIMEOUT_MS = 2500; // Alexa allows ~8 s for the whole response

// iconId -> AVG graphic (or null when unsupported). Icons never change, so no expiry.
const avgCache = new Map();

async function getJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
}

async function searchIconify(query) {
    const url = `${ICONIFY_API}/search?query=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}&prefixes=${ICON_SETS}`;
    const data = await getJson(url);
    return data.icons || [];
}

/** Fetches icon bodies for ids not yet cached, one request per icon set. */
async function loadGraphics(iconIds) {
    const byPrefix = new Map();
    for (const id of iconIds) {
        if (avgCache.has(id)) continue;
        const [prefix, name] = id.split(':');
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix).push(name);
    }

    await Promise.all([...byPrefix].map(async ([prefix, names]) => {
        const data = await getJson(`${ICONIFY_API}/${prefix}.json?icons=${names.map(encodeURIComponent).join(',')}`);
        const aliases = data.aliases || {};
        for (const name of names) {
            let icon = data.icons?.[name];
            const alias = aliases[name];
            // Plain aliases point at another icon; aliases that rotate or flip can't be drawn as-is.
            if (!icon && alias && !alias.rotate && !alias.hFlip && !alias.vFlip) icon = data.icons?.[alias.parent];
            const usable = icon && !icon.rotate && !icon.hFlip && !icon.vFlip && !icon.left && !icon.top;
            avgCache.set(`${prefix}:${name}`, usable
                ? iconBodyToAvg(icon.body, icon.width || data.width || 16, icon.height || data.height || 16)
                : null);
        }
    }));
}

// Food labels only in v1, so when nothing matches ("leftover lasagna") offer generic food icons.
const FALLBACK_QUERIES = ['food', 'bowl', 'meal'];
const MIN_RESULTS = 16;

// Crossed-out or badge variants ("soup-off", "egg-plus") would print a misleading label.
const UNWANTED_NAME = /^no-|-(off|slash|remove|x|cancel|alert|plus|minus|check|question|exclamation|lock|search|dollar|heart|star|share|bolt|cog|code|up|down|pause|pin|spark)(-|$)|zodiac|bank/;

// Tech brands and logos that share food words ("apple ios", "git cherry pick").
const BRAND_NAME = /(^|-)(ios|mac|macos|ipod|iphone|ipad|imac|finder|safari|icloud|airplay|keyboard|git|github|logo|brand|swift|android|windows|linux|chrome)(-|$)/;
const BRAND_IDS = new Set(['mdi:apple']); // Material's "apple" is the Apple logo; food-apple is the fruit

const unwanted = id => {
    const name = id.split(':')[1];
    return UNWANTED_NAME.test(name) || BRAND_NAME.test(name) || BRAND_IDS.has(id);
};

/** One icon per distinct spoken name first, so the row shows variety; repeats fill in after. */
function diversify(ids) {
    const seen = new Set();
    const first = [];
    const rest = [];
    for (const id of ids) {
        const name = spokenName(id);
        (seen.has(name) ? rest : first).push(id);
        seen.add(name);
    }
    return [...first, ...rest];
}

// Words that name the kind of dish rather than what's in it. "Chicken soup" should
// show a chicken, "butternut squash soup" a squash; these only fill in afterwards.
const GENERIC_WORDS = new Set([
    'soup', 'stew', 'chili', 'curry', 'sauce', 'broth', 'salad', 'casserole', 'bake', 'roast',
    'leftover', 'leftovers', 'meal', 'dinner', 'lunch', 'breakfast', 'food', 'dish', 'bowl',
    'homemade', 'fresh', 'frozen', 'cooked', 'raw', 'the', 'and', 'with',
]);

/** Icon names are singular: "apples" -> "apple", "tomatoes" -> "tomato", "berries" -> "berry". */
function singular(word) {
    if (/ies$/.test(word)) return word.replace(/ies$/, 'y');
    if (/oes$/.test(word)) return word.replace(/es$/, '');
    if (/[^s]s$/.test(word)) return word.slice(0, -1);
    return word;
}

/** Search order: the phrase, adjacent word pairs, specific words, then generic words. */
function searchQueries(text) {
    const phrase = text.toLowerCase().trim().replace(/\s+/g, ' ');
    const words = phrase.split(' ').filter(w => w.length > 2).map(singular);
    const specific = words.filter(w => !GENERIC_WORDS.has(w));
    const generic = words.filter(w => GENERIC_WORDS.has(w) && !['the', 'and', 'with'].includes(w));
    const pairs = specific.slice(1).map((w, i) => `${specific[i]} ${w}`);
    return [...new Set([phrase, ...pairs, ...specific, ...generic])];
}

/**
 * Finds icons for the label text, most specific first (see searchQueries).
 * Generic food icons fill in when little matches.
 * @returns {Promise<string[]>} Iconify ids ("prefix:name") that AVG can draw, best first
 */
async function findIcons(text) {
    const queries = searchQueries(text);

    const ids = [];
    const collect = found => {
        for (const id of found) if (!ids.includes(id) && !unwanted(id)) ids.push(id);
    };
    for (const query of queries) {
        collect(await searchIconify(query));
        if (ids.length >= SEARCH_LIMIT) break;
    }
    for (const query of FALLBACK_QUERIES) {
        if (ids.length >= MIN_RESULTS) break;
        collect(await searchIconify(query));
    }

    await loadGraphics(ids.slice(0, SEARCH_LIMIT));
    return diversify(ids.filter(id => avgCache.get(id))).slice(0, MAX_RESULTS);
}

/** Returns cached AVG graphics for ids, loading any the cache lost (e.g. after a restart). */
async function graphicsFor(iconIds) {
    await loadGraphics(iconIds.filter(id => !avgCache.has(id)));
    return iconIds.map(id => avgCache.get(id));
}

/** "tabler:bowl-chopsticks" -> "bowl chopsticks"; drops style suffixes like -outline or -24-regular. */
function spokenName(iconId) {
    let name = iconId.split(':')[1] || iconId;
    const suffix = /-(outline|outlined|filled|fill|line|regular|bold|thin|light|duotone|rounded|round|sharp|twotone|variant|alt|\d+)$/;
    while (suffix.test(name)) name = name.replace(suffix, '');
    return name.replace(/-/g, ' ');
}

/** SVG URL the label maker downloads and renders at print resolution. */
function svgUrl(iconId) {
    const [prefix, name] = iconId.split(':');
    return `${ICONIFY_API}/${prefix}/${name}.svg`;
}

module.exports = { findIcons, graphicsFor, spokenName, svgUrl };
