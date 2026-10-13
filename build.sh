#!/bin/bash
# Compile the MoRS client loader into client/build/mors-client.jar.
set -euo pipefail
cd "$(dirname "$0")/client"
JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}
rm -rf build && mkdir -p build/classes
"$JAVA_HOME/bin/javac" --release 11 -cp "lib/*" -d build/classes src/mors/*.java
(cd build/classes && "$JAVA_HOME/bin/jar" cf ../mors-client.jar .)
echo "built client/build/mors-client.jar"
