FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy server code and public assets
COPY server/ ./server/
COPY public/ ./public/
COPY n8n_whatsapp_workflow.json ./

# Expose POS Bot API port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server/index.js"]
