# 🧠 AI Second Brain: Advanced RAG

A Streamlit app for semantic search — and optional AI-generated answers — over
your own PDFs, images, and text files. Scanned/image-only PDF pages fall back
to OCR automatically.

## What's new vs. the original prototype

- **Multi-file upload** with duplicate-file detection (hash-based, won't re-index the same file twice)
- **Session-scoped state** instead of module-level globals (safe under Streamlit's rerun model and multiple users)
- **Per-page OCR fallback** — the original checked OCR against the whole document's accumulated text, which meant a blank first page silently OCR'd the entire rest of the PDF (or a non-blank first page suppressed OCR for later scanned pages). Now each page is checked independently.
- **Cosine similarity search** via a normalized `IndexFlatIP` index instead of raw L2 distance, which is a better fit for sentence-transformer embeddings
- **Word-boundary chunking with configurable overlap**, instead of fixed character slicing that could cut words in half
- **Chunk metadata** — every result shows its source filename, page number, and similarity score
- **Cached model loading** (`st.cache_resource`) so the embedding model isn't reloaded on every rerun
- **Persistence** — save/load the FAISS index and chunk metadata to disk so it survives app restarts
- **Optional AI-generated answers** — pass an Anthropic API key to synthesize a cited answer from the retrieved chunks, instead of only returning raw excerpts
- **Configurable settings** — chunk size/overlap, top-k, and OCR language, all adjustable from the sidebar
- **Plain text file support** in addition to PDF/PNG/JPG

## Setup

```bash
cd rag-document-search
pip install -r requirements.txt
```

Tesseract OCR must also be installed on your system:

```bash
# Debian/Ubuntu
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract
```

(`packages.txt` is included for Streamlit Community Cloud, which reads it to install apt packages automatically.)

## Run

```bash
streamlit run app.py
```

## Usage

1. Upload one or more PDFs, images, or `.txt` files.
2. Click **Process & Index**.
3. Ask a question in the search box. Adjust chunk size/overlap/top-k in the sidebar as needed.
4. Optionally check **Generate AI answer** and supply an Anthropic API key to get a synthesized, cited answer instead of raw excerpts.
5. Use **Save index** / **Load index** in the sidebar to persist your index across restarts.

## Notes

- Embeddings use `sentence-transformers/all-MiniLM-L6-v2` (384-dim, fast, runs on CPU).
- The AI-answer feature is fully optional — the app works purely as a retrieval tool without any API key.
