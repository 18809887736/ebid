FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb xdotool ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY patrol.mjs run.sh ./
RUN chmod +x run.sh
ENTRYPOINT ["./run.sh"]
