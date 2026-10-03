#!/bin/zsh
# Çift tıkla: sunucuyu (kumanda köprüsüyle) başlatır ve Safari'de açar.
cd "$(dirname "$0")"
PORT=8765
if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 serve.py $PORT >/dev/null 2>&1 &
  sleep 0.7
fi
# online odalar (aynı yerde uçan pilotlar birbirini görür)
if ! lsof -nP -iTCP:8766 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 rooms.py 8766 >/dev/null 2>&1 &
fi
open -a Safari "http://localhost:$PORT/"
