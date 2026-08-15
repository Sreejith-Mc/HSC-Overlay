# HSC Overlay — zero-dependency Node app, so this image is tiny and has no
# install step. Build:  docker build -t hsc-overlay .
FROM node:22-alpine

WORKDIR /app

# No dependencies to install — copy the app as-is.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY tools ./tools

# Mount these as volumes so the match, operator accounts and artwork survive
# a container rebuild:
#   -v hsc-data:/app/data -v hsc-assets:/app/assets
RUN mkdir -p /app/data /app/assets

ENV PORT=8787
ENV HOST=0.0.0.0
# Behind a reverse proxy (Caddy/nginx/Cloudflare), so Secure cookies and real
# client IPs work correctly:
ENV TRUST_PROXY=1

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/api/gamedata > /dev/null || exit 1

CMD ["node", "server/index.js"]
