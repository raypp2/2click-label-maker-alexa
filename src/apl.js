'use strict';

/**
 * Echo Show screen: the label preview, action buttons and a row of icon choices.
 *
 * The label is drawn natively (not as an image) in the Food label's real
 * 2.2 x 1.25 proportions, mirroring the ZPL layout in the label maker's
 * labelConfig.js: icon top left, white-on-black primary text top right, date and
 * secondary text below. Sizes are in vw so the layout scales from Show 10
 * (1280x800) to Show 15/21 and Fire TV (16:9).
 *
 * Tapping an icon tile updates the bound `selectedIndex` on the device (instant,
 * no round trip), which swaps the preview icon, then tells the skill via SendEvent.
 */

const TOKEN = 'labelPreview';

const COLORS = {
    background: '#12151a',
    text: '#f2f4f7',
    quiet: '#9aa3ae',
    accent: '#3b82f6',
    tileBorder: '#3a404a',
    buttonBorder: '#4a525e',
};

// Label geometry, from the Food template (448 x 253 dots).
const L = 52;                       // label width, vw
const H = +(L * 1.25 / 2.2).toFixed(2);
const BOX_LEFT = +(L * 163 / 448).toFixed(2);
const BOX_HEIGHT = +(H * 153 / 253).toFixed(2);
const vw = n => `${+n.toFixed(2)}vw`;

function button(text, event, primary) {
    return {
        type: 'TouchWrapper',
        width: '100%',
        spacing: '2.5vh',
        onPress: { type: 'SendEvent', arguments: [event] },
        item: {
            type: 'Frame',
            width: '100%',
            height: '9vh',
            borderRadius: '4.5vh',
            backgroundColor: primary ? COLORS.accent : 'transparent',
            borderWidth: primary ? 0 : '2dp',
            borderColor: COLORS.buttonBorder,
            item: {
                type: 'Text',
                text,
                width: '100%',
                height: '100%',
                textAlign: 'center',
                textAlignVertical: 'center',
                fontSize: '3.4vh',
                fontWeight: primary ? '700' : '500',
                color: COLORS.text,
            },
        },
    };
}

function iconTile(index) {
    return {
        type: 'TouchWrapper',
        spacing: '1.4vw',
        onPress: [
            { type: 'SetValue', componentId: 'root', property: 'selectedIndex', value: index },
            { type: 'SendEvent', arguments: ['selectIcon', index] },
        ],
        item: {
            type: 'Frame',
            width: '9.4vw',
            height: '9.4vw',
            borderRadius: '1vw',
            backgroundColor: 'white',
            borderWidth: `\${selectedIndex == ${index} ? '0.5vw' : '0.2vw'}`,
            borderColor: `\${selectedIndex == ${index} ? '${COLORS.accent}' : '${COLORS.tileBorder}'}`,
            item: {
                type: 'Container',
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                items: [
                    { type: 'VectorGraphic', source: `icon_${index}`, width: '6vw', height: '6vw', scale: 'best-fit' },
                    {
                        type: 'Text',
                        text: String(index + 1),
                        position: 'absolute',
                        right: '0.6vw',
                        bottom: '0.3vw',
                        fontSize: '1.5vw',
                        color: '#6b7280',
                    },
                ],
            },
        },
    };
}

