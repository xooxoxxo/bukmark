import crypto from 'node:crypto';
import { sql as dsql } from 'drizzle-orm';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { owner, authCodes } from '../db/schema.js';
import { randomToken, sha256hex, safeEqualString } from './crypto.js';
import { SESSION_COOKIE, resolveSession } from './sessions.js';
import { checkOrigin } from './plugin.js';
import { attemptLogin } from './login.js';
import { deleteStaleAuthCodes } from './tokens.js';

const REDIRECT_URI = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/[A-Za-z0-9._~/-]*$/;
const STATE = /^[A-Za-z0-9._~-]{16,256}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  // Not no-referrer: under it Chrome sends `Origin: null` on this page's own
  // form posts, which the Origin check has to refuse. same-origin still sends
  // no Referer to chromiumapp.org or anywhere else.
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://*.chromiumapp.org; frame-ancestors 'none'; base-uri 'none'",
};

type AuthorizeParams = {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  clientName: string;
  extensionId: string;
};

/** Validates the OAuth parameters of a GET query or of the hidden fields a POST sends back. */
function parseAuthorizeParams(src: unknown): AuthorizeParams | { error: string } {
  const p = (typeof src === 'object' && src !== null ? src : {}) as Record<string, unknown>;
  if (p.response_type !== 'code') return { error: 'response_type must be "code".' };
  if (p.code_challenge_method !== 'S256') return { error: 'code_challenge_method must be "S256".' };
  if (typeof p.code_challenge !== 'string' || !CODE_CHALLENGE.test(p.code_challenge)) {
    return { error: 'code_challenge must be 43 base64url characters.' };
  }
  if (typeof p.state !== 'string' || !STATE.test(p.state)) return { error: 'Invalid state.' };
  const redirect = typeof p.redirect_uri === 'string' ? REDIRECT_URI.exec(p.redirect_uri) : null;
  if (!redirect) return { error: 'redirect_uri is not a Chrome extension redirect URL.' };
  const clientName = typeof p.client_name === 'string' ? p.client_name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
  if (clientName.length < 1 || clientName.length > 60) return { error: 'client_name must be 1-60 characters.' };
  return {
    redirectUri: redirect[0],
    state: p.state,
    codeChallenge: p.code_challenge,
    clientName,
    extensionId: redirect[1]!,
  };
}

function authorizeCsrf(sessionId: string, p: AuthorizeParams): string {
  return crypto.createHmac('sha256', sessionId)
    .update(`authorize|${p.redirectUri}|${p.state}|${p.codeChallenge}`)
    .digest('hex');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// design.md tokens, inlined: the CSP allows no external stylesheet or font.
const STYLES = `
:root {
  --bk-paper: #fbf7f3; --bk-paper-2: oklch(93% 0.012 40); --bk-rule: oklch(82% 0.008 40);
  --bk-neutral: oklch(56% 0.008 40); --bk-muted: oklch(40% 0.008 40); --bk-ink: #0e0f13;
  --bk-accent: #fd441d; --danger: #dc2626;
  --bk-font-display: 'Bricolage Grotesque', sans-serif;
  --bk-font-body: 'Geist', system-ui, sans-serif;
  --bk-font-mono: 'Menlo', 'Courier New', monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bk-paper: oklch(16% 0.008 40); --bk-paper-2: oklch(22% 0.010 40); --bk-rule: oklch(34% 0.008 40);
    --bk-neutral: oklch(68% 0.008 40); --bk-muted: oklch(82% 0.008 40); --bk-ink: oklch(94% 0.006 40);
    --danger: oklch(70% 0.17 25);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bk-paper); color: var(--bk-ink); font: 15px/1.6 var(--bk-font-body); -webkit-font-smoothing: antialiased; }
main { max-width: 28rem; margin: 0 auto; padding: 2.5rem 1rem; }
.brand { font: 800 1.125rem/1 var(--bk-font-display); padding-bottom: 0.75rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--bk-ink); }
h1 { font: 700 1.5rem/1.2 var(--bk-font-display); margin: 0 0 1rem; overflow-wrap: anywhere; }
p { margin: 0 0 1rem; }
.muted { color: var(--bk-muted); }
code { font: 0.8125rem/1.4 var(--bk-font-mono); background: var(--bk-paper-2); border: 1px solid var(--bk-rule); padding: 0.125rem 0.375rem; overflow-wrap: anywhere; }
.error { color: var(--danger); border-left: 2px solid var(--danger); padding-left: 0.75rem; }
label { display: block; font-weight: 600; font-size: 0.875rem; margin-bottom: 0.5rem; }
input[type=password] { width: 100%; padding: 0.625rem 0.75rem; font: inherit; color: var(--bk-ink); background: var(--bk-paper); border: 2px solid var(--bk-ink); border-radius: 0; }
.actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
button { font: 700 0.875rem/1 var(--bk-font-display); text-transform: uppercase; letter-spacing: 0.04em; padding: 0.75rem 1.25rem; color: var(--bk-ink); background: transparent; border: 2px solid var(--bk-ink); border-radius: 0; cursor: pointer; transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), background-color 100ms, border-color 100ms; }
button:hover { border-color: var(--bk-accent); }
button.primary { color: var(--bk-paper); background: var(--bk-ink); }
button.primary:hover { background: var(--bk-accent); border-color: var(--bk-accent); transform: translateY(-2px); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--bk-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } button.primary:hover { transform: none; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · bukmark</title>
<style>${STYLES}</style>
</head>
<body><main><div class="brand">bukmark</div>
${body}
</main></body>
</html>`;
}

