#!/usr/bin/env python3
"""Bundle the verified native source + imported assets with self-contained macOS runtimes.
No export templates, Node installation, browser, or repository needed at runtime.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT.parent / 'Plant 01.app')
parser.add_argument('--godot', type=Path, default=Path('/Applications/Godot.app/Contents/MacOS/Godot'))
parser.add_argument('--node', type=Path, default=Path('/Users/lukacs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'))
args = parser.parse_args()
app = args.output.resolve()
if not (ROOT / 'native/runtime/service.cjs').exists():
    raise SystemExit('Run npm run native:build first.')
if not (ROOT / 'native/.godot/imported').is_dir():
    raise SystemExit('Import native/project.godot with Godot first.')
for binary in (args.godot, args.node):
    if not binary.is_file():
        raise SystemExit(f'Runtime not found: {binary}')
# Rebuild only our app; do not touch installed Godot or existing saved games.
if app.exists():
    if not (app / 'Contents/Resources/PLANT01-BUNDLE').is_file():
        raise SystemExit(f'Refusing to replace an unrelated application: {app}')
    shutil.rmtree(app)
macos = app / 'Contents/MacOS'
resources = app / 'Contents/Resources'
macos.mkdir(parents=True)
resources.mkdir()
(resources / 'PLANT01-BUNDLE').write_text('Plant 01 native build\n')
source = ROOT / 'native'
target = resources / 'native'
shutil.copytree(source, target, ignore=shutil.ignore_patterns('.godot', 'captures', 'tests', 'screenshots', 'runtime/node', '*.log'))
cache = target / '.godot'
cache.mkdir()
shutil.copytree(source / '.godot/imported', cache / 'imported')
for filename in ['uid_cache.bin', 'global_script_class_cache.cfg']:
    if (source / '.godot' / filename).is_file():
        shutil.copy2(source / '.godot' / filename, cache / filename)
(target / 'captures').mkdir()
shutil.copy2(args.node, target / 'runtime/node')
# The installed universal editor is also an executable game runner. Thin a COPY to this Mac's architecture.
architecture = subprocess.check_output(['/usr/bin/uname', '-m'], text=True).strip()
subprocess.run(['/usr/bin/lipo', str(args.godot), '-thin', architecture, '-output', str(macos / 'Godot')], check=True)
launcher = macos / 'Plant01'
launcher.write_text('''#!/bin/zsh
set -eu
bundle_dir="${0:A:h:h}"
export PLANT01_NODE="$bundle_dir/Resources/native/runtime/node"
exec "$bundle_dir/MacOS/Godot" --path "$bundle_dir/Resources/native" --audio-driver Dummy "$@"
''')
launcher.chmod(0o755)
(macos / 'Godot').chmod(0o755)
(target / 'runtime/node').chmod(0o755)
shutil.copy2(ROOT / 'LICENSE', resources / 'LICENSE')
shutil.copy2(ROOT / 'native/README.md', resources / 'README.md')
(resources / 'examples').mkdir()
shutil.copy2(ROOT / 'examples/first-fluid-transfer.json', resources / 'examples/first-fluid-transfer.json')
icon = ROOT / 'native/assets/plant01-icon.icns'
if icon.exists():
    shutil.copy2(icon, resources / 'Plant01.icns')
info = {'CFBundleName': 'Plant 01', 'CFBundleDisplayName': 'Plant 01',
        'CFBundleIdentifier': 'com.lukacslacko.factory-game', 'CFBundleExecutable': 'Plant01',
        'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.23.0',
        'CFBundleVersion': '216', 'CFBundleIconFile': 'Plant01.icns',
        'NSHighResolutionCapable': True, 'LSMinimumSystemVersion': '14.0',
        'NSHumanReadableCopyright': 'Plant 01 contributors · MIT; runtime notices in Resources/native/licenses'}
(app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
# Ad-hoc signing is for local execution, not a notarized public release.
subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
size = sum(p.stat().st_size for p in app.rglob('*') if p.is_file())
print(json.dumps({'app': str(app), 'architecture': architecture, 'bytes': size, 'selfContained': True}, indent=2))
