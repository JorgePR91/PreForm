# Script para ejecutar el build como administrador
# Requiere permisos de administrador para crear symlinks en Windows

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator"))
{
    Write-Host "Este script requiere permisos de administrador."
    Write-Host "Reintentando con permisos elevados..."
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "Ejecutando electron-builder como administrador..."
cd "e:\17. PRO_PROJ\preformat-scaffolding\preformat"
npm run build
