# Releases and support

Pyro is beta software maintained by [Delvisor Labs](https://github.com/DelvisorLabs).
Report reproducible issues in [GitHub Issues](https://github.com/DelvisorLabs/Pyro/issues)
and private vulnerabilities through [GitHub Security](https://github.com/DelvisorLabs/Pyro/security/advisories/new).
Contact [hello@delvisor.com](mailto:hello@delvisor.com) for a supervised pilot.
There is no paid support SLA or independently verified detection guarantee.

## Preparing a release

`pnpm check`, the PostgreSQL tests, the local evaluation budget, and the packed
CLI installation smoke test must pass. Set a new root version and app versions,
update `CHANGELOG.md`, and merge the reviewed changes. Run **Prepare release** on
`main` with publication disabled first. It builds all three containers and
uploads installation artifacts without publishing them.

When ready, run it with `publish_images` enabled. It publishes amd64/arm64 images
with build provenance and SBOMs, generates a compose file pinned to the returned
image digests, and creates a **draft** GitHub release with a CLI archive and
checksums. It refuses an existing release tag. Configure the GitHub `release`
environment with the appropriate maintainers/reviewers. Check GHCR package
visibility is public and test an anonymous pull before publishing the draft.
Do not point website installation links at an unpublished release.

For local artifact inspection after a build:

```sh
pnpm release:prepare
# Image names in this local output are placeholders until the images exist.
```

The published archive contains compose.yaml, .env.example, profiles, CLI .tgz,
license notices, deployment notes, release metadata and SHA256SUMS. Extract it in
an empty directory and run `sha256sum -c SHA256SUMS` (or `shasum -a 256 -c
SHA256SUMS` on macOS) before configuring credentials. Digest-pinned images require
no repository checkout or local application build.

## Publishing the CLI

Configure the npm package's trusted publisher for `DelvisorLabs/Pyro`, workflow
`publish-cli.yml`, environment `npm-release`, and configure that GitHub environment.
The **Publish CLI** workflow runs only on main, verifies the build and packed
installation, then uses pnpm with OIDC provenance. No long-lived npm token is
stored in the repository. Ensure the CLI version is new before running it.
See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/)
and [pnpm publishing reference](https://pnpm.io/cli/publish).

A prepared PR, container build, or local package archive is not a published
release. Confirm the npm page, GitHub release and anonymous container pulls after
publication, then update website links and the compatibility notes together.

## Support policy

CLI 0.2+ supports standalone classification with no Docker or server. CLI 0.1
was a server client. Publish the tested 0.2 archive before deploying the new
standalone-first website instructions; verify a fresh install runs both local
allow/block examples without a server.

During beta, fixes target the newest published beta. main is development code,
not a release channel. Pin the CLI version, server image digest, PostgreSQL major
version and policy revision in deployments. Keep the previous release archive
and a tested backup before upgrades. Breaking changes are called out in the
changelog; no long-term support window is promised yet.