function hiddenFields(p: AuthorizeParams): string {
  const fields: Record<string, string> = {
    response_type: 'code',
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    client_name: p.clientName,
  };
  return Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('\n');
}

const RETRY_HINT = '<p class="muted">Close this window and log in from the extension again.</p>';

const views = {
  invalid: (message: string) => page('Invalid request', `<h1>This sign-in request is invalid</h1>
<p class="error">${escapeHtml(message)}</p>
${RETRY_HINT}`),

  refused: () => page('Request refused', `<h1>Request refused</h1>
<p class="error">This request could not be verified.</p>
${RETRY_HINT}`),

  notSetUp: (origin: string) => page('Set up bukmark first', `<h1>No owner yet</h1>
<p>This bukmark server has no owner yet. Open <strong>${escapeHtml(origin)}</strong> in a normal tab to create your password, then log in from the extension again.</p>`),

  signedOut: (p: AuthorizeParams, error?: string) => page('Sign in', `<h1>Sign in to bukmark</h1>
<p><strong>${escapeHtml(p.clientName)}</strong> (extension <code>${p.extensionId}</code>) is asking to connect. Sign in to continue.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize">
${hiddenFields(p)}
<label for="password">Password</label>
<input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
<div class="actions">
<button class="primary" type="submit" name="action" value="login">Sign in</button>
<button type="submit" name="action" value="deny" formnovalidate>Cancel</button>
</div>
</form>`),

  signedIn: (p: AuthorizeParams, csrf: string) => page('Allow access', `<h1>${escapeHtml(p.clientName)} wants to save bookmarks to this server</h1>
<p>Extension ID <code>${p.extensionId}</code></p>
<p>It will be able to add and read your links and hubs.</p>
<form method="post" action="/authorize">
${hiddenFields(p)}
<input type="hidden" name="csrf" value="${csrf}">
<div class="actions">
<button class="primary" type="submit" name="action" value="allow">Allow</button>
<button type="submit" name="action" value="deny">Deny</button>
</div>
</form>`),
};

function html(reply: FastifyReply, status: number, body: string): FastifyReply {
  return reply.code(status).type('text/html; charset=utf-8').send(body);
}

function redirectBack(reply: FastifyReply, p: AuthorizeParams, result: Record<string, string>): FastifyReply {
  const url = new URL(p.redirectUri);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  url.searchParams.set('state', p.state);
  return reply.redirect(url.toString(), 303);
}

async function hasOwner(req: FastifyRequest): Promise<boolean> {
  return (await req.server.db.select({ id: owner.id }).from(owner).limit(1)).length > 0;
}

/** The session cookie value when it names a live session: the csrf key. */
async function liveSession(req: FastifyRequest): Promise<string | null> {
  const value = req.cookies[SESSION_COOKIE];
  return value && (await resolveSession(req.server.db, value)) ? value : null;
}

function serverOrigin(req: FastifyRequest): string {
  return `${req.protocol}://${req.host}`;
}

// Not wrapped in fastify-plugin: the form parser, error page and headers stay
// scoped to /authorize. Chrome's auth window aborts on any response >= 400,
// so states the owner can recover from (wrong password, lapsed session)
// re-render with 200.
export async function authorizePage(app: FastifyInstance): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.addHook('onRequest', async (_req, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'authorize failed');
    else req.log.info({ err }, 'authorize request rejected');
    return html(reply, status, views.invalid('The request could not be processed.'));
  });

  app.get('/authorize', async (req, reply) => {
    const params = parseAuthorizeParams(req.query);
    if ('error' in params) return html(reply, 400, views.invalid(params.error));
    if (!(await hasOwner(req))) return html(reply, 200, views.notSetUp(serverOrigin(req)));

    const session = await liveSession(req);
    return html(reply, 200, session ? views.signedIn(params, authorizeCsrf(session, params)) : views.signedOut(params));
  });

  app.post('/authorize', async (req, reply) => {
    if (!checkOrigin(req)) return html(reply, 403, views.refused());
    const params = parseAuthorizeParams(req.body);
    if ('error' in params) return html(reply, 400, views.invalid(params.error));
    const { action, password, csrf } = req.body as Record<string, unknown>;

    if (action === 'deny') {
      await deleteStaleAuthCodes(req.server.db);
      return redirectBack(reply, params, { error: 'access_denied' });
    }

    if (action === 'login') {
      const result = await attemptLogin(req, reply, password);
      if (result.ok) return html(reply, 200, views.signedIn(params, authorizeCsrf(result.sessionId, params)));
      switch (result.reason) {
        case 'setup_required':
          return html(reply, 200, views.notSetUp(serverOrigin(req)));
        case 'rate_limited': {
          const minutes = Math.ceil(result.retryAfter / 60);
          reply.header('retry-after', result.retryAfter);
          return html(reply, 429, views.signedOut(params, `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`));
        }
        case 'bad_password':
          return html(reply, 200, views.signedOut(params, 'Wrong password.'));
      }
    }

    if (action === 'allow') {
      const session = await liveSession(req);
      if (!session) return html(reply, 200, views.signedOut(params, 'Your session ended. Sign in again.'));
      if (typeof csrf !== 'string' || !safeEqualString(csrf, authorizeCsrf(session, params))) {
        return html(reply, 403, views.refused());
      }

      await deleteStaleAuthCodes(req.server.db);
      const code = randomToken(32);
      await req.server.db.insert(authCodes).values({
        codeHash: sha256hex(code),
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        clientName: params.clientName,
        expiresAt: dsql`now() + interval '2 minutes'`,
      });
      return redirectBack(reply, params, { code });
    }

    return html(reply, 400, views.invalid('Unknown action.'));
  });
}
