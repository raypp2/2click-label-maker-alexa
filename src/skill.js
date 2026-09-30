'use strict';

const Alexa = require('ask-sdk-core');
const { findIcons, graphicsFor, spokenName } = require('./icons');
const { buildPreviewDirective, TOKEN } = require('./apl');
const { printLabel } = require('./printer');

const PAGE_SIZE = 8;
const MAX_COPIES = 10;
const DEFAULT_TZ = process.env.DEFAULT_TZ || 'America/New_York';
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// ---------------------------------------------------------------- label state
//
// The label being built lives in session attributes:
//   { text, secondary, dateISO, noDate, copies, iconIds[], page, iconIndex, printed }
// iconIds holds up to 32 search results; the screen shows one page of 8 and
// iconIndex is the selection within that page.

const getLabel = h => h.attributesManager.getSessionAttributes().label || null;
const setLabel = (h, label) => {
    const attrs = h.attributesManager.getSessionAttributes();
    attrs.label = label;
    h.attributesManager.setSessionAttributes(attrs);
};

const pageIds = label => label.iconIds.slice(label.page * PAGE_SIZE, (label.page + 1) * PAGE_SIZE);
const currentIconId = label => pageIds(label)[label.iconIndex] || null;
const pageCount = label => Math.max(1, Math.ceil(label.iconIds.length / PAGE_SIZE));

