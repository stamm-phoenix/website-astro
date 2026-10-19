/**
 * Logs the preview test account into a PR preview and keeps the session, so pages of the
 * Leitendenbereich can be checked there with real API and test data (`docs/preview-testkonto.md`).
 *
 *   bun scripts/preview-login.ts <preview URL> [--out <file>] [--shot <path>]... [--width <px>]
 *
 * Reads the login, password and TOTP secret of the account from `PREVIEW_TEST_LOGIN`,
 * `PREVIEW_TEST_PASSWORD` and `PREVIEW_TEST_TOTP_SECRET`. The session goes to `--out` (default
 * `test-results/preview-auth/<host>.json`, ignored by git) and is reused while it is valid; use
 * it as `storageState` in Playwright. Each `--shot` path is opened and saved as a full-page
 * screenshot in `test-results/preview-shots/` (390px wide unless `--width` says otherwise).
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const PREVIEW_HOST = /^zealous-water-04f606303-[a-z0-9-]+(\.[a-z0-9-]+)*\.azurestaticapps\.net$/;
const STEP_TIMEOUT_MS = 20_000;
const MAX_STEPS = 12;

interface Options {
  base: URL;
  out: string;
  shots: string[];
  width: number;
}

interface Credentials {
  login: string;
  password: string;
  totpSecret: string;
}

function usage(message: string): never {
  console.error(message);
  console.error(
    'Usage: bun scripts/preview-login.ts <preview URL> [--out <file>] [--shot <path>]... [--width <px>]'
  );
  process.exit(1);
}

function parseArgs(args: string[]): Options {
  let base: URL | undefined;
  let out: string | undefined;
  const shots: string[] = [];
  let width = 390;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') out = args[++i];
    else if (arg === '--shot') shots.push(args[++i]);
    else if (arg === '--width') width = Number(args[++i]);
    else if (!base) base = new URL(arg);
    else usage(`Unknown argument: ${arg}`);
  }
  if (!base) usage('The preview URL is missing.');
  // Only previews: the test account is refused on production anyway (`requireStaff`)
  if (base.protocol !== 'https:' || !PREVIEW_HOST.test(base.hostname)) {
    usage(`Not a PR preview of the website: ${base.origin}`);
  }
  if (!Number.isInteger(width) || width < 320) usage('--width needs a number of at least 320.');
  return {
    base: new URL(base.origin),
    out: out ?? join('test-results', 'preview-auth', `${base.hostname}.json`),
    shots,
    width,
  };
}

function credentials(): Credentials {
  const login = process.env.PREVIEW_TEST_LOGIN;
  const password = process.env.PREVIEW_TEST_PASSWORD;
  const totpSecret = process.env.PREVIEW_TEST_TOTP_SECRET;
  if (!login || !password || !totpSecret) {
    usage('PREVIEW_TEST_LOGIN, PREVIEW_TEST_PASSWORD and PREVIEW_TEST_TOTP_SECRET must be set.');
  }
  return { login, password, totpSecret };
}

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = value.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('PREVIEW_TEST_TOTP_SECRET is not a Base32 key.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** Six-digit code of the authenticator app (RFC 6238: SHA-1, 30 seconds). */
function totp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until the next code is valid long enough to type it, and never reuses one. */
async function nextCode(secret: string, lastCounter: number | null): Promise<[string, number]> {
  for (;;) {
    const now = Date.now() / 1000;
    const counter = Math.floor(now / 30);
    if (counter !== lastCounter && 30 - (now % 30) > 5) return [totp(secret, counter), counter];
    await wait(1000);
  }
}

async function loggedInAs(context: BrowserContext, base: URL): Promise<string | null> {
  const response = await context.request.get(new URL('/.auth/me', base).href);
  if (!response.ok()) return null;
  const body = (await response.json()) as { clientPrincipal?: { userDetails?: string } | null };
  return body.clientPrincipal?.userDetails ?? null;
}

type LoginStep = 'done' | 'email' | 'password' | 'code' | 'other-way' | 'stay' | 'error';

