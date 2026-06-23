FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN find /app -name "main.js" 2>/dev/null || echo "main.js NAO ENCONTRADO"
RUN ls -la /app/
EXPOSE 3000
CMD ["node", "dist/main.js"]
