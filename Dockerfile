FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
# Provision the (emulated) AWS resources, then start the API + frontend.
CMD ["sh", "-c", "node scripts/provision.js --demo && node src/server.js"]
