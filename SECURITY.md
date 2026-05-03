# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for a security vulnerability.

Instead, report it privately via GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/Ninso112/MindForge/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the impact, and steps to reproduce.

You can expect an initial response within a week. We will work with you on a fix and coordinate the disclosure timing.

## Supported versions

MindForge is in early development. Only the latest `0.x` release receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Scope

MindForge runs entirely in the browser and stores data in `localStorage`. There is no server, no authentication, and no network communication. The most relevant attack surface is the import path: a maliciously crafted `.mindforge` file should never be able to crash the app, hang the browser, or execute arbitrary code. Reports of such issues are very welcome.
