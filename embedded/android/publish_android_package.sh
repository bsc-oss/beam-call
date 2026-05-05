#!/usr/bin/env bash

# PG_CHANGED

# This script is used for local build and testing of the AAR packaging
# In CI we call gradlew directly

EC_ASSETS_FOLDER=lib/src/main/assets/element-call
CURRENT_DIR=$( dirname -- "${BASH_SOURCE[0]}" )

pushd $CURRENT_DIR > /dev/null

function build_assets() {
	echo "Generating Element Call assets..."
	pushd ../..  > /dev/null
# PG_CHANGED
	yarn run build:embedded:production
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

getopts :sh opt
case $opt in 
	s)
		SKIP=1
		;;
	h)
		echo "-s: will skip building the assets and just publish the library."
		exit 0
		;;
esac

if [ ! $SKIP ]; then
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

# Exit with an error if the gradle publishing fails
set -e
echo "Cleaning previous builds..."
./gradlew clean --no-daemon

echo "Publishing the Android project"

# PG_CHANGED
./gradlew publish --no-daemon

popd  > /dev/null