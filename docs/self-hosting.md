# Running Glideshow online

`cloud/` is the editor as a website: a Cloudflare Worker that keeps each person's decks in a GitHub repo of theirs (or a
folder in their Google Drive), and serves shared links, comments and editing together. glideshow.org runs it; this is
how to run your own.

## What you need

- A Cloudflare account (the Workers free plan is enough to start; Durable Objects with SQLite storage are in it) and a
  domain on it.
- A GitHub account, for the GitHub App people sign in with and keep their decks through.
- Optionally, a Google OAuth client, for "Continue with Google" (viewers, and libraries in Google Drive).

## Set up

Edit `cloud/wrangler.toml` first: `routes` (your domain), `ALLOWED_USERS` and `ALLOWED_GOOGLE` (who may keep decks:
GitHub logins and Google accounts, or `*` for anyone) and `ADMINS` (who sees `/admin`). Then:

```console
$ uv run cloud/github-app.py         # makes the GitHub App (press Create on GitHub); keys go to ~/.glideshow/glideshow-app.json
$ cd cloud && npx wrangler deploy    # the Worker, its Durable Objects and your domain
$ cloud/setup.sh                     # the Worker's secrets: the app's id and keys, and a session key
```

Install the app on the repo that will hold your decks (`github.com/apps/<your app>/installations/new`), open your
domain, continue with GitHub and pick that repo.

**Continue with Google:** make an OAuth client (Google Cloud console → APIs & Services → Credentials → OAuth client
ID → Web application) with the redirect URI `https://<your domain>/auth/google/callback`, save
`{"client_id": …, "client_secret": …}` as `~/.glideshow/google-oauth.json` and run `cloud/setup.sh` again.

**Push webhook** (open editors hear a push at once, and stop checking every 8 s): in the GitHub App's settings, turn
the webhook on with the URL `https://<your domain>/github/webhook` and a secret, and subscribe to **Push** events. Give
the Worker the same secret: `cd cloud && npx wrangler secret put GITHUB_WEBHOOK_SECRET`.

**A staging copy:** `[env.dev]` in `wrangler.toml` is a second Worker on its own domain, with its own data, kept on a
test branch of a repo (`DEV_REPO`, `DEV_BRANCH`). Deploy it with `npx wrangler deploy --env dev`, give it its
secrets with `cloud/setup.sh dev`, and add `https://<its domain>/auth/github/callback` to the GitHub App's callback
URLs.

## Limits

Cloudflare's free plan allows 100,000 Durable Object requests a day for the whole account. Each library counts its
own: past `LIB_SLOW` its editors check for changes once a minute, past `LIB_PAUSE` its background traffic pauses until
00:00 UTC (saving, opening and viewing still work). `/admin` shows the day's count per library.

## Testing

```console
$ cd cloud && npx wrangler dev --port 8790 --local-upstream localhost:8790
$ uv run test/cloud.py
```

`cloud/.dev.vars` holds the local secrets: the app's, `SESSION_KEY`, `DEV_LOGIN=1` (sign in as anyone, local only),
`DEV_REPO`, `DEV_BRANCH` (a scratch branch the tests write to) and `GITHUB_WEBHOOK_SECRET` (any value). With
`--drive`, the tests run against a stand-in for the Drive API: `uv run test/fake_drive.py`.
