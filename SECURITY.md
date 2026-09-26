# Security policy

Pyro processes untrusted content and may sit in front of privileged AI agents. Security reports are taken seriously.

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** button in the repository Security tab to submit a private advisory with reproduction steps, affected versions, and potential impact.

During beta, fixes target the newest published beta release. The `main` branch is development code. See [releases and support](docs/releases.md). Maintainers will acknowledge a complete report as soon as practical and coordinate disclosure after a fix is available.

Before exposing Pyro outside localhost, use unique credentials, terminate TLS at a hardened ingress, restrict the management interface, and configure PostgreSQL backups.

See [deployment and data flow](docs/deployment.md) for TypeSafe egress, raw-input retention, encryption, roles, and operational limits. Pyro has not undergone an independent security audit.
