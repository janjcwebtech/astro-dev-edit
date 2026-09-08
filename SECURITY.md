# Security

`astro-dev-edit` runs only inside the Astro dev server, and it writes to files in your project. That makes it worth reporting anything that looks like a hole privately instead of filing it in public.

## Reporting

Do not open a public issue. Use the **Security** tab on this repository and choose **Report a vulnerability**, which opens a thread only you and I can see.

This is a one-person project, so give it a few days for a first reply. If a fix is needed it ships as a patch release, and you are credited in the changelog unless you would rather not be.

## Worth reporting

- A request from outside localhost reaching the `/__dev-edit` endpoints, or getting past the Origin check.
- A write landing outside the project root or the configured `contentRoots`, including through a symlink.
- Anything that registers the integration during `astro build` or `astro preview`.
- An Unsplash key, or anything else from the secret half of `.astro-dev-edit.json`, appearing in a response.
- A crafted page or content file that makes the patcher write source it cannot read back.

Editing a file you pointed the tool at is what the tool is for, so that on its own is not a vulnerability.

## Versions

Fixes go on the latest release. While the version still starts with `0.`, older lines are not patched.
