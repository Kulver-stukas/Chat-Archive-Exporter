"""Build an install ZIP with all UI assets. Uses only Python's standard library."""
from pathlib import Path
import argparse,json,zipfile
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('output',type=Path);args=p.parse_args()
files=[f for f in root.iterdir() if f.is_file() and (f.suffix in {'.js','.html','.css'} or f.name in {'manifest.json','README.md','CHANGELOG.md','LICENSE','RELEASE_NOTES_v0.1.7-rev3.md','RELEASE_NOTES_v0.1.7-rev4.md','RELEASE_NOTES_v0.1.7-rev5.md'})]
for folder in ('lib','ui','icons'):files.extend(f for f in (root/folder).rglob('*') if f.is_file())
names={str(f.relative_to(root)) for f in files};manifest=json.loads((root/'manifest.json').read_text())
for cs in manifest['content_scripts']:
 for item in cs['js']:assert item in names,item
for item in ('ui/state.js','ui/tree.js','ui/chat-list-cache.js','ui/worker-ui.js','options.html','icons/cae-running-16.png'):assert item in names,item
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(files):z.write(f,'chat-archive-exporter/'+str(f.relative_to(root)))
print(f'{args.output.name}: {len(files)} files, {args.output.stat().st_size} bytes')
