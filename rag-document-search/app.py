"""
AI Second Brain: Advanced RAG
A Streamlit app for semantic search (and optional AI-generated answers) over
your own PDFs and images, with OCR fallback for scanned/image-only pages.
"""

import hashlib
import io
import os
import pickle
from dataclasses import dataclass, field
from pathlib import Path

import faiss
import fitz  # PyMuPDF
import numpy as np
import pytesseract
import streamlit as st
from PIL import Image
from sentence_transformers import SentenceTransformer

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
APP_TITLE = "🧠 AI Second Brain: Advanced RAG"
SUPPORTED_TYPES = ["pdf", "png", "jpg", "jpeg", "txt"]
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
STORE_DIR = Path(".rag_store")
INDEX_PATH = STORE_DIR / "index.faiss"
META_PATH = STORE_DIR / "meta.pkl"
DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 150
DEFAULT_TOP_K = 4


@dataclass
class Chunk:
    text: str
    source: str
    page: int
    chunk_id: int


# --------------------------------------------------------------------------
# Cached resources
# --------------------------------------------------------------------------
@st.cache_resource(show_spinner="Loading embedding model...")
def load_model() -> SentenceTransformer:
    return SentenceTransformer(EMBED_MODEL_NAME)


# --------------------------------------------------------------------------
# Session state
# --------------------------------------------------------------------------
def init_state() -> None:
    st.session_state.setdefault("index", None)
    st.session_state.setdefault("chunks", [])
    st.session_state.setdefault("processed_files", {})  # name -> sha256
    st.session_state.setdefault("chunk_size", DEFAULT_CHUNK_SIZE)
    st.session_state.setdefault("chunk_overlap", DEFAULT_CHUNK_OVERLAP)
    st.session_state.setdefault("top_k", DEFAULT_TOP_K)
    st.session_state.setdefault("anthropic_key", os.environ.get("ANTHROPIC_API_KEY", ""))


def reset_index() -> None:
    st.session_state.index = None
    st.session_state.chunks = []
    st.session_state.processed_files = {}


# --------------------------------------------------------------------------
# Text extraction
# --------------------------------------------------------------------------
def ocr_image(img: Image.Image, lang: str = "eng") -> str:
    try:
        return pytesseract.image_to_string(img, lang=lang)
    except pytesseract.TesseractNotFoundError:
        st.error(
            "Tesseract OCR is not installed on this system. "
            "Install it (e.g. `apt-get install tesseract-ocr`) to enable OCR fallback."
        )
        return ""


def extract_text_from_pdf(file_bytes: bytes, ocr_lang: str = "eng") -> list[tuple[int, str]]:
    """Returns a list of (page_number, text) tuples. Falls back to OCR per-page
    when a page has no extractable text layer (e.g. scanned documents)."""
    pages: list[tuple[int, str]] = []
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    for page_num, page in enumerate(doc, start=1):
        page_text = page.get_text().strip()
        if not page_text:
            pix = page.get_pixmap(dpi=200)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            page_text = ocr_image(img, lang=ocr_lang).strip()
        if page_text:
            pages.append((page_num, page_text))
    doc.close()
    return pages


def extract_text_from_image(file_bytes: bytes, ocr_lang: str = "eng") -> str:
    img = Image.open(io.BytesIO(file_bytes))
    return ocr_image(img, lang=ocr_lang)


def extract_text(uploaded_file, ocr_lang: str = "eng") -> list[tuple[int, str]]:
    """Returns a list of (page_number, text). page_number is 1 for
    non-paginated sources (images, plain text)."""
    file_bytes = uploaded_file.getvalue()
    file_type = uploaded_file.type or ""

    if file_type == "application/pdf" or uploaded_file.name.lower().endswith(".pdf"):
        return extract_text_from_pdf(file_bytes, ocr_lang=ocr_lang)
    if "image" in file_type:
        text = extract_text_from_image(file_bytes, ocr_lang=ocr_lang)
        return [(1, text)] if text.strip() else []
    if file_type.startswith("text/") or uploaded_file.name.lower().endswith(".txt"):
        text = file_bytes.decode("utf-8", errors="ignore")
        return [(1, text)] if text.strip() else []

    st.warning(f"Unsupported file type for {uploaded_file.name}: {file_type}")
    return []


