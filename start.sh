#!/bin/sh
# Starts the local web server (with the DJI RC-N3 USB bridge on macOS) and the online rooms relay.
cd "$(dirname "$0")"
python3 serve.py 8765 &
python3 rooms.py 8766 &
echo "Drone Flight Simulator: http://localhost:8765"
trap 'kill 0' INT TERM
wait
