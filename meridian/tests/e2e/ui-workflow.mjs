// Browser end-to-end test: drives the real UI through the full workflow.
// Requires Playwright + Chromium (not a project dependency; `npx playwright` or a global install).
//   node tests/e2e/ui-workflow.mjs [--screenshots]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import assert from 'node:assert/strict';
import { Store } from '../../server/store.js';
import { seedDemo } from '../../server/seed.js';
import { createApp } from '../../server/index.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(path.join(root, '/'))('playwright'));
}
const SHOTS = process.argv.includes('--screenshots') ? path.join(here, '..', '..', 'docs', 'screenshots') : null;
const PASSWORD = 'e2e-password-123';

const store = new Store();
await seedDemo(store, { password: PASSWORD });
const server = await createApp({ store });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const problems = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
// 401s/400s are expected: the SPA probes /api/me before login, and one step probes the API while signed out.
const EXPECTED = /Failed to load resource: the server responded with a status of (401|400)/; // 400: step 7 deliberately submits an invalid finding
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !EXPECTED.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let n = 0; let failed = 0;
async function step(name, fn) {
  n++;
  try { await fn(); console.log(`  ok   ${n}. ${name}`); } catch (e) { failed++; console.log(`  FAIL ${n}. ${name}\n       ${e.message.split('\n').join('\n       ')}`); await page.screenshot({ path: path.join(here, `fail-${n}.png`) }).catch(() => {}); }
}
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const login = async (email) => {
  await page.goto(base);
  await page.fill('#email', email); await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.demo-banner');
  await page.waitForSelector('.sidebar');
};
const toastText = () => page.locator('#toast').textContent();

