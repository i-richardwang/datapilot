# Local font binaries

The `@font-face` rules at the top of `apps/electron/src/renderer/index.css`
reference local font files in this directory. The binaries themselves are
**gitignored** because the current font in use is proprietary (Tsanger
TsangerJinKai02 — commercial CJK serif) and we don't want a public clone of
this repo to ship it.

To get the fonts on a fresh checkout (developer-only setup):

```bash
cp ~/Documents/work-projects/Kami/assets/fonts/TsangerJinKai02-W04.ttf \
   apps/electron/src/renderer/assets/fonts/
cp ~/Documents/work-projects/Kami/assets/fonts/TsangerJinKai02-W05.ttf \
   apps/electron/src/renderer/assets/fonts/
```

Without these files the CSS still parses; the `@font-face` declaration just
fails to resolve and the text falls back to the next entry in the stack
(Charter / Songti SC / etc — see `--font-serif` definition).

Once the fonts are replaced with licence-compatible alternatives, the
gitignore entry for `assets/fonts/*.ttf` (and `.woff`, `.woff2`) can be
dropped and the binaries committed.
