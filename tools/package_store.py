"""Build a runtime-only Chrome Web Store ZIP (manifest at archive root)."""
from pathlib import Path
import argparse, json, re, zipfile
root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('output', type=Path)
args = p.parse_args()
files = [f for f in root.iterdir() if f.is_file() and (f.suffix in {'.js', '.html', '.css'} or f.name in {'manifest.json', 'LICENSE', 'PRIVACY.md'})]
for directory in ('lib', 'ui', 'icons'):
    files.extend(f for f in (root / directory).rglob('*') if f.is_file() and f.suffix in {'.js', '.css', '.html', '.png', '.svg'})
names = {f.relative_to(root).as_posix() for f in files}
m = json.loads((root / 'manifest.json').read_text())
assert m['manifest_version'] == 3 and len(m['description']) <= 132
required = {'manifest.json', 'LICENSE', 'PRIVACY.md', m['background']['service_worker'], m['action']['default_popup'], m['side_panel']['default_path'], m['options_ui']['page']}
required.update(m['icons'].values())
required.update(m['action']['default_icon'].values())
for cs in m['content_scripts']:
    required.update(cs['js']); required.update(cs.get('css', []))
for page in root.glob('*.html'):
    required.update(re.findall(r'<script\s+src="([^"]+)"', page.read_text()))
for call in re.findall(r'importScripts\((.*?)\)', (root/'worker.js').read_text(), re.S):
    required.update(re.findall(r"'([^']+\.js)'", call))
assert required <= names, required - names
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in sorted(files):
        z.write(f, f.relative_to(root).as_posix())
with zipfile.ZipFile(args.output) as z:
    assert z.testzip() is None
    assert 'manifest.json' in z.namelist() and not any(n.startswith(('tests/', 'chat-archive-exporter/')) for n in z.namelist())
print(f'{args.output.name}: {len(files)} runtime files, {args.output.stat().st_size} bytes')
