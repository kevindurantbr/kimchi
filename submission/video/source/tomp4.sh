#!/bin/bash
# usage: tomp4.sh <framesdir> <out.mp4>  -- frames named NNNNN_<timestamp>.jpg
d=$1; out=$2
ls $d/*.jpg | sort > /tmp/_l.txt
python3 - "$d" > $d.ffconcat <<'PY'
import sys,glob,os
fs=sorted(glob.glob(sys.argv[1]+'/*.jpg'))
ts=[float(os.path.basename(f).split('_')[1][:-4]) for f in fs]
print('ffconcat version 1.0')
for i,f in enumerate(fs):
    dur = ts[i+1]-ts[i] if i+1<len(fs) else 0.5
    print(f"file '{os.path.abspath(f)}'\nduration {dur:.4f}")
print(f"file '{os.path.abspath(fs[-1])}'")
PY
ffmpeg -y -loglevel error -f concat -safe 0 -i $d.ffconcat -vf "tpad=stop_mode=clone:stop_duration=5,fps=30,scale=1536:960:flags=lanczos,format=yuv420p" -c:v libx264 -crf 14 -preset slow $out
ffprobe -v error -show_entries format=duration -of csv=p=0 $out
