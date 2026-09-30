'use strict';

const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { buildSkill } = require('./skill');

const PORT = Number(process.env.PORT || 3000);
const SKILL_ID = process.env.SKILL_ID;

// Signature and timestamp verification are what make this public endpoint safe:
// only Alexa can produce a valid signature. They can be turned off solely for
// local tests, and never together with a production skill ID check disabled.
const VERIFY = process.env.UNSAFE_SKIP_VERIFICATION !== '1';

if (!SKILL_ID) {
    console.error('SKILL_ID is required: requests from any other skill must be rejected.');
    process.exit(1);
}
if (!VERIFY) console.warn('WARNING: Alexa request signature verification is OFF (local testing only).');

const app = express();
app.disable('x-powered-by');

const adapter = new ExpressAdapter(buildSkill(SKILL_ID), VERIFY, VERIFY);
app.post('/alexa', adapter.getRequestHandlers());

app.get('/alexa/health', (req, res) => res.json({ ok: true }));

// Funnel only forwards /alexa, but refuse everything else here too.
app.use((req, res) => res.status(404).end());

app.listen(PORT, () => console.log(`label maker skill listening on :${PORT} (verification ${VERIFY ? 'on' : 'OFF'})`));
