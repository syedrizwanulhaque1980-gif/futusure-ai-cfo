FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better caching on future builds)
COPY package*.json ./
RUN npm install

# Copy the rest of the actual source — this is the step that was
# silently missing before, which is why server.js wasn't in the image
COPY . .

# Build the React frontend into /app/dist
RUN npm run build

EXPOSE 3001

CMD ["node", "server.js"]