/** Recognises the page of the Microsoft login (English, forced via the browser locale). */
async function currentStep(page: Page, base: URL): Promise<LoginStep | null> {
  if (new URL(page.url()).host === base.host) return 'done';
  const visible = async (selector: string): Promise<boolean> =>
    page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
  if (await visible('#usernameError, #passwordError, #idSpan_SAOTCC_Error_OTC')) return 'error';
  if (await visible('input[name="otc"]')) return 'code';
  if (await visible('input[name="passwd"]')) return 'password';
  if (await visible('input[name="loginfmt"]')) return 'email';
  if (await visible('#KmsiCheckboxField, input[name="DontShowAgain"]')) return 'stay';
  if (await visible('[data-value="PhoneAppOTP"]')) return 'other-way';
  if (await visible('#signInAnotherWay')) return 'other-way';
  return null;
}

async function waitForStep(page: Page, base: URL, previous: LoginStep | null): Promise<LoginStep> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const step = await currentStep(page, base);
    if (step && (step !== previous || step === 'done')) return step;
    await wait(500);
  }
  throw new Error(`The login got stuck at ${page.url()}.`);
}

async function logIn(page: Page, base: URL, account: Credentials): Promise<void> {
  await page.goto(
    new URL('/.auth/login/aad?post_login_redirect_uri=/leitendenbereich/', base).href
  );
  let step: LoginStep | null = null;
  let lastCounter: number | null = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    step = await waitForStep(page, base, step);
    switch (step) {
      case 'done':
        return;
      case 'error': {
        const text = await page.locator('[role="alert"], .alert-error').first().textContent();
        throw new Error(`Microsoft refused the login: ${text?.trim() ?? page.url()}`);
      }
      case 'email':
        await page.locator('input[name="loginfmt"]').fill(account.login);
        await page.keyboard.press('Enter');
        break;
      case 'password':
        await page.locator('input[name="passwd"]').fill(account.password);
        await page.keyboard.press('Enter');
        break;
      case 'other-way': {
        // Another method is preselected (e.g. a push to the app): choose the code instead
        const code = page.locator('[data-value="PhoneAppOTP"]');
        if (await code.isVisible()) await code.click();
        else await page.locator('#signInAnotherWay').click();
        break;
      }
      case 'code': {
        const [code, counter] = await nextCode(account.totpSecret, lastCounter);
        lastCounter = counter;
        await page.locator('input[name="otc"]').fill(code);
        await page.keyboard.press('Enter');
        break;
      }
      case 'stay':
        // „Stay signed in?“: no, the session lives in the storage state anyway
        await page.locator('#idBtn_Back').click();
        break;
    }
  }
  throw new Error(`The login did not finish after ${MAX_STEPS} steps, last at ${page.url()}.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}
  );
  try {
    const contextOptions = {
      locale: 'en-US',
      colorScheme: 'light' as const,
      viewport: { width: options.width, height: 844 },
      isMobile: options.width < 768,
      hasTouch: options.width < 768,
    };
    let context = await browser.newContext({
      ...contextOptions,
      storageState: existsSync(options.out) ? options.out : undefined,
    });
    let user = await loggedInAs(context, options.base);
    if (user) {
      console.log(`Session still valid for ${user}.`);
    } else {
      await context.close();
      context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await logIn(page, options.base, credentials());
      user = await loggedInAs(context, options.base);
      if (!user) throw new Error('The login finished, but the preview knows no user.');
      mkdirSync(dirname(options.out), { recursive: true });
      await context.storageState({ path: options.out });
      console.log(`Logged in as ${user}.`);
    }
    console.log(`Session: ${options.out}`);

    if (options.shots.length > 0) {
      const page = await context.newPage();
      const folder = join('test-results', 'preview-shots');
      mkdirSync(folder, { recursive: true });
      for (const path of options.shots) {
        const response = await page.goto(new URL(path, options.base).href);
        await page.waitForLoadState('networkidle');
        const file = join(
          folder,
          `${path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'start'}-${options.width}.png`
        );
        await page.screenshot({ path: file, fullPage: true });
        console.log(`${response?.status() ?? '?'} ${path} → ${file}`);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
