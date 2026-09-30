'use strict';

// Dry run: print jobs are recorded instead of sent to the label maker.
process.env.DRY_RUN = '1';
process.env.DEFAULT_TZ = 'America/New_York';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildSkill, labelDate } = require('../src/skill');
const { dryRunJobs } = require('../src/printer');
const { SKILL_ID, intent, launch, touch, turn } = require('./helpers');

const skill = buildSkill(SKILL_ID);
const today = labelDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));

test('opening the skill asks what the label should say, with the mic open for a bare answer', async () => {
    const t = await turn(skill, launch());
    assert.match(t.speech, /What should the label say\?/);
    assert.strictEqual(t.elicit.slotToElicit, 'text');
    assert.strictEqual(t.elicit.updatedIntent.name, 'PrintLabelIntent');
});

test('the full happy path: preview, change things, print exactly what was shown', async () => {
    // "Alexa, ask label maker to print chicken soup"
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'chicken soup' }));
    assert.match(t.speech, /^Chicken Soup, with a chicken icon, dated today\. Should I print it\?$/, 'the specific word (chicken) outranks the dish (soup)');
    assert.strictEqual(t.response.shouldEndSession, false, 'mic stays open for yes / changes');
    assert.ok(t.directive, 'renders the preview on the screen');
    const data = t.directive.datasources.labelData;
    assert.strictEqual(data.primaryText, 'Chicken Soup');
    assert.strictEqual(data.dateText, today);
    assert.strictEqual(data.selectedIndex, 0);
    const graphics = Object.keys(t.directive.document.graphics);
    assert.strictEqual(graphics.length, 8, 'eight tappable icons');
    const bytes = JSON.stringify(t.raw).length;
    assert.ok(bytes < 60_000, `response ${bytes} bytes should stay under 60 KB (Alexa caps at 120 KB)`);

    fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'output', 'chicken-soup.apl.json'), JSON.stringify({
        document: t.directive.document, datasources: t.directive.datasources,
    }, null, 2));

    // "use icon three"
    t = await turn(skill, intent('SetIconIntent', { index: '3' }, { attributes: t.attributes }));
    assert.match(t.speech, /^Icon three, .+\. Should I print it\?$/);
    assert.strictEqual(t.directive.datasources.labelData.selectedIndex, 2);

    // Tap icon 5: silent, the screen already changed on the device.
    t = await turn(skill, touch(['selectIcon', 4], { attributes: t.attributes }));
    assert.strictEqual(t.speech, '');
    assert.strictEqual(t.directive, undefined);
    assert.strictEqual(t.attributes.label.iconIndex, 4);
    const chosenIcon = t.attributes.label.iconIds[4];

    // "add secondary text spicy"
    t = await turn(skill, intent('SetSecondaryTextIntent', { secondary: 'spicy' }, { attributes: t.attributes }));
    assert.match(t.speech, /Added Spicy underneath/);
    assert.strictEqual(t.directive.datasources.labelData.secondaryText, 'Spicy');

    // "three copies"
    t = await turn(skill, intent('SetCopiesIntent', { count: '3' }, { attributes: t.attributes }));
    assert.match(t.speech, /three copies\. Should I print them\?/);

    // "change the date to yesterday" (Alexa resolves it to a date)
    t = await turn(skill, intent('SetDateIntent', { date: '2026-09-29' }, { attributes: t.attributes }));
    assert.match(t.speech, /dated September 29/);
    assert.strictEqual(t.directive.datasources.labelData.dateText, 'Sep 29, 2026');

    // "yes"
    const before = dryRunJobs.length;
    t = await turn(skill, intent('AMAZON.YesIntent', {}, { attributes: t.attributes }));
    assert.strictEqual(t.speech, 'Printing three labels.');
    assert.strictEqual(t.ended, true);
    assert.strictEqual(dryRunJobs.length, before + 1);
    assert.deepStrictEqual(dryRunJobs.at(-1), {
        primaryText: 'Chicken Soup',
        labelType: 'Food',
        secondaryText: 'Spicy',
        dateText: 'Sep 29, 2026',
        iconUrl: `https://api.iconify.design/${chosenIcon.replace(':', '/')}.svg`,
        qtyText: '3',
    });

    // A second "yes" (e.g. "Alexa, yes" while the screen is still up) must not reprint.
    t = await turn(skill, intent('AMAZON.YesIntent', {}, { attributes: t.attributes }));
    assert.match(t.speech, /already printed/);
    assert.strictEqual(dryRunJobs.length, before + 1);
});

test('tapping Print on the screen prints the default label', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'apples' }));
    const icon = t.attributes.label.iconIds[0];
    const before = dryRunJobs.length;
    t = await turn(skill, touch(['print'], { attributes: t.attributes }));
    assert.strictEqual(t.speech, 'Printing.');
    const job = dryRunJobs.at(-1);
    assert.strictEqual(dryRunJobs.length, before + 1);
    assert.strictEqual(job.primaryText, 'Apples');
    assert.strictEqual(job.dateText, today);
    assert.strictEqual(job.qtyText, '1');
    assert.ok(job.iconUrl.endsWith(`${icon.split(':')[1]}.svg`));
});

test('"no" ends without printing', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'rice' }));
    const before = dryRunJobs.length;
    t = await turn(skill, intent('AMAZON.NoIntent', {}, { attributes: t.attributes }));
    assert.strictEqual(t.speech, 'Okay, nothing printed.');
    assert.strictEqual(t.ended, true);
    assert.strictEqual(dryRunJobs.length, before);
});