function labelPreview() {
    return {
        type: 'Frame',
        width: vw(L),
        height: vw(H),
        borderRadius: '0.8vw',
        backgroundColor: 'white',
        item: {
            type: 'Container',
            width: '100%',
            height: '100%',
            items: [
                {
                    type: 'VectorGraphic',
                    id: 'previewIcon',
                    source: '${\'icon_\' + selectedIndex}',
                    position: 'absolute',
                    left: vw(L * 15 / 448),
                    top: vw(H * 15 / 253),
                    width: vw(L * 0.3),
                    height: vw(L * 0.3),
                    scale: 'best-fit',
                },
                {
                    type: 'Frame',
                    position: 'absolute',
                    left: vw(BOX_LEFT),
                    top: 0,
                    width: vw(L - BOX_LEFT),
                    height: vw(BOX_HEIGHT),
                    backgroundColor: 'black',
                    borderTopRightRadius: '0.8vw',
                    item: {
                        type: 'Text',
                        text: '${payload.labelData.primaryText}',
                        width: '100%',
                        height: '100%',
                        paddingLeft: vw(L * 17 / 448),
                        paddingRight: '1vw',
                        textAlignVertical: 'center',
                        maxLines: 2,
                        fontSize: '4.4vw',
                        fontWeight: '800',
                        lineHeight: 1.05,
                        color: 'white',
                    },
                },
                {
                    type: 'Text',
                    text: '${payload.labelData.dateText}',
                    position: 'absolute',
                    left: vw(BOX_LEFT),
                    top: vw(H * 0.63),
                    fontSize: '3.4vw',
                    fontWeight: '700',
                    color: 'black',
                },
                {
                    type: 'Text',
                    text: '${payload.labelData.secondaryText}',
                    position: 'absolute',
                    left: vw(BOX_LEFT),
                    top: vw(H * 0.81),
                    width: vw(L - BOX_LEFT - 1),
                    maxLines: 2,
                    fontSize: '2vw',
                    color: 'black',
                },
            ],
        },
    };
}

function buildDocument(iconCount, hasSecondary, copies) {
    const tiles = Array.from({ length: iconCount }, (_, i) => iconTile(i));
    const printText = copies > 1 ? `Print ${copies}` : 'Print';
    return {
        type: 'APL',
        version: '2023.3',
        theme: 'dark',
        settings: { idleTimeout: 120000 },
        graphics: {}, // filled per request with icon_0 ... icon_7
        mainTemplate: {
            parameters: ['payload'],
            item: {
                type: 'Container',
                id: 'root',
                width: '100vw',
                height: '100vh',
                paddingLeft: '4vw',
                paddingRight: '4vw',
                paddingTop: '4vh',
                bind: [{ name: 'selectedIndex', value: '${payload.labelData.selectedIndex}' }],
                items: [
                    {
                        type: 'Container',
                        direction: 'row',
                        width: '100%',
                        justifyContent: 'spaceBetween',
                        alignItems: 'center',
                        items: [
                            { type: 'Text', text: 'Label maker', fontSize: '3.2vh', fontWeight: '700', color: COLORS.text },
                            { type: 'Text', text: '${payload.labelData.hint}', fontSize: '2.6vh', color: COLORS.quiet },
                        ],
                    },
                    {
                        type: 'Container',
                        direction: 'row',
                        width: '100%',
                        spacing: '3vh',
                        items: [
                            labelPreview(),
                            {
                                type: 'Container',
                                grow: 1,
                                shrink: 1,
                                paddingLeft: '4vw',
                                items: [
                                    button(printText, 'print', true),
                                    button('Change text', 'changeText'),
                                    button(hasSecondary ? 'Change secondary text' : 'Add secondary text', 'secondary'),
                                    button('More icons', 'moreIcons'),
                                ],
                            },
                        ],
                    },
                    {
                        type: 'Container',
                        direction: 'row',
                        spacing: '4vh',
                        items: tiles,
                    },
                ],
            },
        },
    };
}

/**
 * @param {object} label    { text, secondary, dateText, copies, iconIndex }
 * @param {object[]} graphics AVG graphics for the icons on screen (up to 8)
 */
function buildPreviewDirective(label, graphics) {
    const document = buildDocument(graphics.length, Boolean(label.secondary), label.copies);
    graphics.forEach((g, i) => { document.graphics[`icon_${i}`] = g; });
    return {
        type: 'Alexa.Presentation.APL.RenderDocument',
        token: TOKEN,
        document,
        datasources: {
            labelData: {
                primaryText: label.text,
                secondaryText: label.secondary || '',
                dateText: label.dateText || '',
                selectedIndex: label.iconIndex,
                hint: 'Say “yes” to print, or “use icon three”',
            },
        },
    };
}

module.exports = { buildPreviewDirective, TOKEN };