const titleCase = s => s.trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
// Secondary text is a phrase ("in tomato, lager and vinegar"), so only its first letter is capitalized.
const sentenceCase = s => { const t = s.trim().replace(/\s+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const escapeSsml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const numberWord = n => NUMBER_WORDS[n] || String(n);

// ---------------------------------------------------------------- dates

const timeZoneCache = new Map();

/** The device's time zone, so "today" matches the kitchen clock, not the server's UTC. */
async function deviceTimeZone(h) {
    const deviceId = Alexa.getDeviceId(h.requestEnvelope);
    if (timeZoneCache.has(deviceId)) return timeZoneCache.get(deviceId);
    let tz = DEFAULT_TZ;
    try {
        const client = h.serviceClientFactory.getUpsServiceClient();
        tz = await Promise.race([
            client.getSystemTimeZone(deviceId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]) || DEFAULT_TZ;
    } catch (err) {
        console.warn('time zone lookup failed, using %s: %s', DEFAULT_TZ, err.message);
    }
    timeZoneCache.set(deviceId, tz);
    return tz;
}

const todayISO = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/** "2026-09-29" -> "Sep 29, 2026", the same format as the web UI's date field. */
function labelDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d))
        .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function spokenDate(label, today) {
    if (label.noDate) return 'with no date';
    const iso = label.dateISO || today;
    if (iso === today) return 'dated today';
    const [y, m, d] = iso.split('-').map(Number);
    return `dated ${new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
}

// ---------------------------------------------------------------- responses

function iconPhrase(label) {
    const id = currentIconId(label);
    return id ? `a ${spokenName(id)} icon` : 'no icon';
}

function fullReadback(label, today) {
    let s = `${escapeSsml(label.text)}, with ${iconPhrase(label)}, ${spokenDate(label, today)}`;
    if (label.secondary) s += `, and ${escapeSsml(label.secondary)} underneath`;
    if (label.copies > 1) s += `, ${numberWord(label.copies)} copies`;
    return `${s}. Should I print it?`;
}

const supportsApl = h => Boolean(Alexa.getSupportedInterfaces(h.requestEnvelope)['Alexa.Presentation.APL']);

/** Speaks, keeps the mic open, and redraws the screen with the current label. */
async function previewResponse(h, label, speech) {
    const today = todayISO(await deviceTimeZone(h));
    setLabel(h, label);
    const builder = h.responseBuilder
        .speak(speech ?? fullReadback(label, today))
        .reprompt('Should I print it?');

    if (supportsApl(h)) {
        const graphics = await graphicsFor(pageIds(label));
        builder.addDirective(buildPreviewDirective({
            text: label.text,
            secondary: label.secondary,
            dateText: label.noDate ? '' : labelDate(label.dateISO || today),
            copies: label.copies,
            iconIndex: label.iconIndex,
        }, graphics));
    }
    return builder.getResponse();
}

/** Asks for a free-text slot; the answer can then be just the words, no carrier phrase. */
function elicit(h, intentName, slotName, prompt) {
    return h.responseBuilder
        .speak(prompt)
        .reprompt(prompt)
        .addElicitSlotDirective(slotName, {
            name: intentName,
            confirmationStatus: 'NONE',
            slots: { [slotName]: { name: slotName, confirmationStatus: 'NONE' } },
        })
        .getResponse();
}

const noLabelYet = h => elicit(h, 'PrintLabelIntent', 'text', 'What should the label say?');

// ---------------------------------------------------------------- actions (shared by voice and touch)

async function startLabel(h, rawText) {
    const text = titleCase(rawText);
    let iconIds = [];
    try {
        iconIds = await findIcons(rawText);
    } catch (err) {
        console.error('icon search failed:', err.message);
    }
    return previewResponse(h, {
        text, secondary: '', dateISO: null, noDate: false, copies: 1,
        iconIds, page: 0, iconIndex: 0, printed: false,
    });
}

async function changeText(h, rawText) {
    const label = getLabel(h);
    if (!label) return startLabel(h, rawText);
    // New text deserves fresh icon suggestions, but keep the icon already chosen first.
    const keep = currentIconId(label);
    let found = [];
    try {
        found = await findIcons(rawText);
    } catch (err) {
        console.error('icon search failed:', err.message);
    }
    label.text = titleCase(rawText);
    label.iconIds = keep ? [keep, ...found.filter(id => id !== keep)].slice(0, 32) : found;
    label.page = 0;
    label.iconIndex = 0;
    label.printed = false;
    return previewResponse(h, label, `Changed to ${escapeSsml(label.text)}. Should I print it?`);
}

async function nextIcons(h) {
    const label = getLabel(h);
    if (!label) return noLabelYet(h);
    if (pageCount(label) === 1) {
        return previewResponse(h, label, 'Those are all the icons I found. Say a number, or tap one.');
    }
    label.page = (label.page + 1) % pageCount(label);
    label.iconIndex = 0;
    return previewResponse(h, label, 'Here are more icons. Say a number, or tap one.');
}

async function print(h) {
    const label = getLabel(h);
    if (!label) return noLabelYet(h);
    if (label.printed) {
        return h.responseBuilder
            .speak('That label already printed. To make another, say print, then what it should say.')
            .reprompt('What should the next label say?')
            .getResponse();
    }

    // Mark before sending, so a second "yes" arriving mid-print can't print twice.
    label.printed = true;
    setLabel(h, label);
    const today = todayISO(await deviceTimeZone(h));
    try {
        await printLabel({
            text: label.text,
            secondary: label.secondary,
            dateText: label.noDate ? '' : labelDate(label.dateISO || today),
            copies: label.copies,
            iconId: currentIconId(label),
        });
    } catch (err) {
        console.error('print failed:', err.message);
        label.printed = false;
        setLabel(h, label);
        return h.responseBuilder
            .speak("I couldn't reach the printer. Check that it's on, then say yes to try again.")
            .reprompt('Say yes to try again, or cancel.')
            .getResponse();
    }
    const copies = label.copies > 1 ? `${numberWord(label.copies)} labels` : '';
    return h.responseBuilder.speak(copies ? `Printing ${copies}.` : 'Printing.').withShouldEndSession(true).getResponse();
}

// ---------------------------------------------------------------- handlers

const isIntent = (h, ...names) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
    && names.includes(Alexa.getIntentName(h.requestEnvelope));
const slot = (h, name) => Alexa.getSlotValue(h.requestEnvelope, name)?.trim() || null;

// On Alexa+ the mic sometimes opens while Alexa is still speaking, and the skill
// receives its own prompt back as the answer ("what should the set..."). Treat any
// text that sounds like one of our prompts as no answer at all.
const OWN_PROMPT = /^(what|whats|what's)\b|\bshould (the|it) (label|secondary|set|second)|\bsay instead\b|\bgoes underneath\b/i;
const answer = (h, name) => {
    const text = slot(h, name);
    return text && !OWN_PROMPT.test(text) ? text : null;
};

const LaunchHandler = {
    canHandle: h => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest',
    handle: h => noLabelYet(h),
};

const PrintLabelHandler = {
    canHandle: h => isIntent(h, 'PrintLabelIntent'),
    handle: h => {
        const text = answer(h, 'text');
        return text ? startLabel(h, text) : noLabelYet(h);
    },
};

const ConfirmPrintHandler = {
    canHandle: h => isIntent(h, 'ConfirmPrintIntent', 'AMAZON.YesIntent'),
    handle: h => print(h),
};

const ChangeTextHandler = {
    canHandle: h => isIntent(h, 'ChangeTextIntent'),
    handle: h => {
        const text = answer(h, 'text');
        return text ? changeText(h, text) : elicit(h, 'ChangeTextIntent', 'text', 'What should it say instead?');
    },
};

const SecondaryTextHandler = {
    canHandle: h => isIntent(h, 'SetSecondaryTextIntent'),
    handle: h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        const text = answer(h, 'secondary');
        if (!text) return elicit(h, 'SetSecondaryTextIntent', 'secondary', 'What goes underneath?');
        label.secondary = sentenceCase(text);
        label.printed = false;
        return previewResponse(h, label, `Added ${escapeSsml(label.secondary)} underneath. Should I print it?`);
    },
};

const AddSecondaryPromptHandler = {
    canHandle: h => isIntent(h, 'AddSecondaryTextPromptIntent'),
    handle: h => (getLabel(h)
        ? elicit(h, 'SetSecondaryTextIntent', 'secondary', 'What goes underneath?')
        : noLabelYet(h)),
};

const ClearSecondaryHandler = {
    canHandle: h => isIntent(h, 'ClearSecondaryTextIntent'),
    handle: h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        label.secondary = '';
        label.printed = false;
        return previewResponse(h, label, 'Removed the secondary text. Should I print it?');
    },
};

const SetIconHandler = {
    canHandle: h => isIntent(h, 'SetIconIntent'),
    handle: h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        const ids = pageIds(label);
        if (ids.length === 0) return previewResponse(h, label, 'I have no icons for this label. Should I print it without one?');

        let index = -1;
        // "three" / "icon three" fill index; "the third one" fills ordinal.
        const n = Number(slot(h, 'index') ?? slot(h, 'ordinal'));
        const name = slot(h, 'icon')?.toLowerCase();
        if (Number.isInteger(n) && n >= 1 && n <= ids.length) index = n - 1;
        else if (name) index = ids.findIndex(id => spokenName(id).includes(name));

        if (index < 0) {
            return previewResponse(h, label,
                `I don't see that one on screen. Say a number from one to ${numberWord(ids.length)}.`);
        }
        label.iconIndex = index;
        label.printed = false;
        return previewResponse(h, label,
            `Icon ${numberWord(index + 1)}, ${spokenName(ids[index])}. Should I print it?`);
    },
};