# --------------------------------------------------------------------------
# Chunking
# --------------------------------------------------------------------------
def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Word-based sliding-window chunking so chunks break on word boundaries
    instead of mid-word, with configurable overlap for context continuity."""
    words = text.split()
    if not words:
        return []

    step = max(chunk_size - overlap, 1)
    chunks = []
    for start in range(0, len(words), step):
        piece = " ".join(words[start : start + chunk_size])
        if piece.strip():
            chunks.append(piece)
        if start + chunk_size >= len(words):
            break
    return chunks


# --------------------------------------------------------------------------
# Vector store
# --------------------------------------------------------------------------
def file_hash(uploaded_file) -> str:
    return hashlib.sha256(uploaded_file.getvalue()).hexdigest()


def add_to_vector_store(
    model: SentenceTransformer,
    source_name: str,
    pages: list[tuple[int, str]],
    chunk_size: int,
    overlap: int,
) -> int:
    new_chunks: list[Chunk] = []
    for page_num, page_text in pages:
        for piece in chunk_text(page_text, chunk_size, overlap):
            new_chunks.append(
                Chunk(text=piece, source=source_name, page=page_num, chunk_id=len(st.session_state.chunks) + len(new_chunks))
            )

    if not new_chunks:
        return 0

    embeddings = model.encode(
        [c.text for c in new_chunks], convert_to_numpy=True, show_progress_bar=False
    ).astype("float32")
    faiss.normalize_L2(embeddings)  # enables cosine similarity via inner product

    if st.session_state.index is None:
        st.session_state.index = faiss.IndexFlatIP(embeddings.shape[1])

    st.session_state.index.add(embeddings)
    st.session_state.chunks.extend(new_chunks)
    return len(new_chunks)


def search(model: SentenceTransformer, query: str, top_k: int) -> list[tuple[Chunk, float]]:
    if st.session_state.index is None or st.session_state.index.ntotal == 0:
        return []
    query_vec = model.encode([query], convert_to_numpy=True).astype("float32")
    faiss.normalize_L2(query_vec)
    scores, indices = st.session_state.index.search(query_vec, min(top_k, st.session_state.index.ntotal))
    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue
        results.append((st.session_state.chunks[idx], float(score)))
    return results


def save_store() -> None:
    if st.session_state.index is None:
        st.warning("Nothing to save yet — index a document first.")
        return
    STORE_DIR.mkdir(exist_ok=True)
    faiss.write_index(st.session_state.index, str(INDEX_PATH))
    with open(META_PATH, "wb") as f:
        pickle.dump(
            {"chunks": st.session_state.chunks, "processed_files": st.session_state.processed_files}, f
        )
    st.success(f"Saved index to {STORE_DIR}/")


def load_store() -> None:
    if not INDEX_PATH.exists() or not META_PATH.exists():
        st.warning("No saved index found on disk.")
        return
    st.session_state.index = faiss.read_index(str(INDEX_PATH))
    with open(META_PATH, "rb") as f:
        meta = pickle.load(f)
    st.session_state.chunks = meta["chunks"]
    st.session_state.processed_files = meta["processed_files"]
    st.success("Loaded saved index from disk.")


# --------------------------------------------------------------------------
# Optional AI-generated answer (Anthropic)
# --------------------------------------------------------------------------
def generate_answer(api_key: str, query: str, context_chunks: list[tuple[Chunk, float]]) -> str:
    try:
        import anthropic
    except ImportError:
        return "Install the `anthropic` package to enable AI-generated answers (`pip install anthropic`)."

    context = "\n\n".join(
        f"[Source: {c.source}, page {c.page}]\n{c.text}" for c, _ in context_chunks
    )
    prompt = (
        "Answer the question using ONLY the context below. "
        "If the answer isn't in the context, say so explicitly. "
        "Cite sources inline like (source, page).\n\n"
        f"Context:\n{context}\n\nQuestion: {query}"
    )

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------
def main() -> None:
    st.set_page_config(page_title="AI Second Brain", page_icon="🧠", layout="wide")
    init_state()
    model = load_model()

    st.title(APP_TITLE)
    st.caption("Semantic search over your PDFs and images, with OCR fallback for scanned pages.")

    with st.sidebar:
        st.header("⚙️ Settings")
        ocr_lang = st.text_input("OCR language (Tesseract code)", value="eng")
        st.session_state.chunk_size = st.slider("Chunk size (words)", 100, 2000, st.session_state.chunk_size, 50)
        st.session_state.chunk_overlap = st.slider(
            "Chunk overlap (words)", 0, 500, st.session_state.chunk_overlap, 25
        )
        st.session_state.top_k = st.slider("Results to retrieve (k)", 1, 10, st.session_state.top_k)

        st.divider()
        st.subheader("💾 Persistence")
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Save index", use_container_width=True):
                save_store()
        with col2:
            if st.button("Load index", use_container_width=True):
                load_store()
        if st.button("🗑️ Clear index", use_container_width=True):
            reset_index()
            st.rerun()

        st.divider()
        st.subheader("🤖 AI Answers (optional)")
        st.session_state.anthropic_key = st.text_input(
            "Anthropic API key", value=st.session_state.anthropic_key, type="password"
        )

        st.divider()
        n_chunks = len(st.session_state.chunks)
        n_docs = len(st.session_state.processed_files)
        st.metric("Indexed documents", n_docs)
        st.metric("Indexed chunks", n_chunks)

    st.subheader("📄 Upload documents")
    uploaded_files = st.file_uploader(
        "Upload one or more PDFs, images, or text files",
        type=SUPPORTED_TYPES,
        accept_multiple_files=True,
    )

    if uploaded_files and st.button("Process & Index", type="primary"):
        progress = st.progress(0.0, text="Starting...")
        total_new_chunks = 0
        for i, uf in enumerate(uploaded_files, start=1):
            digest = file_hash(uf)
            if st.session_state.processed_files.get(uf.name) == digest:
                progress.progress(i / len(uploaded_files), text=f"Skipping already-indexed {uf.name}")
                continue

            progress.progress((i - 1) / len(uploaded_files), text=f"Extracting text from {uf.name}...")
            pages = extract_text(uf, ocr_lang=ocr_lang)

            if not pages:
                st.warning(f"No extractable text found in {uf.name}.")
                continue

            progress.progress((i - 0.5) / len(uploaded_files), text=f"Embedding {uf.name}...")
            added = add_to_vector_store(
                model, uf.name, pages, st.session_state.chunk_size, st.session_state.chunk_overlap
            )
            st.session_state.processed_files[uf.name] = digest
            total_new_chunks += added
            progress.progress(i / len(uploaded_files), text=f"Indexed {uf.name}")

        progress.empty()
        if total_new_chunks:
            st.success(f"Indexed {total_new_chunks} new chunks across {len(uploaded_files)} file(s).")
        else:
            st.info("No new content was indexed (files may already be indexed or empty).")

    if st.session_state.processed_files:
        with st.expander(f"📚 Indexed sources ({len(st.session_state.processed_files)})"):
            for name in st.session_state.processed_files:
                st.write(f"- {name}")

    st.divider()
    st.subheader("🔍 Ask a question")
    query = st.text_input("Ask a question about your documents:")
    want_ai_answer = st.checkbox("Generate AI answer from retrieved context", value=False)

    if query:
        if st.session_state.index is None or st.session_state.index.ntotal == 0:
            st.info("Upload and index a document first.")
        else:
            results = search(model, query, st.session_state.top_k)

            if want_ai_answer:
                if not st.session_state.anthropic_key:
                    st.warning("Add an Anthropic API key in the sidebar to generate AI answers.")
                else:
                    with st.spinner("Generating answer..."):
                        answer = generate_answer(st.session_state.anthropic_key, query, results)
                    st.markdown("### 💡 Answer")
                    st.write(answer)

            st.markdown("### 📎 Relevant excerpts")
            if not results:
                st.info("No relevant matches found.")
            for chunk, score in results:
                with st.container(border=True):
                    st.caption(f"**{chunk.source}** · page {chunk.page} · similarity {score:.2f}")
                    st.write(chunk.text)


if __name__ == "__main__":
    main()
