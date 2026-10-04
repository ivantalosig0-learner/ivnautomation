# Mogoba online ordering server: customer site, register app and API in one image.
# Build from the mogoba-pos folder (the context needs order/, www/ and server/):
#   docker build -f server/Dockerfile -t mogoba-pos .
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8790 \
    DATA_DIR=/data

WORKDIR /app
COPY server/ server/
COPY order/ order/
COPY www/ www/

# Runs as the image's built-in non-root "node" user; only /data is writable to it.
RUN rm -rf server/data && mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8790/api/health >/dev/null || exit 1

CMD ["node", "server/server.mjs"]