const NextIconHandler = {
    canHandle: h => isIntent(h, 'NextIconIntent'),
    handle: h => nextIcons(h),
};

const SetCopiesHandler = {
    canHandle: h => isIntent(h, 'SetCopiesIntent'),
    handle: h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        const n = Number(slot(h, 'count'));
        if (!Number.isInteger(n) || n < 1) return previewResponse(h, label, 'How many copies? Say a number from one to ten.');
        label.copies = Math.min(n, MAX_COPIES);
        label.printed = false;
        const capped = n > MAX_COPIES ? ` Ten is the most I'll print at once.` : '';
        const what = label.copies === 1 ? 'One copy. Should I print it?' : `${numberWord(label.copies)} copies. Should I print them?`;
        return previewResponse(h, label, `${capped} ${what}`.trim());
    },
};

const SetDateHandler = {
    canHandle: h => isIntent(h, 'SetDateIntent'),
    handle: async h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        const value = slot(h, 'date');
        // AMAZON.DATE can resolve to a week or month ("2026-W40"); a label needs a day.
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return previewResponse(h, label, 'Which day? For example, say change the date to yesterday.');
        }
        label.dateISO = value;
        label.noDate = false;
        label.printed = false;
        const today = todayISO(await deviceTimeZone(h));
        return previewResponse(h, label, `Okay, ${spokenDate(label, today)}. Should I print it?`);
    },
};

const ClearDateHandler = {
    canHandle: h => isIntent(h, 'ClearDateIntent'),
    handle: h => {
        const label = getLabel(h);
        if (!label) return noLabelYet(h);
        label.noDate = true;
        label.printed = false;
        return previewResponse(h, label, 'No date. Should I print it?');
    },
};

