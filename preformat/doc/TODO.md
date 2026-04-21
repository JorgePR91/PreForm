- ~Conservar las partidas guardadas de juegos~
- ~Eliminar los archivos basura de WLS~
- Guardar el estado pre formateo en un usb para su posterior concatenación al programa al instalar
- Auditoria de qué está instalado en el sistema después de formatear

# Reconstruir
npm run build

# Comprimir (nuevo nombre de archivo)
Compress-Archive -Path dist-manual\PreFormat-1.0.0 `
  -DestinationPath PreFormat-v1.0.1.zip

# Tag y release
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1

gh release create v1.0.1 PreFormat-v1.0.1.zip --title "PreFormat v1.0.1"