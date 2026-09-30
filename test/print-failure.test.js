'use strict';

// Real print path pointed at a port nothing listens on: the printer is "down".
process.env.DRY_RUN = '0';
process.env.LABEL_MAKER_URL = 'http://127.0.0.1:9';

const test = require('node:test');
const assert = require('node:assert');
const { buildSkill } = require('../src/skill');
const { SKILL_ID, intent, turn } = require('./helpers');

test('when the label maker is unreachable, Alexa says so and "yes" can retry', async () => {
    const skill = buildSkill(SKILL_ID);
    let t = await turn(skill, intent('PrintLabelIntent', { text: 'soup' }));
    t = await turn(skill, intent('AMAZON.YesIntent', {}, { attributes: t.attributes }));
    assert.match(t.speech, /couldn't reach the printer/);
    assert.notStrictEqual(t.ended, true, 'session stays open to retry');
    assert.strictEqual(t.attributes.label.printed, false, 'a failed print can be retried');
});
