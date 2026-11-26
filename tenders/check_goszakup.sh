#!/bin/sh
# Проверка доступа к goszakup.gov.kz без браузера: время ответа, размер страницы и число объявлений.
# Запуск на сервере: sh tenders/check_goszakup.sh
B="https://goszakup.gov.kz/ru/search/announce"
check() {
  name="$1"; url="$2"
  r=$(curl -sL -m 120 -A "Mozilla/5.0" -o /tmp/gz_check.html -w "HTTP %{http_code}, %{time_total} с, %{size_download} байт, конечный адрес: %{url_effective}" "$url" 2>&1)
  n=$(grep -c "Лотов:" /tmp/gz_check.html 2>/dev/null)
  echo "== $name"
  echo "   $r"
  echo "   объявлений в ответе (строки «Лотов:»): ${n:-0}"
}
check "1) без фильтров" "$B"
check "2) только способ и товар" "$B?filter%5Bmethod%5D%5B%5D=3&filter%5Btrade_type%5D=g"
check "3) все фильтры (как в боте)" "$B?filter%5Bmethod%5D%5B%5D=3&filter%5Btrade_type%5D=g&filter%5Bamount_from%5D=1500000&filter%5Bamount_to%5D=5000000&filter%5Bsigns%5D%5B%5D=is_active"
