import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-dir', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--branch', required=True)
    parser.add_argument('--remote-prefix', default='')
    parser.add_argument('--output-root', default='')
    return parser.parse_args()


def normalize_posix_path(value: str) -> str:
    return value.replace('\\', '/').strip('/')


def resolve_remote_prefix(image_dir: Path, output_root: str, remote_prefix: str) -> str:
    if remote_prefix:
        return normalize_posix_path(remote_prefix)

    if output_root:
        output_root_path = Path(output_root).resolve()
        try:
            relative_dir = image_dir.resolve().relative_to(output_root_path)
            return relative_dir.as_posix()
        except ValueError:
            pass

    if image_dir.name == 'images':
        return image_dir.parent.name + '/images'

    return image_dir.name


def github_request(method: str, url: str, token: str, payload: dict | None = None) -> dict | None:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')

    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            'Accept': 'application/vnd.github+json',
            'Authorization': f'Bearer {token}',
            'User-Agent': 'paper-reader-ts-github-sync',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
    )

    try:
        with urllib.request.urlopen(request) as response:
            body = response.read()
            if not body:
                return None
            return json.loads(body.decode('utf-8'))
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'GitHub API {method} {url} failed: {error.code} {detail}') from error


def get_existing_file_sha(repo: str, branch: str, remote_path: str, token: str) -> str | None:
    encoded_path = urllib.parse.quote(remote_path, safe='/')
    url = f'https://api.github.com/repos/{repo}/contents/{encoded_path}?ref={urllib.parse.quote(branch, safe="")}'
    try:
        response = github_request('GET', url, token)
    except RuntimeError as error:
        if ' 404 ' in str(error):
            return None
        raise

    if not response:
        return None
    return response.get('sha')


def upload_file(repo: str, branch: str, remote_path: str, local_path: Path, token: str) -> dict:
    encoded_path = urllib.parse.quote(remote_path, safe='/')
    url = f'https://api.github.com/repos/{repo}/contents/{encoded_path}'
    sha = get_existing_file_sha(repo, branch, remote_path, token)
    content = base64.b64encode(local_path.read_bytes()).decode('ascii')
    payload = {
        'message': f'Sync {remote_path}',
        'content': content,
        'branch': branch,
    }
    if sha:
        payload['sha'] = sha

    response = github_request('PUT', url, token, payload)
    content_info = response.get('content') if response else {}
    return {
        'sha': content_info.get('sha'),
        'remoteUrl': content_info.get('download_url') or f'https://raw.githubusercontent.com/{repo}/{branch}/{remote_path}',
        'updated': bool(sha),
    }


def main() -> int:
    args = parse_args()
    image_dir = Path(args.image_dir).resolve()
    token = os.getenv('GITHUB_TOKEN', '')
    remote_prefix = resolve_remote_prefix(image_dir, args.output_root, args.remote_prefix)

    if not image_dir.exists():
        print('图片目录不存在', flush=True)
        return 1

    images = sorted(path for path in image_dir.rglob('*') if path.is_file())
    print(f'发现 {len(images)} 张图片，目标仓库 {args.repo}@{args.branch}', flush=True)

    if not token:
        print('未配置 GitHub Token，无法上传到 GitHub。', flush=True)
        return 1

    manifest = []
    failed = False
    for image in images:
        relative_path = image.relative_to(image_dir).as_posix()
        remote_path = f'{remote_prefix}/{relative_path}' if remote_prefix else relative_path
        print(f'SYNC {remote_path}', flush=True)
        entry = {
            'localPath': image.as_posix(),
            'repo': args.repo,
            'branch': args.branch,
            'remotePath': remote_path,
            'remoteUrl': f'https://raw.githubusercontent.com/{args.repo}/{args.branch}/{remote_path}',
            'uploaded': False,
        }

        try:
            result = upload_file(args.repo, args.branch, remote_path, image, token)
            entry['remoteUrl'] = result['remoteUrl']
            entry['uploaded'] = True
            entry['sha'] = result['sha']
            entry['action'] = 'updated' if result['updated'] else 'created'
            print(f'OK {remote_path}', flush=True)
        except Exception as error:
            failed = True
            entry['error'] = str(error)
            print(f'ERROR {remote_path}: {error}', flush=True)

        manifest.append(entry)

    manifest_path = image_dir.parent / 'github_manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'manifest 已写入 {manifest_path.as_posix()}', flush=True)
    if failed:
        print('部分文件上传失败。', flush=True)
        return 1

    print('GitHub 上传完成。', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())