#!/bin/bash

# Enable case-insensitive pattern matching
shopt -s nocaseglob

# Define the file extensions to process
extensions=("*.mp4" "*.mov" "*.jpg" "*.jpeg" "*.png")

# Loop over each extension
for ext in "${extensions[@]}"; do
    # Loop over files matching the extension
    for f in $ext; do
        # Check if file exists (in case no files match the pattern)
        [ -e "$f" ] || continue

        # Skip files that have already been renamed
        # Check if filename matches the pattern YYYY-MM-DD_HHMMSS_*
        if [[ "$(basename "$f")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}_ ]]; then
            echo "File '$f' appears to have been already renamed, skipping."
            continue
        fi

        # Initialize variables
        creation_time=""
        new_name=""
        original_name="$(basename "$f")"
        extension="${f##*.}"

        # Convert extension to lowercase without using ${variable,,}
        extension_lower=$(echo "$extension" | tr '[:upper:]' '[:lower:]')

        # Check if the file is a video or image based on extension
        if [[ "$extension_lower" == "mp4" || "$extension_lower" == "mov" ]]; then
            # Extract creation_time using ffprobe for videos

            # First, try to extract com.apple.quicktime.creationdate
            creation_time=$(ffprobe -v quiet -show_entries format_tags=com.apple.quicktime.creationdate -of default=noprint_wrappers=1:nokey=1 "$f")

            # If creation_time is empty, try 'creation_time' tag
            if [ -z "$creation_time" ]; then
                creation_time=$(ffprobe -v quiet -show_entries format_tags=creation_time -of default=noprint_wrappers=1:nokey=1 "$f")
            fi

            # If still empty, log and skip the file
            if [ -z "$creation_time" ]; then
                echo "No creation_time metadata found for '$f', skipping."
                continue
            fi

        elif [[ "$extension_lower" == "jpg" || "$extension_lower" == "jpeg" || "$extension_lower" == "png" ]]; then
            # Extract creation_time using exiftool for images
            creation_time=$(exiftool -DateTimeOriginal -s3 "$f")

            # If DateTimeOriginal is empty, try CreateDate
            if [ -z "$creation_time" ]; then
                creation_time=$(exiftool -CreateDate -s3 "$f")
            fi

            # If still empty, log and skip the file
            if [ -z "$creation_time" ]; then
                echo "No creation_time metadata found for '$f', skipping."
                continue
            fi
        else
            # Unsupported file extension, skip
            echo "Unsupported file extension for '$f', skipping."
            continue
        fi

        # Sanitize the creation_time
        creation_time_sanitized="$creation_time"

        # Handle different date formats
        # Replace 'T' with space, remove fractional seconds and timezone info if present
        creation_time_sanitized=$(echo "$creation_time_sanitized" | sed -e 's/T/ /' -e 's/\.[0-9]\{1,\}Z$//' -e 's/[-+][0-9]\{2\}:[0-9]\{2\}$//' -e 's/[-+][0-9]\{4\}$//')

        # Replace colons with dashes in the date part if necessary
        creation_time_sanitized=$(echo "$creation_time_sanitized" | sed 's/^\([0-9]\{4\}\):\([0-9]\{2\}\):\([0-9]\{2\}\)/\1-\2-\3/')

        # Convert the creation_time to the desired format
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS date command
            new_name_prefix=$(date -j -f "%Y-%m-%d %H:%M:%S" "$creation_time_sanitized" +"%Y-%m-%d_%H%M%S" 2>/dev/null)
        else
            # GNU date command
            new_name_prefix=$(date -d "$creation_time_sanitized" +"%Y-%m-%d_%H%M%S" 2>/dev/null)
        fi

        # Check if date conversion was successful
        if [ -z "$new_name_prefix" ]; then
            echo "Failed to parse date for '$f', skipping."
            continue
        fi

        # Construct the new filename with original name
        new_name="${new_name_prefix}_${original_name}"

        # Check if the new file name already exists to avoid overwriting
        if [ -e "$new_name" ]; then
            suffix=1
            base_new_name="${new_name%.*}"
            extension="${new_name##*.}"
            while [ -e "${base_new_name}_$suffix.${extension}" ]; do
                ((suffix++))
            done
            new_name="${base_new_name}_$suffix.${extension}"
        fi

        # Rename the file
        echo "Renaming '$f' to '$new_name'"
        mv "$f" "$new_name"
    done
done

# Disable case-insensitive pattern matching
shopt -u nocaseglob


