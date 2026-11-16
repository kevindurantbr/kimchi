import subprocess, sys
# name, source, start, end, speed, zoom_to, fx, fy, out_duration
W, H = 1728, 1080
shots = [
  ('s0_hook',     'A_map',       0.0,  3.4, 1.0,  1.12, 0.49, 0.50),
  ('s1_map',      'A_map',       0.3,  4.6, 1.0,  1.35, 0.50, 0.52),
  ('s2_factors',  'B_factors',   0.5,  5.8, 1.26, 1.18, 0.36, 0.52),
  ('s3_play',     'C_play',      0.2, 16.6, 4.3,  1.28, 0.50, 0.66),
  ('s4_actions',  'D_actions',   0.0,  4.7, 1.0,  1.62, 0.70, 0.42),
  ('s5_rotations','E_rotations', 0.0,  3.7, 1.0,  1.55, 0.72, 0.40),
  ('s6_report',   'G_report',    0.0,  3.0, 1.0,  1.22, 0.50, 0.40),
]
for name, src, a, b, speed, z1, fx, fy in shots:
    n = round((b - a) / speed * 30)
    p = f"min(1,on/{n})"
    ease = f"if(lt({p},0.5),2*{p}*{p},1-pow(-2*{p}+2,2)/2)"
    z = f"1+({z1}-1)*{ease}"
    x = f"max(0,min(iw-iw/zoom,{fx}*iw-iw/zoom/2))"
    y = f"max(0,min(ih-ih/zoom,{fy}*ih-ih/zoom/2))"
    vf = (f"tpad=stop_mode=clone:stop_duration=6,trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{speed},fps=30,"
          f"scale=2880:1800,zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps=30,format=yuv420p")
    cmd = ['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',f'{src}.ffconcat','-vf',vf,'-frames:v',str(n),'-c:v','libx264','-crf','15','-preset','medium',f'shots/{name}.mp4']
    subprocess.run(cmd, check=True)
    print(name, n/30)
