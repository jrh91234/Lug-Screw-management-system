# Custom report logo

To use your own logo in dashboard PDF export, place your file here as:

- `company-logo.jpg`

The export will load this file first (`../assets/company-logo.jpg`).

If not found and running on GitHub Pages, it will also try:
- `https://raw.githubusercontent.com/<owner>/<repo>/main/src/company-logo.jpg`
- `https://raw.githubusercontent.com/<owner>/<repo>/master/src/company-logo.jpg`

Then fallback to `logo-jr.svg` when still not found.

> Note: On GitHub Pages (served from `/docs`), files under repository root `src/` are not publicly served.
