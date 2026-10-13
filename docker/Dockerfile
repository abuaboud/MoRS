# Headless game client: Xvfb display, frames go to the gateway, no VNC.
FROM eclipse-temurin:17-jre
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb socat libxext6 libxrender1 libxtst6 libxi6 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY client/lib/ /app/lib/
COPY client/build/mors-client.jar /app/
COPY docker/entrypoint.sh /app/
ENTRYPOINT ["/app/entrypoint.sh"]
