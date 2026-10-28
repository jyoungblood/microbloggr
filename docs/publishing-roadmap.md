# Publishing roadmap

Status: release work planned; repositories split October 28, 2026.

The package repository is [microbloggr](https://github.com/jyoungblood/microbloggr). The standalone [demo repository](https://github.com/jyoungblood/microbloggr-demo) installs a pinned package commit before npm publication. The package keeps an independent Astro test fixture. Demo hosting is still to be configured.

The first release will provide one npm package, an interactive setup command, and a public demo with integration examples.
The proposed release version is `0.1.0`. The package name, license, and demo host remain open decisions.

## 1. Finish the editor

- [ ] Complete the remaining UI tweaks.
- [ ] Bring back photo alternative text (and a way to mark decorative images) in the new photo grid. It was removed with the uploader redesign, and saves currently strip it.
- [ ] Get user sign-off after manual checks of the editor at desktop and mobile widths.
- [ ] Resolve failures from the existing automated checks.

Visual checks remain with the user. Package and demo preparation can proceed before final sign-off.

## 2. Add guided installation

Planned installation flow, using the current package name:

```sh
npx astro add microbloggr
npx microbloggr init
```

The `init` command does not exist yet. It will ship in the same npm package.
Astro handles package installation and integration registration. Our command handles content setup explicitly, without an npm `postinstall` script.

- [ ] Add the CLI entry point to the package.
- [ ] Prompt for the content directory with the current default preselected.
- [ ] Copy the editable schema and create the content directory.
- [ ] Add the `microblog` collection while preserving existing collections and configuration.
- [ ] Keep the collection loader and integration content paths consistent.
- [ ] Offer optional sample posts and media.
- [ ] Print the editor URL and integration guide link.
- [ ] Support explicit flags and `--yes` for agents and unattended use.
- [ ] Make repeated runs safe without duplicate entries or overwritten customizations.
- [ ] For unsupported configuration formats or conflicts, provide exact manual steps without destructive changes.
- [ ] Document the complete manual installation path.
- [ ] Check fresh projects, existing collections, custom paths, repeated runs, and unattended use.

## 3. Publish the playground as a reference demo

The playground already has a public feed and post pages that exclude drafts.
The hosted demo will show the public site. The editor remains local-only and available through a local checkout.

- [ ] Curate reproducible sample content for all five post types, including photo galleries and provider media.
- [ ] Add a “How this works” guide with schema and collection setup examples.
- [ ] Explain collection queries, date sorting, post rendering, and draft filtering on feeds and individual post routes.
- [ ] Explain draft filtering for any future RSS, search, or sitemap output.
- [ ] Link each example to its source files in the public repository.
- [ ] Provide a fetchable Markdown guide for agents from the same documentation source.
- [ ] Document how to run the example locally and adapt its components to another app.
- [ ] Explain that editor publication writes local files and site deployment remains a separate step.
- [ ] Document that files in `public` remain public, including attachments for drafts.
- [ ] Configure demo deployment from the same example code used by automated checks.
- [ ] Check production output for draft exclusion and absent editor routes, APIs, and UI assets.
- [ ] Get user sign-off on the public demo and guide.

## 4. Prepare the npm release

- [ ] Choose the npm name and owner after an availability check.
- [ ] Choose a license and first release version.
- [ ] Choose the public repository, demo host, and demo URL.
- [ ] Define supported Astro and Node versions from checks of installed packages.
- [ ] Add a package README, license, repository links, issue tracker, and Node requirements.
- [ ] Include the CLI, schema templates, and required runtime files in the package.
- [ ] Inspect `npm pack` output for missing files and accidental development content.
- [ ] Install the tarball into a fresh Astro project outside the workspace.
- [ ] Check the CLI, editor, content setup, public rendering, and production build from that installation.
- [ ] Run `npm test`, `npm run check`, `npm run test:integration`, and `npm run build`.
- [ ] Prepare release notes and npm account access with 2FA.

The current package targets Astro `^7.4.0` and Node `>=22.22.0`. Broader compatibility needs separate checks.

## 5. Release

- [ ] Publish the approved package version to npm.
- [ ] Check `astro add` and `microbloggr init` with the published package in a fresh project.
- [ ] Deploy the public demo and integration guide.
- [ ] Check package, source, demo, and documentation links.
- [ ] Publish the matching repository tag and release notes.

Later work: automate releases, expand version compatibility, and document schema changes between releases.

## References

- [Implementation progress](progress.md)
- [Product specification](product-spec.md)
- [Astro integration installation](https://docs.astro.build/en/reference/integrations-reference/#allow-installation-with-astro-add)
- [npm publication](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
