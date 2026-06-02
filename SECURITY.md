# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest `main` | yes |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Use [GitHub Security Advisories](https://github.com/mira-dev-tech/mira-cameras/security/advisories/new) to report privately.

Include:

- Description of the issue and impact
- Steps to reproduce
- Affected versions or commits
- Suggested fix (if any)

We aim to acknowledge reports within a reasonable timeframe.

## Scope

In scope:

- Authentication/session handling in this application
- Server-side proxy path traversal or header injection
- Exposure of upstream session cookies to clients

Out of scope:

- Vulnerabilities in Tuya's upstream IPC Terminal platform
- Compromise of a user's SmartLife/Tuya mobile account via phishing
- Misconfiguration of your own deployment (exposed `.data` volume, missing TLS)

## Safe deployment checklist

- Run behind HTTPS in production
- Restrict network access to admin endpoints if exposed publicly
- Mount `MIRA_CAMERAS_DATA` on a protected volume
- Never commit `sessions.json` or `.env` files
- Rotate sessions by logging out users after incidents
