FROM node:16

RUN mkdir /app
RUN mkdir /app/src
RUN mkdir /app/src/react
RUN mkdir /app/src/react/drops
WORKDIR /app
COPY ./package.json .
COPY ./server.js .
COPY ./src ./src
EXPOSE 5000

RUN npm install
WORKDIR /app/src/react/drops
RUN npm install
RUN npm run-script build

CMD node ../../../server.js

LABEL org.opencontainers.image.source="https://github.com/drakumus/website"
