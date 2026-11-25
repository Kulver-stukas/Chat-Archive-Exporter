"""Build an install ZIP with all UI assets. Uses only Python's standard library."""
from pathlib import Path
import argparse,json,re,zipfile
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('output',type=Path);args=p.parse_args()
files=[f for f in root.iterdir() if f.is_file() and (f.suffix in {'.js','.html','.css'} or f.name in {'manifest.json','README.md','CHANGELOG.md','LICENSE','RELEASE_NOTES_v0.1.8-rev1.md','RELEASE_NOTES_v0.1.9-rev1.md','RELEASE_NOTES_v0.1.9-rev2.md','RELEASE_NOTES_v0.1.9-rev3.md','UAT_v0.1.9-rev1.md','TEST_REPORT_v0.1.9-rev1.md','TEST_REPORT_v0.1.9-rev2.md','TEST_REPORT_v0.1.9-rev3.md','TODO_v0.1.9.md'})]
for folder in ('lib','ui','icons'):files.extend(f for f in (root/folder).rglob('*') if f.is_file())
names={str(f.relative_to(root)) for f in files};manifest=json.loads((root/'manifest.json').read_text())
for cs in manifest['content_scripts']:
 for item in cs['js']:assert item in names,item
for item in ('ui/state.js','ui/tree.js','ui/chat-list-cache.js','ui/worker-ui.js','options.html','icons/cae-running-16.png'):assert item in names,item
for page in root.glob('*.html'):
 for item in re.findall(r'<script\s+src="([^"]+)"',page.read_text()):assert item in names,(page.name,item)
for call in re.findall(r'importScripts\((.*?)\)',(root/'worker.js').read_text(),re.S):
 for item in re.findall(r"'([^']+\.js)'",call):assert item in names,item
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(files):z.write(f,'chat-archive-exporter/'+str(f.relative_to(root)))
print(f'{args.output.name}: {len(files)} files, {args.output.stat().st_size} bytes')
