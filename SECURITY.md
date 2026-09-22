# Security policy

Pyro processes untrusted content and may sit in front of privileged AI agents. Security reports are taken seriously.

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** button in the repository Security tab to submit a private advisory with reproduction steps, affected versions, and potential impact.

The project currently supports the latest release on the `main` branch. Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

Before exposing Pyro outside localhost, use unique credentials, terminate TLS at a hardened ingress, restrict the management interface, and configure PostgreSQL backups.
