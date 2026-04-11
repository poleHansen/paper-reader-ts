import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def emit_status(status: str, detail: str) -> None:
    print(f"TASK_STATUS|{status}|{detail}", flush=True)


def read_json(file_path: Path) -> Any:
    with file_path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def get_content_list_path(artifact_dir: Path) -> Path:
    for file_path in sorted(artifact_dir.glob('*_content_list_v2.json')):
        return file_path
    for file_path in sorted(artifact_dir.glob('*_content_list.json')):
        return file_path
    raise FileNotFoundError(f'No content_list file found under {artifact_dir.as_posix()}')


def get_base_name(artifact_dir: Path) -> str:
    content_list_path = get_content_list_path(artifact_dir)
    return content_list_path.name.replace('_content_list_v2.json', '').replace('_content_list.json', '')


def text_from_items(items: Any) -> str:
    if not isinstance(items, list):
        return ''
    parts: list[str] = []
    for item in items:
        if isinstance(item, dict):
            content = item.get('content')
            if isinstance(content, str):
                parts.append(content)
    return ' '.join(' '.join(parts).split())


def normalize_text(value: Any) -> str:
    if isinstance(value, str):
        return ' '.join(value.split())
    if isinstance(value, list):
        return ' '.join(text_from_items(value))
    return ''


def to_text(value: Any) -> str:
    if isinstance(value, str):
        return ' '.join(value.split())
    if isinstance(value, list):
        return ' '.join(text_from_items(value))
    return ''


def _items_to_text(items: Any) -> str:
    if not isinstance(items, list):
        return ''
    parts: list[str] = []
    for item in items:
        if isinstance(item, dict):
            content = item.get('content')
            if isinstance(content, str):
                parts.append(content)
    return ' '.join(parts)


def collect_block_text(block: dict[str, Any]) -> str:
    block_type = block.get('type')
    content = block.get('content') or {}
    if block_type == 'title':
        return _items_to_text(content.get('title_content'))
    if block_type == 'paragraph':
        return _items_to_text(content.get('paragraph_content'))
    if block_type == 'image':
        return _items_to_text(content.get('image_caption'))
    if block_type == 'table':
        table_caption = _items_to_text(content.get('table_caption'))
        table_body = _items_to_text(content.get('table_body'))
        return ' '.join(part for part in [table_caption, table_body] if part)
    return ''


def resolve_model_path(model_path: str, model_name: str) -> str:
    candidate = (model_path or model_name or '').strip()
    if not candidate:
        return model_name

    path_candidate = Path(candidate)
    if not path_candidate.exists():
        return candidate

    if path_candidate.is_file():
        return str(path_candidate)

    config_path = path_candidate / 'config.json'
    if config_path.exists():
        return str(path_candidate)

    snapshots_dir = path_candidate / 'snapshots'
    if snapshots_dir.exists() and snapshots_dir.is_dir():
        snapshot_dirs = sorted(
            [child for child in snapshots_dir.iterdir() if child.is_dir()],
            key=lambda child: child.stat().st_mtime,
            reverse=True,
        )
        for snapshot_dir in snapshot_dirs:
            if (snapshot_dir / 'config.json').exists():
                return str(snapshot_dir)

    refs_dir = path_candidate / 'refs'
    main_ref = refs_dir / 'main'
    if main_ref.exists() and snapshots_dir.exists():
        snapshot_name = main_ref.read_text(encoding='utf-8').strip()
        snapshot_dir = snapshots_dir / snapshot_name
        if (snapshot_dir / 'config.json').exists():
            return str(snapshot_dir)

    return str(path_candidate)


def chunk_pages(pages: list[Any], chunk_size: int = 1200, chunk_overlap: int = 150) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    section_stack: list[str] = []
    buffer_parts: list[str] = []
    buffer_pages: list[int] = []
    buffer_bboxes: list[list[float]] = []
    buffer_block_types: list[str] = []

    def flush_buffer() -> None:
        nonlocal buffer_parts, buffer_pages, buffer_bboxes, buffer_block_types
        text = ' '.join(part.strip() for part in buffer_parts if part and part.strip())
        text = ' '.join(text.split())
        if not text:
            buffer_parts = []
            buffer_pages = []
            buffer_bboxes = []
            buffer_block_types = []
            return

        chunk_id = f"chunk-{len(chunks) + 1:05d}"
        unique_pages = sorted(set(buffer_pages))
        chunks.append({
            'id': chunk_id,
            'text': text,
            'page': unique_pages[0],
            'pageStart': unique_pages[0],
            'pageEnd': unique_pages[-1],
            'pages': unique_pages,
            'sectionPath': ' > '.join(section_stack),
            'blockTypes': sorted(set(buffer_block_types)),
            'bbox': buffer_bboxes[0] if buffer_bboxes else [],
        })

        if chunk_overlap > 0 and text:
            overlap_text = text[-chunk_overlap:]
            buffer_parts = [overlap_text]
            buffer_pages = [unique_pages[-1]]
            buffer_bboxes = [buffer_bboxes[-1]] if buffer_bboxes else []
            buffer_block_types = [buffer_block_types[-1]] if buffer_block_types else []
        else:
            buffer_parts = []
            buffer_pages = []
            buffer_bboxes = []
            buffer_block_types = []

    for page_index, page in enumerate(pages, start=1):
        if not isinstance(page, list):
            continue

        for block in page:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get('type') or '')
            content = block.get('content') or {}
            bbox = block.get('bbox') if isinstance(block.get('bbox'), list) else []

            if block_type == 'title':
                flush_buffer()
                level = int(content.get('level') or 1)
                title_text = collect_block_text(block)
                if title_text:
                    section_stack[:] = section_stack[:max(level - 1, 0)]
                    section_stack.append(title_text)
                    buffer_parts.append(title_text)
                    buffer_pages.append(page_index)
                    buffer_bboxes.append(bbox)
                    buffer_block_types.append('title')
                continue

            block_text = collect_block_text(block)
            if not block_text:
                continue

            candidate_parts = [*buffer_parts, block_text]
            candidate_text = ' '.join(part.strip() for part in candidate_parts if part and part.strip())
            candidate_text = ' '.join(candidate_text.split())
            if buffer_parts and len(candidate_text) > chunk_size:
                flush_buffer()

            buffer_parts.append(block_text)
            buffer_pages.append(page_index)
            buffer_bboxes.append(bbox)
            buffer_block_types.append(block_type or 'unknown')

    flush_buffer()
    return chunks


