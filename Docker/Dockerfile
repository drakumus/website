FROM nginx:stable-alpine as production-stage
RUN mkdir /app
WORKDIR /app
COPY . .
COPY Docker/resources/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
EXPOSE 443
CMD ["nginx", "-g", "daemon off;"]