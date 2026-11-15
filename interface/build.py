#!/usr/bin/env python3
"""Build the static interface from reviewed source files; no network/dependencies."""
import hashlib
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUTPUT = HERE / 'dist'
FILES = ['index.html', 'styles.css', 'app.js', 'model.mjs', 'live_weather.mjs', 'icon.svg']


def build():
    bundle = ROOT / 'prototype/demo_bundle.json'
    data = json.loads(bundle.read_text())
    if data.get('schema_version') != 'kimchi.demo.1':
        raise ValueError('Review the interface for this bundle schema before building')
    # Refuse to package stale evidence: no silent divergence from authoritative inputs.
    for path, expected in data['input_sha256'].items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected:
            raise ValueError('Stale bundle input: ' + path)
    OUTPUT.mkdir(exist_ok=True)
    for name in FILES:
        shutil.copyfile(HERE / name, OUTPUT / name)
    shutil.copyfile(bundle, OUTPUT / 'demo_bundle.json')
    print('Built interface/dist; bundled research is byte-identical to prototype/demo_bundle.json')


if __name__ == '__main__':
    build()
