#!/bin/bash
# Скрипт первого запуска сервера (Ubuntu 24.04) для бота закупок.
# Вставьте его целиком в поле «Скрипт при создании / cloud-init / user-data» в панели Timeweb,
# либо выполните на сервере: bash server-setup.sh
#
# Что делает: ставит Docker, скачивает проект, создаёт файл настроек .env.bot,
# а если токен и chat id заполнены ниже, сразу запускает бота.
# Журнал работы скрипта: /var/log/bot-setup.log
#
# ВАЖНО: токен ниже сохранится в панели хостинга в открытом виде. Надёжнее оставить TOKEN пустым,
# зайти на сервер по ssh, вписать токен в /opt/montazhpro/.env.bot и выполнить запуск (см. конец журнала).

TOKEN=""            # токен бота от @BotFather (получите НОВЫЙ после /revoke)
CHAT_ID=""          # ваш chat id (бот покажет его по команде /start), например 799283726
ANTHROPIC_KEY=""    # необязательно: ключ Anthropic для разбора товара ИИ

REPO="https://github.com/marlen-ai112/MontazhPro"
BRANCH="claude/ai-agent-vtido4"
DIR="/opt/montazhpro"

exec > >(tee -a /var/log/bot-setup.log) 2>&1
set -u
echo "=== $(date) начало настройки ==="
export DEBIAN_FRONTEND=noninteractive

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl git ca-certificates
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
command -v git >/dev/null 2>&1 || apt-get install -y git

# 2. Проект
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout "$BRANCH" && git -C "$DIR" pull --ff-only origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$DIR" || { echo "ОШИБКА: не удалось скачать $REPO (репозиторий закрытый?). Нужно сделать его публичным или скачать вручную."; exit 1; }
fi
cd "$DIR" || exit 1

# 3. Настройки бота (файл не попадает в git)
if [ ! -f .env.bot ]; then
  cp bot/env.docker.example .env.bot
  [ -n "$TOKEN" ] && sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TOKEN|" .env.bot
  [ -n "$CHAT_ID" ] && sed -i "s|^ALLOWED_CHAT_IDS=.*|ALLOWED_CHAT_IDS=$CHAT_ID|" .env.bot
  [ -n "$ANTHROPIC_KEY" ] && echo "ANTHROPIC_API_KEY=$ANTHROPIC_KEY" >> .env.bot
  chmod 600 .env.bot
fi

# 4. Запуск (только если токен и chat id уже заполнены)
if grep -q '^TELEGRAM_BOT_TOKEN=[0-9]' .env.bot && grep -q '^ALLOWED_CHAT_IDS=[0-9]' .env.bot; then
  docker compose up -d --build && echo "Бот запущен. Логи: cd $DIR && docker compose logs -f bot"
else
  echo "Сервер подготовлен. Осталось вписать токен и chat id:"
  echo "  nano $DIR/.env.bot"
  echo "  cd $DIR && docker compose up -d --build"
fi
echo "=== $(date) конец ==="
