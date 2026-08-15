# Brand font — Lufga

The panel's design system specifies **Lufga**. It's a commercial typeface, so it isn't
bundled here. Until you supply it the panel falls back to Century Gothic, which ships with
Windows and is the closest geometric match.

To switch it on, drop these files into this folder:

```
Lufga-Regular.woff2
Lufga-Medium.woff2
Lufga-SemiBold.woff2
Lufga-Bold.woff2
```

Nothing else to do — the panel checks for `Lufga-Regular.woff2` on load and registers all
four weights automatically if it's there. If you only have some weights, the browser
synthesises the rest.

Have the font in another format (otf/ttf)? Convert to woff2 first — browsers accept ttf/otf,
but woff2 is roughly half the size, which matters when several operators load the panel
over a tunnel.

Only the control panel uses this font. The broadcast overlay uses Bahnschrift, which ships
with Windows, so the on-stream graphics never depend on a font being installed.