class EmbeddingBackend:
    def __init__(self, model_name: str, model_path: str, device: str) -> None:
        self.model_name = model_name
        self.model_path = resolve_model_path(model_path, model_name)
        self.device = device
        self.kind = ''
        self.model = None

    def load(self) -> None:
        last_error: Exception | None = None
        try:
            from FlagEmbedding import BGEM3FlagModel

            self.model = BGEM3FlagModel(self.model_path, use_fp16=self.device != 'cpu', device=self.device)
            self.kind = 'flagembedding'
            return
        except Exception as exc:
            last_error = exc

        try:
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(self.model_path, device=self.device)
            self.kind = 'sentence-transformers'
            return
        except Exception as exc:
            last_error = exc

        raise RuntimeError(
            'Failed to load embedding backend. Install FlagEmbedding or sentence-transformers '
            f'for model {self.model_path}. Last error: {last_error}'
        )

    def encode(self, texts: Iterable[str], batch_size: int = 4):
        if self.model is None:
            self.load()

        text_list = list(texts)
        if self.kind == 'flagembedding':
            encoded = self.model.encode(text_list, batch_size=batch_size, max_length=8192)
            dense_vecs = encoded.get('dense_vecs') if isinstance(encoded, dict) else encoded
            return dense_vecs

        encoded = self.model.encode(
            text_list,
            batch_size=batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return encoded


def ensure_faiss():
    try:
        import faiss
    except Exception as exc:
        raise RuntimeError(f'faiss is required for local vector index: {exc}') from exc
    return faiss


def ensure_numpy():
    try:
        import numpy as np
    except Exception as exc:
        raise RuntimeError(f'numpy is required for local vector index: {exc}') from exc
    return np


def build_index(vectors):
    np = ensure_numpy()
    faiss = ensure_faiss()
    array = np.asarray(vectors, dtype='float32')
    faiss.normalize_L2(array)
    index = faiss.IndexFlatIP(array.shape[1])
    index.add(array)
    return index, array


def load_chunks(chunks_path: Path) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    with chunks_path.open('r', encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line:
                chunks.append(json.loads(line))
    return chunks


def write_json(file_path: Path, payload: Any) -> None:
    with file_path.open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def write_jsonl(file_path: Path, rows: list[dict[str, Any]]) -> None:
    with file_path.open('w', encoding='utf-8') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')


def resolve_device(device: str) -> str:
    requested = (device or '').strip().lower() or 'cuda'
    if requested == 'cpu':
        return 'cpu'

    try:
        import torch

        return 'cuda' if torch.cuda.is_available() and requested != 'cpu' else 'cpu'
    except Exception:
        return 'cpu'


def ensure_rag_dir(artifact_dir: Path) -> Path:
    rag_dir = artifact_dir / 'rag'
    rag_dir.mkdir(parents=True, exist_ok=True)
    return rag_dir


def build_info_payload(*, artifact_dir: Path, rag_dir: Path, model_name: str, model_path: str, device: str, chunk_size: int, chunk_overlap: int, chunk_count: int, embedding_dimension: int) -> dict[str, Any]:
    return {
        'artifactDir': artifact_dir.as_posix(),
        'ragDir': rag_dir.as_posix(),
        'builtAt': datetime.now(timezone.utc).isoformat(),
        'modelName': model_name,
        'modelPath': model_path,
        'device': device,
        'chunkSize': chunk_size,
        'chunkOverlap': chunk_overlap,
        'chunkCount': chunk_count,
        'embeddingDimension': embedding_dimension,
    }


def find_existing_rag_files(artifact_dir: Path) -> dict[str, Path]:
    rag_dir = artifact_dir / 'rag'
    return {
        'ragDir': rag_dir,
        'chunks': rag_dir / 'chunks.jsonl',
        'metadata': rag_dir / 'metadata.json',
        'index': rag_dir / 'index.faiss',
        'buildInfo': rag_dir / 'build_info.json',
    }
