# 1Stop Pdf

An on-device document editor (PWA) with OCR, translation, signatures and format-preserving export.

## Features

- **Open & render** — PDF, images (JPG/PNG/WebP/BMP), Word `.docx`; camera scan on mobile
- **OCR (offline)** — Tesseract.js, 20+ languages including all 11 South African official languages
- **Edit OCR text in place** — recognised lines become editable boxes at their original position
- **Text + signatures** — add/drag text; draw / type / upload signatures, drag to move & resize
- **Translate** — 50+ languages; Lingva→MyMemory providers
- **Format-preserving export** — PDF→PDF, image→same type, DOCX→DOCX, or searchable PDF
- **Dashboard** — on-device usage stats in `localStorage`
- **PWA** — installs on desktop and mobile, works offline

## Running Locally

```bash
cd 1StopPdf
python3 -m http.server 8080
# Open http://localhost:8080
```

Or just double-click `index.html` — most features work from `file://` except the service worker.

## Privacy

All document processing is on-device. Only translation makes network requests (to free public APIs).
