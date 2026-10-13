#!/bin/bash
# Assemble client/lib from a RuneLite build: injected client (RSA modulus patched for your server),
# runelite-api, its runtime deps, and RuneLite's script overlays.
# usage: ./setup-libs.sh <runelite checkout> <server client.key>
set -euo pipefail
RL=${1:?runelite checkout}; KEY=${2:?server client.key (e.g. openrune/.data/client.key)}
cd "$(dirname "$0")"
G=~/.gradle/caches/modules-2/files-2.1
mkdir -p client/lib
(cd "$RL" && JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17} ./gradlew :client:processResources :runelite-api:jar --console=plain -q -x test)
pick() { find "$G/$1" -name "$2" | grep -v sources | sort | tail -1; }
INJ=$(find "$G/net.runelite/injected-client" -name 'injected-client-*.jar' | grep -v sources | sort | tail -1)
python3 tools/patch_rsa.py "$INJ" client/lib/injected-client.jar "$KEY"
cp "$(ls "$RL"/runelite-api/build/libs/runelite-api-*.jar | grep -v sources | head -1)" client/lib/runelite-api.jar
cp "$(pick com.google.code.gson/gson 'gson-2.11*.jar')" client/lib/gson.jar
cp "$(pick com.google.guava/guava 'guava-3*.jar')" client/lib/guava.jar
cp "$(pick org.json/json 'json-*.jar')" client/lib/json.jar
cp "$(pick org.slf4j/slf4j-api 'slf4j-api-2*.jar')" client/lib/slf4j-api.jar
cp "$(pick javax.inject/javax.inject 'javax.inject-1.jar')" client/lib/javax.inject.jar
cp "$(pick com.google.code.findbugs/jsr305 'jsr305-3*.jar')" client/lib/jsr305.jar
(cd "$RL/runelite-client/build/resources/main" && jar cf "$OLDPWD/client/lib/runelite-overlays.jar" runelite)
ls -la client/lib
