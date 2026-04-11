import argparse
import json
import os
import sys
from pathlib import Path


AUTO_LANG = 'auto'
DEFAULT_FALLBACK_LANG = 'en'
CHINESE_LANG_CODES = {
    'zh', 'zh-cn', 'zh-tw', 'zh-hk', 'zh-hans', 'zh-hant', 'ch', 'chi_sim', 'chi_tra'
}


def emit_status(status: str, detail: str) -> None:
    print(f"TASK_STATUS|{status}|{detail}", flush=True)


def emit_output(path: Path) -> None:
    print(f"TASK_OUTPUT|{path.as_posix()}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--method', default='api-first')
    parser.add_argument('--mineru-root', required=True)
    parser.add_argument('--lang', default=AUTO_LANG)
    return parser.parse_args()


def find_content_dir(output_dir: Path, stem: str) -> Path:
    candidates = [
        output_dir / stem / 'auto',
        output_dir / stem / 'txt',
        output_dir / stem / 'ocr',
        output_dir / stem / 'vlm',
        output_dir / stem,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return output_dir


def map_detected_lang_to_mineru(lang: str) -> str:
    normalized = (lang or '').strip().lower()
    if not normalized:
        return DEFAULT_FALLBACK_LANG
    if normalized in CHINESE_LANG_CODES:
        return 'ch'
    if normalized.startswith('zh'):
        return 'ch'
    return 'en'


def extract_pdf_text_sample(file_path: Path, max_pages: int = 3) -> str:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(file_path))
    try:
        page_count = len(document)
        parts: list[str] = []
        for page_index in range(min(page_count, max_pages)):
            page = document.get_page(page_index)
            text_page = None
            try:
                text_page = page.get_textpage()
                text = text_page.get_text_range()
                if text:
                    parts.append(text)
            finally:
                if text_page is not None:
                    text_page.close()
                page.close()
        return '\n'.join(parts)
    finally:
        document.close()


def resolve_mineru_lang(file_path: Path, requested_lang: str) -> str:
    normalized = (requested_lang or AUTO_LANG).strip().lower()
    if normalized != AUTO_LANG:
        return normalized

    try:
        from mineru.utils.language import detect_lang

        sample_text = extract_pdf_text_sample(file_path)
        detected_lang = detect_lang(sample_text)
        resolved_lang = map_detected_lang_to_mineru(detected_lang)
        emit_status(
            'starting-env',
            f'Language auto resolved to {resolved_lang} from detector={detected_lang or "unknown"}',
        )
        return resolved_lang
    except Exception as exc:
        emit_status(
            'starting-env',
            f'Language auto resolution failed, fallback to {DEFAULT_FALLBACK_LANG}: {exc}',
        )
        return DEFAULT_FALLBACK_LANG


def run_api_parse(file_path: Path, output_dir: Path, lang: str) -> Path:
    from mineru.cli.common import do_parse

    emit_status('parsing', 'MinerU Python API 已启动。')
    do_parse(
        output_dir=str(output_dir),
        pdf_file_names=[file_path.stem],
        pdf_bytes_list=[file_path.read_bytes()],
        p_lang_list=[lang],
        backend='pipeline',
        parse_method='auto',
        formula_enable=True,
        table_enable=True,
        f_dump_md=True,
        f_dump_middle_json=True,
        f_dump_model_output=True,
        f_dump_orig_pdf=False,
        f_dump_content_list=True,
    )
    return find_content_dir(output_dir, file_path.stem)


def run_cli_parse(file_path: Path, output_dir: Path, lang: str) -> Path:
    import subprocess

    emit_status('parsing', 'MinerU CLI 已启动。')
    command = [
        sys.executable,
        '-m',
        'mineru.cli.client',
        '-p',
        str(file_path),
        '-o',
        str(output_dir),
        '-l',
        lang,
        '-b',
        'pipeline',
    ]
    process = subprocess.run(command, capture_output=True, text=True, check=False)
    if process.stdout:
        print(process.stdout, end='', flush=True)
    if process.stderr:
        print(process.stderr, end='', file=sys.stderr, flush=True)
    if process.returncode != 0:
        raise RuntimeError(f'MinerU CLI failed with exit code {process.returncode}')
    return find_content_dir(output_dir, file_path.stem)


def main() -> int:
    args = parse_args()
    file_path = Path(args.file).resolve()
    output_dir = Path(args.output_dir).resolve()
    mineru_root = Path(args.mineru_root).resolve()

    sys.path.insert(0, str(mineru_root))
    os.makedirs(output_dir, exist_ok=True)

    emit_status('starting-env', f'Python: {sys.executable}')
    emit_status('starting-env', f'Device mode: {os.getenv("MINERU_DEVICE_MODE", "auto")}')
    resolved_lang = resolve_mineru_lang(file_path, args.lang)

    try:
      if args.method == 'cli-first':
          artifact_dir = run_cli_parse(file_path, output_dir, resolved_lang)
      else:
          try:
              artifact_dir = run_api_parse(file_path, output_dir, resolved_lang)
          except Exception as exc:
              print(f'API 模式失败，回退 CLI: {exc}', flush=True)
              artifact_dir = run_cli_parse(file_path, output_dir, resolved_lang)
    except Exception as exc:
        emit_status('failed', str(exc))
        print(json.dumps({'error': str(exc)}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 1

    emit_status('writing-artifacts', f'产物输出目录: {artifact_dir.as_posix()}')
    emit_output(artifact_dir)
    emit_status('ready', 'MinerU 解析已完成。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())