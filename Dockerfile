FROM node:20-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TZ=Europe/Kyiv

WORKDIR /app

# Без залежностей і збірки: копіюємо лише код і статику.
COPY --chown=node:node server.js history.js limits.js outages.js telegram.js ./
COPY --chown=node:node public ./public

# Каталог даних (сесія, історія, токен бота). Монтується як том, щоб переживати перезбірку.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