test('changing the text keeps the chosen icon first and re-reads', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'chicken soup' }));
    t = await turn(skill, intent('SetIconIntent', { index: '2' }, { attributes: t.attributes }));
    const chosen = t.attributes.label.iconIds[1];
    t = await turn(skill, intent('ChangeTextIntent', { text: 'chicken noodle soup' }, { attributes: t.attributes }));
    assert.match(t.speech, /^Changed to Chicken Noodle Soup\./);
    assert.strictEqual(t.attributes.label.iconIds[0], chosen);
    assert.strictEqual(t.directive.datasources.labelData.selectedIndex, 0);
});

test('after more icons, a bare number or ordinal picks from the new page', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'chicken soup' }));
    t = await turn(skill, intent('NextIconIntent', {}, { attributes: t.attributes }));
    const page2 = t.attributes.label.iconIds.slice(8, 16);
    t = await turn(skill, intent('SetIconIntent', { index: '3' }, { attributes: t.attributes }));
    assert.strictEqual(t.attributes.label.iconIndex, 2);
    assert.strictEqual(t.directive.datasources.labelData.selectedIndex, 2);
    t = await turn(skill, intent('SetIconIntent', { ordinal: '5' }, { attributes: t.attributes }));
    assert.match(t.speech, /^Icon five, /);
    const before = dryRunJobs.length;
    t = await turn(skill, intent('AMAZON.YesIntent', {}, { attributes: t.attributes }));
    assert.strictEqual(dryRunJobs.length, before + 1);
    assert.ok(dryRunJobs.at(-1).iconUrl.endsWith(`${page2[4].split(':')[1]}.svg`), 'prints the icon picked from page 2');
});

test('icon by name, out-of-range numbers, and more icons', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'chicken soup' }));
    t = await turn(skill, intent('SetIconIntent', { icon: 'roast chicken' }, { attributes: t.attributes }));
    assert.match(t.speech, /roast chicken/);
    t = await turn(skill, intent('SetIconIntent', { index: '12' }, { attributes: t.attributes }));
    assert.match(t.speech, /don't see that one/);
    t = await turn(skill, intent('NextIconIntent', {}, { attributes: t.attributes }));
    assert.match(t.speech, /more icons/);
    assert.strictEqual(t.attributes.label.page, 1);
});

test('copies are capped at ten; week-style dates are refused; no date works', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'beans' }));
    t = await turn(skill, intent('SetCopiesIntent', { count: '25' }, { attributes: t.attributes }));
    assert.strictEqual(t.attributes.label.copies, 10);
    assert.match(t.speech, /Ten is the most/);
    t = await turn(skill, intent('SetDateIntent', { date: '2026-W40' }, { attributes: t.attributes }));
    assert.match(t.speech, /Which day\?/);
    t = await turn(skill, intent('ClearDateIntent', {}, { attributes: t.attributes }));
    assert.strictEqual(t.directive.datasources.labelData.dateText, '');
});

test('a device without a screen gets the read-back but no screen directive', async () => {
    const t = await turn(skill, intent('PrintLabelIntent', { text: 'chicken soup' }, { apl: false }));
    assert.match(t.speech, /Chicken Soup, with a chicken icon/);
    assert.strictEqual(t.directive, undefined);
});

test('"yes" before any label asks what it should say', async () => {
    const t = await turn(skill, intent('AMAZON.YesIntent'));
    assert.match(t.speech, /What should the label say/);
});

test('requests for a different skill are rejected', async () => {
    await assert.rejects(skill.invoke(intent('PrintLabelIntent', { text: 'soup' }, { skillId: 'amzn1.ask.skill.someone-else' })));
});

test('icon ranking: specific ingredients first, plural words found, brand logos dropped', async () => {
    const { findIcons, spokenName } = require('../src/icons');
    assert.match(spokenName((await findIcons('chicken soup'))[0]), /chicken/);
    assert.match(spokenName((await findIcons('butternut squash soup'))[0]), /squash/);
    const apples = await findIcons('apples');
    assert.match(spokenName(apples[0]), /apple/);
    assert.ok(!apples.includes('mdi:apple'), 'Material "apple" is the Apple logo');
    assert.ok(!apples.some(id => /ios|mac|swift/.test(id)), 'no tech-brand icons');
});

test('Alexa hearing its own prompt is not taken as the secondary text', async () => {
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'braised pork shoulder' }));
    t = await turn(skill, touch(['secondary'], { attributes: t.attributes }));
    assert.match(t.speech, /What goes underneath\?/);
    assert.strictEqual(t.elicit.slotToElicit, 'secondary');
    // Captured echo of the prompt: ignored, asked again.
    t = await turn(skill, intent('SetSecondaryTextIntent', { secondary: 'what should the set' }, { attributes: t.attributes }));
    assert.strictEqual(t.elicit?.slotToElicit, 'secondary');
    assert.strictEqual(t.attributes.label.secondary, '');
    // The real answer lands.
    t = await turn(skill, intent('SetSecondaryTextIntent', { secondary: 'in tomato, lager and vinegar' }, { attributes: t.attributes }));
    assert.strictEqual(t.attributes.label.secondary, 'In tomato, lager and vinegar');
});
