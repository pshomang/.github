# Deploying 1Stop Pdf

## Netlify Drop (easiest, 30 seconds)

1. Open https://app.netlify.com/drop
2. Drag the `1StopPdf` folder onto the page
3. You get an instant `https://...netlify.app` URL

## Vercel

```bash
npm i -g vercel
cd 1StopPdf
vercel --prod
```

Or drag-drop the folder at https://vercel.com/new

## GitHub Pages

1. Push this repo to GitHub
2. Go to Settings → Pages → Source: **GitHub Actions**
3. The workflow at `.github/workflows/deploy.yml` runs automatically on push to `main`

## Local server (for development)

```bash
python3 -m http.server 8080
```

> **Note:** The service worker (offline caching) requires HTTPS or `localhost`. It won't activate over a plain `file://` URL.
