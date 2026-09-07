FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better caching on future builds)
COPY package*.json ./
RUN npm install
COPY . .
RUN ls -la /app

# Build the React frontend into /app/dist
RUN npm run build

EXPOSE 3001

CMD ["node", "server.js"]

