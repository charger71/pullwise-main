# Help screenshots and walk-through videos

The admin's **Help** screen (`admin/sections/help.js`) shows a guide for every screen. The words are in
`admin/help/articles/`; the screenshots and captioned videos are made by this tool, from the demo shop, and saved in
`admin/help/media/`. Re-run it whenever a screen changes, and commit what it writes.

## Run it (on your Mac)

One time per computer:

```bash
npm i --no-save playwright
npx playwright install chromium ffmpeg
brew install ffmpeg          # converts the recordings to MP4
```

No Homebrew? Use the npm copy of ffmpeg instead, and point the capture at it:

```bash
npm i --no-save playwright ffmpeg-static   # both at once: --no-save removes any package not named
export HELP_FFMPEG="$(node -p "require('ffmpeg-static')")"
```

Then, from the repo:

```bash
HELP_EMAIL=you@example.com HELP_PASSWORD='…' npm run help:capture
```

Use an **owner** login on the demo shop (demo.pullwise.shop), so every screen shows. It takes a few minutes and prints
each file as it's made. Then check a few pictures, play a video or two, run `npm test` and commit
`admin/help/media/`.

| Option | Does |
| --- | --- |
| `--only=dashboard,place-order` | Re-record just these walk-throughs (names in `walkthroughs.mjs`) |
| `--shots-only` | Screenshots only, no videos |
| `--headed` | Show the browser while it works (handy when a step fails) |
| `--url=https://…` | Another shop. Anything but the demo shop or localhost also needs `--not-demo`, because pictures of a real shop show real customers |

## What it makes

For each walk-through in `walkthroughs.mjs`: its screenshots (`name.png`, 1280×800) and, if it has `video: true`,
`id.mp4` (H.264, no sound), `id.jpg` (the poster) and `id.vtt` (the captions, for screen readers and the player's CC
button). Then it rewrites `admin/help/media/captured.js`, the list the Help screen uses to show only media that
exists. `npm test` checks that the list matches the folder.

## It only reads

The tool signs in and clicks through the admin like a person would, but every request that could change data is
stopped in the browser before it is sent: only reads, the sign-in, the read-only database functions in `READ_RPCS`
(`capture.mjs`) and email **previews** get through. Anything stopped is listed at the end of the run. Walk-throughs
never click Save, Send, Delete, Approve or Mark…, and `admin/help/help.test.js` fails if one tries.

## Changing a walk-through or a guide

- **A step fails** ("step 4 … Timeout"): the screen changed. Run with `--only=<id> --headed`, fix the selector in
  `walkthroughs.mjs`, run again. A step that may not exist on every shop (a tab that can be switched off) can be
  marked `optional: true`.
- **New picture in a guide:** add `![What it shows](name)` to the article and a step with `shot: 'name'` to a
  walk-through, then capture it. `npm test` fails if an article uses a picture no walk-through makes.
- **New screen in the admin:** add it to a topic's `screens` in `admin/help/topics.js` (or a new topic and article).
  `npm test` fails until every screen has a guide, so its How this works can link there.
- **Captions** are the `say:` lines. Keep them to one short sentence: they stay up about a third of a second per word.
