FROM node:20-slim

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY public/ /app/public/

ENV NODE_ENV=production
EXPOSE 3000

# Banco SQLite fica em /app/backend/data — montar volume persistente aqui
VOLUME /app/backend/data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/app.js"]