const StopHandler = {
    canHandle: h => isIntent(h, 'AMAZON.NoIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'),
    handle: h => h.responseBuilder
        .speak(getLabel(h)?.printed ? 'Okay.' : 'Okay, nothing printed.')
        .withShouldEndSession(true)
        .getResponse(),
};

const HelpHandler = {
    canHandle: h => isIntent(h, 'AMAZON.HelpIntent'),
    handle: h => {
        const help = getLabel(h)
            ? 'Say yes to print. You can also say use icon three, change the text to something else, add secondary text, or two copies.'
            : 'Tell me what the label should say, for example, print chicken soup.';
        return h.responseBuilder.speak(help).reprompt(help).getResponse();
    },
};

const FallbackHandler = {
    canHandle: h => isIntent(h, 'AMAZON.FallbackIntent'),
    handle: h => {
        const tip = getLabel(h)
            ? "Sorry, I didn't catch that. Say yes to print, use icon three, or change the text."
            : "Sorry, I didn't catch that. What should the label say?";
        return h.responseBuilder.speak(tip).reprompt(tip).getResponse();
    },
};

/** Taps on the Echo Show screen. */
const TouchHandler = {
    canHandle: h => Alexa.getRequestType(h.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent'
        && h.requestEnvelope.request.token === TOKEN,
    handle: h => {
        const [action, arg] = h.requestEnvelope.request.arguments || [];
        const label = getLabel(h);
        switch (action) {
            case 'selectIcon': {
                // The screen already swapped the icon locally; just remember it, silently.
                if (label && Number.isInteger(arg) && arg >= 0 && arg < pageIds(label).length) {
                    label.iconIndex = arg;
                    label.printed = false;
                    setLabel(h, label);
                }
                return h.responseBuilder.getResponse();
            }
            case 'print':
                return print(h);
            case 'changeText':
                return elicit(h, 'ChangeTextIntent', 'text', 'What should it say instead?');
            case 'secondary':
                return elicit(h, 'SetSecondaryTextIntent', 'secondary', 'What goes underneath?');
            case 'moreIcons':
                return nextIcons(h);
            default:
                console.warn('unknown touch event', action);
                return h.responseBuilder.getResponse();
        }
    },
};

const SessionEndedHandler = {
    canHandle: h => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest',
    handle: h => {
        const { reason, error } = h.requestEnvelope.request;
        if (reason === 'ERROR') console.error('session ended with error:', JSON.stringify(error));
        return h.responseBuilder.getResponse();
    },
};

const ErrorHandler = {
    canHandle: () => true,
    handle: (h, err) => {
        console.error('handler error:', err.stack || err.message);
        return h.responseBuilder
            .speak('Sorry, something went wrong on my end. Please try again.')
            .withShouldEndSession(true)
            .getResponse();
    },
};

/** One line per request, so a device test can be matched to the intent Alexa chose. */
const RequestLogger = {
    process(h) {
        const req = h.requestEnvelope.request;
        const slots = Object.values(req.intent?.slots || {})
            .filter(s => s.value).map(s => `${s.name}=${JSON.stringify(s.value)}`).join(' ');
        const args = req.arguments ? ` args=${JSON.stringify(req.arguments)}` : '';
        console.log(`[request] ${req.type}${req.intent ? ` ${req.intent.name}` : ''}${slots ? ` ${slots}` : ''}${args}`);
    },
};

function buildSkill(skillId) {
    const builder = Alexa.SkillBuilders.custom()
        .addRequestInterceptors(RequestLogger)
        .addRequestHandlers(
            LaunchHandler, PrintLabelHandler, ConfirmPrintHandler, ChangeTextHandler,
            SecondaryTextHandler, AddSecondaryPromptHandler, ClearSecondaryHandler,
            SetIconHandler, NextIconHandler, SetCopiesHandler, SetDateHandler, ClearDateHandler,
            TouchHandler, StopHandler, HelpHandler, FallbackHandler, SessionEndedHandler,
        )
        .addErrorHandlers(ErrorHandler)
        .withApiClient(new Alexa.DefaultApiClient());
    if (skillId) builder.withSkillId(skillId);
    return builder.create();
}

module.exports = { buildSkill, labelDate, titleCase };
