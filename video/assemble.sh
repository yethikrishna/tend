#!/bin/bash
# Assemble tend-demo.mp4: cards + captures + VO. Run after capture.cjs finishes.
set -e
W=/tmp; V=/tmp/vo; C=/tmp/cap; OUT=/home/sandbox/tend/video/tend-demo.mp4
dur() { ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$1"; }
N1=$(dur $V/tend-n1-bf8497e8.wav); N2=$(dur $V/tend-n2-861f9b52.wav); N3=$(dur $V/tend-n3-56ca2ad2.wav)
N4=$(dur $V/tend-n4-609e743a.wav); N5=$(dur $V/tend-n5-9f331058.wav); N6=$(dur $V/tend-n6-ead8e284.wav)
S1=$(awk "BEGIN{print $N1+0.6}"); S2=$(awk "BEGIN{print $N2+0.6}"); S5=$(awk "BEGIN{print $N5+0.6}"); S6=$(awk "BEGIN{print $N6+0.9}")

CONVO=$(ls -S $C/*.webm | head -1)
DASH=$(ls -S $C/*.webm | tail -1)
# conversation duration = last mark + 1.0 tail
CONVEND=$(jq '[.[]|select(.name=="convo-end")|.t][0]' $C/marks.json)
S3=$(awk "BEGIN{print $CONVEND + 1.0}")
S4=$(awk "BEGIN{print $N4 + 1.6}")   # dashboard: n4 starts at +0.8

# reply marks -> adelay ms offsets (audio placed 0.35s after reply lands)
OFF=$(jq -r '[.[]|select(.name|startswith("reply-"))|.t]|map((.+0.35)*1000|floor)|@csv' $C/marks.json)
INTRO_OFF=$(jq -r '[.[]|select(.name=="intro-hold")|.t][0] * 1000 | floor' $C/marks.json)
IFS=',' read -r O1 O2 O3 O4 O5 O6 <<< "$OFF"

# card segments
mkcard() { ffmpeg -y -v error -loop 1 -t "$2" -i "$1" -i "$3" -vf "scale=1280:720,fps=30,format=yuv420p" -af "aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:$2" -c:v libx264 -preset medium -crf 20 -c:a aac -shortest "$4"; }
mkcard $W/card-title.png $S1 $V/tend-n1-bf8497e8.wav $C/seg1.mp4
mkcard $W/card-problem.png $S2 $V/tend-n2-861f9b52.wav $C/seg2.mp4
mkcard $W/card-arch.png $S5 $V/tend-n5-9f331058.wav $C/seg5.mp4
mkcard $W/card-close.png $S6 $V/tend-n6-ead8e284.wav $C/seg6.mp4

# conversation segment: webm video trimmed to S3, audio mix of n3 + t1..t6
ffmpeg -y -v error -i "$CONVO" -i $V/tend-n3-56ca2ad2.wav -i $V/tend-t1-94418014.wav -i $V/tend-t2-bb06e066.wav -i $V/tend-t3-e8eec776.wav -i $V/tend-t4-754eaff3.wav -i $V/tend-t5-d2a66ad9.wav -i $V/tend-t6-c831c889.wav \
 -filter_complex "[0:v]scale=1280:720,fps=30,trim=0:$S3,setpts=PTS-STARTPTS,format=yuv420p[v];\
 [1:a]adelay=$INTRO_OFF|$INTRO_OFF[n3];[2:a]adelay=$O1|$O1[a1];[3:a]adelay=$O2|$O2[a2];[4:a]adelay=$O3|$O3[a3];[5:a]adelay=$O4|$O4[a4];[6:a]adelay=$O5|$O5[a5];[7:a]adelay=$O6|$O6[a6];\
 [n3][a1][a2][a3][a4][a5][a6]amix=inputs=7:normalize=0,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:$S3[a]" \
 -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 20 -c:a aac $C/seg3.mp4

# dashboard segment: extend last frame to S4, n4 at +0.8
ffmpeg -y -v error -i "$DASH" -i $V/tend-n4-609e743a.wav \
 -filter_complex "[0:v]scale=1280:720,fps=30,tpad=stop_mode=clone:stop=$S4,trim=0:$S4,setpts=PTS-STARTPTS,format=yuv420p[v];\
 [1:a]adelay=800|800,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:$S4[a]" \
 -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 20 -c:a aac $C/seg4.mp4

# concat
printf "file '%s'\n" $C/seg1.mp4 $C/seg2.mp4 $C/seg3.mp4 $C/seg4.mp4 $C/seg5.mp4 $C/seg6.mp4 > $C/list.txt
ffmpeg -y -v error -f concat -safe 0 -i $C/list.txt -c copy "$OUT"
echo "TOTAL $(dur "$OUT") s"
