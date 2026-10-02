@echo off
rem Ring planner launcher: serves this folder on localhost and opens it in the browser.
rem Keep this window open while using the planner; close it to stop.
cd /d "%~dp0"
start "" http://localhost:5173
python -m http.server 5173 --bind 127.0.0.1
