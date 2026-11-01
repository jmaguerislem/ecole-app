# Image unique : API Node/Express + frontend React compilé (déploiement Railway / Render / VPS)
FROM node:20-alpine AS front
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci || npm install
COPY frontend ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json backend/
RUN cd backend && (npm ci --omit=dev || npm install --omit=dev)
COPY backend backend
COPY --from=front /app/frontend/dist frontend/dist
WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "src/index.js"]
