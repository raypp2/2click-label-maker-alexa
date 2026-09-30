'use strict';

/**
 * Converts an Iconify icon body (inner SVG markup) into an Alexa Vector Graphic.
 *
 * Echo Show screens can't display SVG images, but AVG accepts SVG path data
 * directly. Iconify bodies are almost always <path> elements, optionally wrapped
 * in <g> groups that carry shared fill/stroke attributes, so the conversion is a
 * small attribute mapping. Anything AVG can't reproduce faithfully (other
 * elements, transforms, even-odd fills) returns null and the icon is skipped.
 */

const COLOR_PARAM = 'iconColor';

const SUPPORTED_TAGS = new Set(['g', 'path']);

function parseAttrs(text) {
    const attrs = {};
    for (const m of text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
        attrs[m[1]] = m[2];
    }
    return attrs;
}

function mapColor(value) {
    if (value === undefined || value === 'currentColor') return `\${${COLOR_PARAM}}`;
    if (value === 'none') return 'transparent';
    return value;
}

function toPathItem(attrs) {
    if (!attrs.d) return null;
    if (attrs['fill-rule'] === 'evenodd' || attrs['clip-rule'] === 'evenodd') return null;
    if (attrs.transform || attrs.mask || attrs['clip-path']) return null;

    // SVG paints fill black when no fill is given, so an absent fill means "icon color".
    const item = { type: 'path', pathData: attrs.d, fill: mapColor(attrs.fill) };

    if (attrs.stroke && attrs.stroke !== 'none') {
        item.stroke = mapColor(attrs.stroke);
        item.strokeWidth = Number(attrs['stroke-width'] || 1);
        if (attrs['stroke-linecap']) item.strokeLineCap = attrs['stroke-linecap'];
        if (attrs['stroke-linejoin']) item.strokeLineJoin = attrs['stroke-linejoin'];
        if (attrs['stroke-miterlimit']) item.strokeMiterLimit = Number(attrs['stroke-miterlimit']);
        if (attrs['stroke-opacity']) item.strokeOpacity = Number(attrs['stroke-opacity']);
    }
    if (attrs['fill-opacity']) item.fillOpacity = Number(attrs['fill-opacity']);
    if (attrs.opacity) {
        const o = Number(attrs.opacity);
        item.fillOpacity = (item.fillOpacity ?? 1) * o;
        if (item.stroke) item.strokeOpacity = (item.strokeOpacity ?? 1) * o;
    }
    return item;
}

/**
 * @param {string} body   Iconify icon body, e.g. '<path fill="none" stroke="currentColor" d="..."/>'
 * @param {number} width  viewBox width
 * @param {number} height viewBox height
 * @returns {object|null} AVG graphic, or null when the icon can't be represented faithfully
 */
function iconBodyToAvg(body, width, height) {
    const items = [];
    const inherited = [{}];

    for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>/g)) {
        const [, closing, tag, rawAttrs, selfClosing] = m;
        if (!SUPPORTED_TAGS.has(tag)) return null;

        if (closing) {
            if (tag === 'g') inherited.pop();
            continue;
        }

        const attrs = { ...inherited.at(-1), ...parseAttrs(rawAttrs) };
        if (tag === 'g') {
            if (attrs.transform) return null;
            delete attrs.d;
            if (!selfClosing) inherited.push(attrs);
            continue;
        }

        const item = toPathItem(attrs);
        if (!item) return null;
        items.push(item);
    }

    if (items.length === 0) return null;

    return {
        type: 'AVG',
        version: '1.2',
        width,
        height,
        viewportWidth: width,
        viewportHeight: height,
        parameters: [{ name: COLOR_PARAM, type: 'color', default: 'black' }],
        items,
    };
}

module.exports = { iconBodyToAvg };
