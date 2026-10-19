#!/usr/bin/env bash

# This script builds an AAR file locally instead of publishing to GitLab
# Based on publish_android_package.sh but modified to create AAR output

EC_ASSETS_FOLDER=lib/src/main/assets/element-call
CURRENT_DIR=$( dirname -- "${BASH_SOURCE[0]}" )
DEFAULT_OUTPUT_DIR=build/outputs
OUTPUT_DIR=""

pushd $CURRENT_DIR > /dev/null

function build_assets() {
	echo "Generating Element Call assets..."
	pushd ../..  > /dev/null
	npm run build:embedded
	popd  > /dev/null
}

function copy_assets() {
	echo "Cleaning and copying Element Call assets..."
	# Clean and copy assets (ensuring clean copy like rsync --delete)
	if [ -d $EC_ASSETS_FOLDER ]; then
		rm -rf $EC_ASSETS_FOLDER
	fi
	mkdir -p $EC_ASSETS_FOLDER
	cp -R ../../dist/* $EC_ASSETS_FOLDER
}

function show_help() {
	echo "Usage: $0 [OPTIONS]"
	echo ""
	echo "Options:"
	echo "  -s              Skip building assets and use existing ones"
	echo "  -o <directory>  Specify output directory for the AAR file (default: $DEFAULT_OUTPUT_DIR)"
	echo "  -h              Show this help message"
	echo ""
	echo "This script will:"
	echo "  1. Build Element Call assets (unless -s is specified)"
	echo "  2. Copy assets to the Android library"
	echo "  3. Build the AAR file"
	echo "  4. Copy the AAR to the specified output directory for easy access"
}

# Parse command line options
SKIP=0
while getopts ":sho:" opt; do
	case $opt in 
		s)
			SKIP=1
			;;
		o)
			OUTPUT_DIR="$OPTARG"
			;;
		h)
			show_help
			exit 0
			;;
		\?)
			echo "Invalid option: -$OPTARG" >&2
			show_help
			exit 1
			;;
		:)
			echo "Option -$OPTARG requires an argument." >&2
			show_help
			exit 1
			;;
	esac
done

# Set default output directory if not specified
if [ -z "$OUTPUT_DIR" ]; then
	OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
fi

# Handle asset building
if [ $SKIP -eq 0 ]; then
	read -p "Do you want to re-build the assets (y/n, defaults to no)? " -n 1 -r
	echo ""
	if [[ $REPLY =~ ^[Yy]$ ]]; then
		build_assets
	else 
		echo "Using existing assets from ../../dist"
	fi
	copy_assets
elif [ ! -d $EC_ASSETS_FOLDER ]; then
	echo "Assets folder at $EC_ASSETS_FOLDER not found. Either build and copy the assets manually or remove the -s flag."
	exit 1
fi

# Exit with an error if the gradle build fails
set -e

echo "Cleaning previous builds..."
./gradlew clean --no-daemon

echo "Building the Android AAR..."
./gradlew assembleRelease --no-daemon

# Create output directory and copy AAR
echo "Creating output directory: $OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Find and copy the AAR file
AAR_FILE=$(find lib/build/outputs/aar -name "*.aar" -type f | head -1)
if [ -f "$AAR_FILE" ]; then
	OUTPUT_AAR="$OUTPUT_DIR/pg-call-embedded.aar"
	cp "$AAR_FILE" "$OUTPUT_AAR"
	
	echo ""
	echo "✅ AAR file created successfully!"
	echo "📍 Location: $OUTPUT_AAR"
	echo "📦 File size: $(du -h "$OUTPUT_AAR" | cut -f1)"
	echo ""
	echo "You can now use this AAR file in your Android project."
else
	echo "❌ Error: AAR file not found after build!"
	exit 1
fi

popd > /dev/null