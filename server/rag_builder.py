import argparse
import json
from pathlib import Path

from rag_utils import (
    EmbeddingBackend,
    build_index,
    build_info_payload,
    chunk_pages,
    emit_status,
    ensure_rag_dir,
    get_content_list_path,
    read_json,
    write_json,
    write_jsonl,
    ensure_faiss,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-dir', required=True)
    parser.add_argument('--model-name', default='BAAI/bge-m3')
    parser.add_argument('--model-path', default='')
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--chunk-size', type=int, default=1200)
    parser.add_argument('--chunk-overlap', type=int, default=150)
    parser.add_argument('--batch-size', type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir).resolve()
    if not artifact_dir.exists():
        raise FileNotFoundError(f'artifactDir not found: {artifact_dir.as_posix()}')

    content_list_path = get_content_list_path(artifact_dir)
    rag_dir = ensure_rag_dir(artifact_dir)
    chunks_path = rag_dir / 'chunks.jsonl'
    metadata_path = rag_dir / 'metadata.json'
    build_info_path = rag_dir / 'build_info.json'
    index_path = rag_dir / 'index.faiss'

    emit_status('writing-artifacts', f'正在读取 {content_list_path.name}')
    pages = read_json(content_list_path)
    if not isinstance(pages, list):
        raise RuntimeError('content_list file format is invalid: expected page array')

    emit_status('writing-artifacts', '正在按标题层级与段落聚合切块')
    chunks = chunk_pages(pages, chunk_size=args.chunk_size, chunk_overlap=args.chunk_overlap)
    if not chunks:
        raise RuntimeError('No chunks generated from content_list')

    backend = EmbeddingBackend(args.model_name, args.model_path, args.device)
    emit_status('parsing', f'正在加载 embedding 模型 {args.model_path or args.model_name}')
    vectors = backend.encode([chunk['text'] for chunk in chunks], batch_size=args.batch_size)

    emit_status('parsing', '正在构建 FAISS 索引')
    index, vector_array = build_index(vectors)
    faiss = ensure_faiss()
    faiss.write_index(index, index_path.as_posix())

    emit_status('writing-artifacts', '正在写入 chunk 元数据')
    write_jsonl(chunks_path, chunks)
    write_json(
        metadata_path,
        {
            'artifactDir': artifact_dir.as_posix(),
            'contentListPath': content_list_path.as_posix(),
            'chunkCount': len(chunks),
            'chunksPath': chunks_path.as_posix(),
            'indexPath': index_path.as_posix(),
        },
    )
    write_json(
        build_info_path,
        build_info_payload(
            artifact_dir=artifact_dir,
            rag_dir=rag_dir,
            model_name=args.model_name,
            model_path=args.model_path or args.model_name,
            device=args.device,
            chunk_size=args.chunk_size,
            chunk_overlap=args.chunk_overlap,
            chunk_count=len(chunks),
            embedding_dimension=int(vector_array.shape[1]),
        ),
    )

    print(
        json.dumps(
            {
                'ok': True,
                'artifactDir': artifact_dir.as_posix(),
                'ragDir': rag_dir.as_posix(),
                'chunkCount': len(chunks),
                'model': args.model_name,
                'indexPath': index_path.as_posix(),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
