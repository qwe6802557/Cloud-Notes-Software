@echo off
chcp 65001 > nul
title 部署 囧人云笔记 到腾讯云 (1.15.171.111)

echo =======================================================
echo          囧人云笔记 腾讯云生产环境一键部署
echo =======================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-tencentyun.ps1" %*

echo.
pause
