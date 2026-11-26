# Образ для запуска Telegram-бота закупок (Node.js + Python Playwright + Chromium).
# Основа: официальный образ Playwright для Python (в нём уже есть Chromium нужной версии).
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

# Node.js 22 для бота
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates poppler-utils \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Версия playwright должна совпадать с версией образа (v1.49.0), иначе не найдётся браузер.
RUN pip install --no-cache-dir "playwright==1.49.0" pymupdf

# Боту нужны только эти папки; сайт (Nuxt) в образ не попадает.
COPY bot ./bot
COPY tenders ./tenders
COPY office ./office

EXPOSE 8787
ENV PYTHON=python3 \
    NODE_ENV=production

CMD ["node", "bot/index.js"]
