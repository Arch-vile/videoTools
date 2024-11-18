#Videos from google photos use codec not supported by Imovie or PowerDirector. Need to convert:

find . -maxdepth 1 -type f -name "*.mp4" -print0 | xargs -0 -I {} bash -c '
    file="{}"
    base_name=$(basename "$file" .mp4)
    ffmpeg -i "$file" -c:v libx264 -c:a aac -map_metadata 0 "../${base_name}.mov"
'

