FROM nginx:stable-alpine
ARG DEV
RUN mkdir /app
WORKDIR /app
COPY ./website/src .
COPY ./nginx-release.conf /etc/nginx/nginx-release.conf
COPY ./nginx-dev.conf /etc/nginx/nginx-dev.conf
RUN if [ "$DEV" = "true" ]; then \
      echo "DEV"; \
      mv /etc/nginx/nginx-dev.conf /etc/nginx/nginx.conf; \
    else \
      echo "PROD"; \
      mv /etc/nginx/nginx-release.conf /etc/nginx/nginx.conf; \
    fi
EXPOSE 80
EXPOSE 443
CMD ["nginx", "-g", "daemon off;"]

LABEL org.opencontainers.image.source="https://github.com/drakumus/website"