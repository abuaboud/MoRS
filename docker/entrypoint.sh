#!/bin/bash
# The client talks to 127.0.0.1 (game :43594, gateway :8888); forward both to the host.
set -e
HOST=${UPSTREAM:-host.docker.internal}
socat TCP-LISTEN:43594,fork,reuseaddr,bind=127.0.0.1 TCP:$HOST:43594 &
socat TCP-LISTEN:8888,fork,reuseaddr,bind=127.0.0.1 TCP:$HOST:8888 &
rm -f /tmp/.X0-lock /tmp/.X11-unix/X0  # stale after a container restart
Xvfb :0 -screen 0 800x600x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:0
sleep 1
exec java -Dsun.java2d.opengl=false -Dmors.gateway=ws://127.0.0.1:8888/client -cp "/app/mors-client.jar:/app/lib/*" \
  mors.Boot http://127.0.0.1:8888/jav_config.ws
