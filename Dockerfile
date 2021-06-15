FROM nginx:stable-alpine
RUN mkdir /app
WORKDIR /app
COPY ./src .
COPY ./nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
EXPOSE 443
CMD ["nginx", "-g", "daemon off;"]

LABEL org.opencontainers.image.source="https://github.com/drakumus/website"