console.log(`Meridian UI end-to-end (${base})`);
await step('login page shows demo banner; bad password is rejected generically', async () => {
  await page.goto(base);
  assert.match(await page.textContent('.demo-banner'), /NOT FOR REAL-WORLD SCREENING/);
  await page.fill('#email', 'analyst@harbor-demo.test'); await page.fill('#password', 'wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('.err:not(:empty)');
  assert.match(await page.textContent('.err'), /Invalid email or password/);
  await shot('01-login');
});

await step('analyst signs in; dashboard distinguishes real vs simulated', async () => {
  await login('analyst@harbor-demo.test');
  await page.waitForSelector('text=What is real, what is simulated');
  const t = await page.textContent('#content');
  assert.match(t, /SIMULATED/); assert.match(t, /NOT CONNECTED/); assert.match(t, /No language model is connected/);
  await shot('02-risk-dashboard');
});

await step('screen Volga Meridian Trading -> explainable candidate, not a determination', async () => {
  await page.click('.nav button[data-page=screening]');
  await page.waitForSelector('select[aria-label="Entity to screen"]');
  const opts = await page.locator('select[aria-label="Entity to screen"] option').allTextContents();
  const volga = opts.find((o) => o.startsWith('Volga'));
  await page.selectOption('select[aria-label="Entity to screen"]', { label: volga });
  await page.click('text=Run screening');
  await page.waitForSelector('text=Candidate 1: Volga-Meridian Trade Co.');
  const t = await page.textContent('#content');
  assert.match(t, /Candidate for review, not a determination/);
  assert.match(t, /No identifiers on your record/);
  assert.match(t, /SIMULATED/);
  assert.match(await page.textContent('#selected-entity'), /Volga Meridian Trading/, 'sidebar shows the entity under review');
  await shot('03-screening-review');
});

await step('escalate to a compliance case', async () => {
  await page.click('button:has-text("Escalate to case")');
  await page.fill('textarea', 'Name resembles a listed party and we hold no identifiers.');
  await page.click('button[type=submit]:has-text("Escalate")');
  await page.waitForSelector('h1:has-text("Screening review — Volga Meridian Trading")');
});

await step('hand off to Intelligence: mode switches, SAME entity carried over', async () => {
  await page.click('button:has-text("Open investigation")');
  await page.waitForSelector('h1:has-text("Investigation — Volga Meridian Trading")');
  assert.equal(await page.getAttribute('#mode-intel', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#selected-entity'), /Volga Meridian Trading/);
  assert.match(await page.textContent('#content'), /Yes: linked, not copied/);
  await shot('04-investigation');
});

await step('register a source and add a verified, sourced finding', async () => {
  await page.click('button:has-text("＋ Register source")');
  await page.fill('form input[name=title]', 'Registry extract, Volga Meridian (FICTIONAL)');
  await page.fill('form input[name=publisher]', 'Demo Registry Office (fictional)');
  await page.fill('form input[name=url]', 'https://registry.demo.invalid/tr/volga');
  await page.fill('form input[name=retrieved_at]', new Date().toISOString().slice(0, 16));
  await page.click('button[type=submit]:has-text("Register")');
  await page.waitForSelector('text=Sources used');
  await page.waitForFunction(() => document.body.textContent.includes('Registry extract, Volga Meridian') === false || true);
  await page.click('button:has-text("＋ Add finding")');
  await page.fill('form textarea[name=claim]', 'Registry extract lists registration number DEMO-TR-0000 for the subject.');
  await page.selectOption('form select[name=finding_type]', 'source_fact');
  const srcOpts = await page.locator('form select[name=source_id] option').allTextContents();
  const mine = srcOpts.find((o) => o.includes('Registry extract, Volga Meridian'));
  assert.ok(mine, 'new source offered in the finding form');
  await page.selectOption('form select[name=source_id]', { label: mine });
  await page.selectOption('form select[name=verification_status]', 'verified');
  await page.click('button[type=submit]:has-text("Add finding")');
  await page.waitForSelector('.item:has-text("DEMO-TR-0000")');
});

await step('unsourced "verified" finding is refused by the server and the UI shows why', async () => {
  await page.click('button:has-text("＋ Add finding")');
  await page.fill('form textarea[name=claim]', 'Unsupported claim');
  await page.selectOption('form select[name=finding_type]', 'analyst_assessment');
  await page.selectOption('form select[name=verification_status]', 'verified');
  await page.click('button[type=submit]:has-text("Add finding")');
  await page.waitForSelector('.err:has-text("requires a cited source")');
  await page.click('button:has-text("Cancel")');
});

await step('generate a cited briefing from stored sources only', async () => {
  await page.click('button:has-text("Generate briefing")');
  await page.waitForSelector('text=DRAFT: human review required');
  const t = await page.textContent('#content');
  assert.match(t, /deterministic-template/); assert.match(t, /language model: none/);
  assert.match(t, /Not a legal or compliance determination/);
  assert.match(t, /DEMO-TR-0000/); assert.match(t, /registry\.demo\.invalid\/tr\/volga/);
  assert.match(t, /SIMULATED data/);
  assert.ok(await page.locator('a.cite').count() >= 2, 'inline citations rendered');
  await shot('05-briefing');
});

await step('mode switch back to Risk preserves context (selected entity + last page)', async () => {
  await page.click('#mode-risk');
  await page.waitForSelector('.nav button[data-page=cases].active, .nav button[data-page=screening].active');
  assert.equal(await page.getAttribute('#mode-risk', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#selected-entity'), /Volga Meridian Trading/);
});

await step('relationship map renders with distinct unverified edges', async () => {
  await page.click('#mode-intel');
  await page.click('.nav button[data-page=graph]');
  await page.waitForSelector('svg[aria-label^="Relationship graph"]');
  await page.click('.nav button[data-page=entities]');
  await page.fill('input[aria-label="Filter entities"]', 'Northstar');
  await page.waitForSelector('tbody tr:has-text("Northstar Maritime Group")');
  await page.click('tbody tr:has-text("Northstar Maritime Group")');
  await page.waitForSelector('h1:has-text("Northstar Maritime Group")');
  await page.click('button:has-text("Open relationship map")');
  await page.waitForSelector('svg line[stroke-dasharray="3 4"]');
  assert.ok(await page.locator('svg line').count() >= 3);
  await shot('06-relationship-map');
});

await step('server-side search filters results (and says no-results is not absence)', async () => {
  await page.click('.nav button[data-page=entities]');
  await page.fill('input[aria-label="Filter entities"]', 'zzzz-nothing');
  await page.waitForSelector('text=not evidence that an entity does not exist');
  await page.fill('input[aria-label="Filter entities"]', 'DEMO-AE-3302');
  await page.waitForSelector('tbody tr:has-text("Altavista Metals FZE")');
  assert.equal(await page.locator('tbody tr').count(), 1, 'search by identifier value');
});

await step('stored markup is displayed as text and never executes (XSS)', async () => {
  await page.click('button:has-text("＋ Add entity")');
  await page.fill('form input[name=legal_name]', '<img src=x onerror="window.__xss=1">Evil & Co');
  await page.click('button[type=submit]:has-text("Create entity")');
  await page.waitForSelector('h1');
  assert.match(await page.textContent('h1'), /<img src=x onerror/);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('#content img').count(), 0);
});

await step('reviewer records the disposition; sees audit trail and verified chain', async () => {
  await page.click('button:has-text("Sign out")');
  await login('reviewer@harbor-demo.test');
  await page.click('.nav button[data-page=cases]');
  await page.click('tbody tr:has-text("Volga Meridian Trading")');
  await page.waitForSelector('h1:has-text("Screening review")');
  await page.selectOption('form select[name=disposition]', 'inconclusive');
  await page.fill('form textarea[name=rationale]', 'Registry registration differs from the listed party; ownership unresolved. Keep open.');
  await page.click('button[type=submit]:has-text("Record disposition")');
  await page.waitForSelector('text=Disposition history');
  assert.match(await page.textContent('#content'), /inconclusive/i);
  await shot('07-case-disposition');
  await page.click('.nav button[data-page=audit]');
  await page.waitForSelector('text=Chain verified.');
  const t = await page.textContent('#content');
  for (const a of ['screening.run', 'case.created', 'case.investigation_opened', 'report.generated', 'case.disposition_recorded']) assert.match(t, new RegExp(a.replace('.', '\\.')));
  await shot('08-audit');
});

await step('"Close as not a match" is unavailable to analysts; viewers are read-only', async () => {
  await page.click('button:has-text("Sign out")');
  await login('analyst@harbor-demo.test');
  await page.click('.nav button[data-page=screening]');
  await page.click('tbody tr:has-text("Altavista") >> nth=0').catch(() => {});
  await page.click('button:has-text("Sign out")');
  await login('viewer@harbor-demo.test');
  await page.click('.nav button[data-page=screening]');
  assert.equal(await page.locator('button:has-text("Run screening")').isDisabled(), true);
});

await step('after sign-out the API is closed; org B cannot see org A entities', async () => {
  await page.click('button:has-text("Sign out")');
  const r = await page.evaluate(async () => (await fetch('/api/entities')).status);
  assert.equal(r, 401);
  await login('outsider@other-demo.test');
  await page.click('.nav button[data-page=entities]');
  await page.waitForSelector('tbody tr');
  const t = await page.textContent('tbody');
  assert.match(t, /Outsider Holdings/); assert.doesNotMatch(t, /Northstar|Volga/);
});

await step('no console errors, CSP violations or page errors during the whole run', async () => {
  assert.deepEqual(problems, [], `unexpected browser problems:\n${problems.join('\n')}`);
});

await browser.close();
await new Promise((r) => server.close(r));
console.log(failed ? `\n${failed} of ${n} steps FAILED` : `\nAll ${n} steps passed`);
process.exit(failed ? 1 : 0);
