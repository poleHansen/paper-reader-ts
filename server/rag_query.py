import argparse
import json
from pathlib import Path

from rag_utils import (
    EmbeddingBackend,
    ensure_faiss,
    ensure_numpy,
    find_existing_rag_files,
    load_chunks,
    resolve_device,
    read_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-dir', required=True)
    parser.add_argument('--question', required=True)
    parser.add_argument('--top-k', type=int, default=8)
    parser.add_argument('--model-name', default='BAAI/bge-m3')
    parser.add_argument('--model-path', default='')
    parser.add_argument('--device', default='cuda')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir).resolve()
    if not artifact_dir.exists():
        raise FileNotFoundError(f'artifactDir not found: {artifact_dir.as_posix()}')

    rag_files = find_existing_rag_files(artifact_dir)
    if not rag_files['index'].exists() or not rag_files['chunks'].exists():
        raise FileNotFoundError(f'RAG index files are missing under {rag_files["ragDir"].as_posix()}')

    build_info = read_json(rag_files['buildInfo']) if rag_files['buildInfo'].exists() else {}
    model_name = str(build_info.get('modelName') or args.model_name)
    model_path = str(build_info.get('modelPath') or args.model_path or model_name)
    device = resolve_device(str(build_info.get('device') or args.device))

    backend = EmbeddingBackend(model_name, model_path, device)
    query_vector = backend.encode([args.question], batch_size=1)

    np = ensure_numpy()
    faiss = ensure_faiss()
    query_array = np.asarray(query_vector, dtype='float32')
    faiss.normalize_L2(query_array)

    index = faiss.read_index(rag_files['index'].as_posix())
    scores, indices = index.search(query_array, max(1, args.top_k))
    chunks = load_chunks(rag_files['chunks'])

    hits = []
    for score, chunk_index in zip(scores[0].tolist(), indices[0].tolist()):
        if chunk_index < 0 or chunk_index >= len(chunks):
            continue
        chunk = chunks[chunk_index]
        hits.append({
            'id': chunk.get('id'),
            'text': chunk.get('text'),
            'page': chunk.get('page'),
            'pageStart': chunk.get('pageStart'),
            'pageEnd': chunk.get('pageEnd'),
            'pages': chunk.get('pages'),
            'sectionPath': chunk.get('sectionPath'),
            'bbox': chunk.get('bbox') or [],
            'blockTypes': chunk.get('blockTypes') or [],
            'score': float(score),
        })

    print(
        json.dumps(
            {
                'ok': True,
                'artifactDir': artifact_dir.as_posix(),
                'ragDir': rag_files['ragDir'].as_posix(),
                'chunks': hits,
                'model': model_name,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
