'use strict';

const SKILL_ID = 'amzn1.ask.skill.00000000-0000-0000-0000-000000000000';

const APL_DEVICE = {
    'Alexa.Presentation.APL': { runtime: { maxVersion: '2024.3' } },
};

/**
 * Builds an Alexa request envelope shaped like what Alexa sends (no signature;
 * handlers are invoked directly, not over HTTP).
 */
function envelope(request, { attributes = {}, apl = true, skillId = SKILL_ID } = {}) {
    return {
        version: '1.0',
        session: {
            new: Object.keys(attributes).length === 0,
            sessionId: 'amzn1.echo-api.session.test',
            application: { applicationId: skillId },
            attributes,
            user: { userId: 'amzn1.ask.account.test' },
        },
        context: {
            System: {
                application: { applicationId: skillId },
                user: { userId: 'amzn1.ask.account.test' },
                device: { deviceId: 'amzn1.ask.device.test', supportedInterfaces: apl ? APL_DEVICE : {} },
                apiEndpoint: 'https://api.amazonalexa.com',
            },
            ...(apl ? { 'Alexa.Presentation.APL': { token: 'labelPreview', version: '2024.3' } } : {}),
            Viewport: { shape: 'RECTANGLE', pixelWidth: 1920, pixelHeight: 1080, dpi: 160 },
        },
        request: {
            requestId: 'amzn1.echo-api.request.test',
            timestamp: new Date().toISOString(),
            locale: 'en-US',
            ...request,
        },
    };
}

const intent = (name, slots = {}, opts) => envelope({
    type: 'IntentRequest',
    dialogState: 'STARTED',
    intent: {
        name,
        confirmationStatus: 'NONE',
        slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v, confirmationStatus: 'NONE' }])),
    },
}, opts);

const launch = opts => envelope({ type: 'LaunchRequest' }, opts);

const touch = (args, opts) => envelope({
    type: 'Alexa.Presentation.APL.UserEvent',
    token: 'labelPreview',
    arguments: args,
    source: { type: 'TouchWrapper', handler: 'Press' },
}, opts);

/** Runs a conversation turn and returns { response, attributes, speech, directive }. */
async function turn(skill, env) {
    const result = await skill.invoke(env);
    const response = result.response || {};
    return {
        raw: result,
        response,
        attributes: result.sessionAttributes || {},
        speech: response.outputSpeech?.ssml?.replace(/<\/?speak>/g, '') || '',
        directive: (response.directives || []).find(d => d.type === 'Alexa.Presentation.APL.RenderDocument'),
        elicit: (response.directives || []).find(d => d.type === 'Dialog.ElicitSlot'),
        ended: response.shouldEndSession,
    };
}

module.exports = { SKILL_ID, envelope, intent, launch, touch, turn };
