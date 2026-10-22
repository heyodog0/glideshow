<img src="editor/glideshow.svg" width="72" alt="">

# Glideshow <sup>alpha</sup>

Slides you own. A Google Slides–style editor whose decks are plain HTML folders you keep, that AI agents can read and
edit alongside you.

A deck is `deck.html` plus `assets/`: each slide a `<section>`, everything on it a positioned box on a 1920 × 1080
canvas. The editor reads and writes that file, an agent can edit it directly (the editor follows live), and the folder
presents in any browser. Every save is a version in git.

## Install

Needs Python 3.10+ and Chrome; macOS, Linux and Windows.

```console
$ uv tool install git+https://github.com/heyodog0/glideshow
$ glideshow                        # the home screen: your decks (in ~/decks)
$ glideshow new "Lab meeting"      # a new deck, opened in the editor
$ glideshow build lab-meeting out/ # a copy that presents offline
```

Or use it online, with nothing to install, at [glideshow.org](https://glideshow.org).

## Docs

- [Deck format](docs/deck-format.md): `deck.html`, attribute by attribute.
- [For agents](docs/agents.md): layout and recipes; every deck gets a copy as `AGENTS.md`. The Claude Code skill is in
  `skills/glideshow`.
- [Keyboard shortcuts](docs/shortcuts.md)
- [Running it online](docs/self-hosting.md): your own glideshow.org on Cloudflare.

## Contributing

Issues and pull requests are welcome. Before sending one, run `tools/check.sh` (types and lint) and `uv run test/smoke.py`
(the editor end to end, in Chrome).

## Releasing

Work lands on `main` (small changes directly, bigger ones through a short branch and a pull request). Every push to
`main` that passes the checks goes to [dev.glideshow.org](https://dev.glideshow.org), the nightly channel
(`uv tool install git+https://github.com/heyodog0/glideshow@main` for the command). A release is a version tag:

```console
$ # bump `version` in pyproject.toml, commit it, then:
$ git tag v0.2.0 && git push origin main v0.2.0
```

The tag runs the checks and the browser tests, deploys [glideshow.org](https://glideshow.org) and publishes a GitHub
Release with notes and the package (`0.x` versions are marked pre-release). The deploys need the repo secret
`CLOUDFLARE_API_TOKEN` (a Cloudflare token from the "Edit Cloudflare Workers" template) and the variable
`CLOUDFLARE_ACCOUNT_ID`.

## License

[AGPL-3.0](LICENSE). Use it, change it and share it; if you run a changed version as a service, publish your changes.
