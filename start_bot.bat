@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist bot\env.bat (
  echo Создайте файл bot\env.bat по образцу bot\env.example.bat и запустите снова.
  pause
  exit /b 1
)
call bot\env.bat

:loop
echo Запуск бота...
node bot\index.js
echo Бот остановился. Перезапуск через 10 секунд (закройте окно, чтобы выйти)...
timeout /t 10 >nul
goto loop
