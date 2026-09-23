# Zoom Out!

A hand-drawn, doodle-style web app that zooms out step by step:
**Bangkok → Thailand → Asia → Earth → Solar System → Milky Way → the observable Universe**.

It's plain HTML, CSS and a `<canvas>`. There's no build step and no dependencies.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Controls

- **Zoom out →** / **← Back** buttons, or click the drawing
- Arrow keys, space, or the mouse wheel
- **Auto tour** plays the whole trip on a loop
- Jump to any step with the tabs at the top

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` publishes the site on every push.
One-time setup: in the repo go to **Settings → Pages → Build and deployment → Source**
and choose **GitHub Actions**, then re-run the workflow (Actions tab → *Deploy to GitHub Pages* → *Run workflow*).
The site will be at `https://<owner>.github.io/<repo>/`.
