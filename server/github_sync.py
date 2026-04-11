import argparse
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-dir', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--branch', required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    image_dir = Path(args.image_dir)
    token = os.getenv('GITHUB_TOKEN', '')

    if not image_dir.exists():
        print('图片目录不存在', flush=True)
        return 1

    images = sorted(path for path in image_dir.rglob('*') if path.is_file())
    print(f'发现 {len(images)} 张图片，目标仓库 {args.repo}@{args.branch}', flush=True)

    if not token:
        print('未配置 GitHub Token，跳过真实上传，仅生成本地 manifest。', flush=True)

    manifest = []
    for image in images:
        relative_path = image.relative_to(image_dir).as_posix()
        manifest.append(
            {
                'localPath': image.as_posix(),
                'repo': args.repo,
                'branch': args.branch,
                'remotePath': relative_path,
                'remoteUrl': f'https://raw.githubusercontent.com/{args.repo}/{args.branch}/{relative_path}',
                'uploaded': bool(token),
            }
        )
        print(f'SYNC {relative_path}', flush=True)

    manifest_path = image_dir.parent / 'github_manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'manifest 已写入 {manifest_path.as_posix()}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())