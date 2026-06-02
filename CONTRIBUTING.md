# Contributing to Mira Cameras

Thank you for your interest in improving Mira Cameras!

## Maintainer approval required

This project uses **maintainer-gated contributions**:

- **All changes merge through Pull Requests** — no direct commits to `main` from outside contributors
- **A maintainer must review and approve** every PR before it can be merged
- **CODEOWNERS** ([`.github/CODEOWNERS`](.github/CODEOWNERS)) automatically requests review from the core team

If you are not a maintainer, please do not force-push, self-merge, or bypass branch protection.

### Recommended GitHub settings (maintainers)

Enable in **Settings → Branches → Branch protection rules** for `main`:

- Require a pull request before merging
- Require approvals (minimum 1)
- Require review from Code Owners
- Do not allow bypassing the above settings

## How to contribute

1. **Search existing issues** — avoid duplicate work
2. **Open an issue** for significant features or architectural changes
3. **Fork** the repository
4. **Create a branch** from `main` (`feat/…`, `fix/…`, `docs/…`)
5. **Make focused changes** — one logical change per PR
6. **Test locally** — `go run .` and exercise login + wall UI
7. **Open a Pull Request** with a clear description and test notes
8. **Respond to review feedback** — maintainers may request changes

## What we will not merge

- Committed secrets, session files, `.env`, or production credentials
- Hard-coded private infrastructure (server IPs, internal hostnames, personal tokens)
- Large unrelated refactors bundled with feature work
- Changes that break the public demo without discussion

## Code style

- **Go:** standard `gofmt`, idiomatic error handling, minimal dependencies
- **JavaScript:** match existing patterns in `web/` (vanilla JS, Bootstrap 5)
- **Commits:** clear subject line; explain *why* in the body when helpful

## Local development

```bash
LISTEN_ADDR=":8787" go run .
```

Session data is written to `.data/` (gitignored). Never commit this directory.

## Questions

Open a [GitHub Discussion](https://github.com/mira-dev-tech/mira-cameras/discussions) or issue if you are unsure whether a change fits the project scope.
