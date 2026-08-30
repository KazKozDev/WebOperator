#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
assets_dir="$repo_root/docs/assets"
extension_dir="$repo_root/core/dist"
extension_id="phbohkmfojcjbmgfnaikenmgemgckdpg"
extension_url="chrome-extension://$extension_id/src/sidepanel/index.html"

session_name="weboperator-demo-capture"
agent-browser --session "$session_name" --extension "$extension_dir" open "$extension_url"
agent-browser --session "$session_name" set viewport 800 700
agent-browser --session "$session_name" set media dark
agent-browser --session "$session_name" snapshot -i >/dev/null
agent-browser --session "$session_name" screenshot "$assets_dir/demo-task.png"
agent-browser --session "$session_name" click @e8
agent-browser --session "$session_name" wait 500
agent-browser --session "$session_name" screenshot "$assets_dir/demo-skills.png"
agent-browser --session "$session_name" click @e7
agent-browser --session "$session_name" wait 500
agent-browser --session "$session_name" screenshot "$assets_dir/demo-schedule.png"
agent-browser --session "$session_name" click @e5
agent-browser --session "$session_name" fill @e14 "Compare the visible prices across my open tabs"
agent-browser --session "$session_name" wait 500
agent-browser --session "$session_name" screenshot "$assets_dir/demo-goal.png"
agent-browser --session "$session_name" close

ffmpeg -y \
  -i "$assets_dir/demo-task.png" \
  -i "$assets_dir/demo-skills.png" \
  -i "$assets_dir/demo-schedule.png" \
  -i "$assets_dir/demo-goal.png" \
  -filter_complex "[0:v]scale=800:700:force_original_aspect_ratio=decrease,pad=800:700:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0d,zoompan=z='min(zoom+0.0005,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=45:s=800x700:fps=15,setpts=PTS-STARTPTS[v0];[1:v]scale=800:700:force_original_aspect_ratio=decrease,pad=800:700:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0d,zoompan=z='min(zoom+0.0005,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=45:s=800x700:fps=15,setpts=PTS-STARTPTS[v1];[2:v]scale=800:700:force_original_aspect_ratio=decrease,pad=800:700:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0d,zoompan=z='min(zoom+0.0005,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=45:s=800x700:fps=15,setpts=PTS-STARTPTS[v2];[3:v]scale=800:700:force_original_aspect_ratio=decrease,pad=800:700:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0d,zoompan=z='min(zoom+0.0005,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=45:s=800x700:fps=15,setpts=PTS-STARTPTS[v3];[v0][v1][v2][v3]concat=n=4:v=1:a=0,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
  -t 12 "$assets_dir/weboperator-demo.gif"

gifsicle -O3 --colors 128 "$assets_dir/weboperator-demo.gif" \
  -o "$assets_dir/weboperator-demo.optimized.gif"
mv "$assets_dir/weboperator-demo.optimized.gif" "$assets_dir/weboperator-demo.gif"
