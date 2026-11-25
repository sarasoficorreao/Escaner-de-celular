# FolioScan — Escáner de Documentos a PDF (100% Gratuito y Privado)

Aplicación web gratuita tipo CamScanner que funciona directamente en tu navegador, sin servidores, sin cuentas, sin marcas de agua y sin APIs de pago. Todo el procesamiento se ejecuta en tu propio dispositivo para que tus documentos y datos personales nunca salgan de él.

## Funciones principales

- **Cámara y galería**: Toma fotos directamente con la cámara del móvil/PC o sube múltiples imágenes a la vez.
- **Encuadre automático y corrección de perspectiva**: Detecta las 4 esquinas del documento y permite ajustarlas con una lupa de precisión para enderezar la hoja.
- **Filtros deterministas (sin alterar tus datos)**:
  - **Color Mágico**: Elimina sombras y aclara el papel manteniendo los colores y sellos nítidos.
  - **Documento Claro**: Blanqueado suave para conservar tonos naturales y firmas.
  - **Blanco y Negro**: Alto contraste tipo fotocopia limpia para máxima legibilidad de texto.
  - **Escala de Grises** y **Original**.
- **PDF multipágina y envío directo**: Reordena páginas, elige tamaño (**A4**, **Carta** o **Ajustado**) y calidad, y descarga o comparte el PDF directamente a WhatsApp, correo o Telegram.

## Desplegar gratis en GitHub Pages

1. Sube este proyecto a un repositorio en tu cuenta de **GitHub** (rama `main`).
2. En tu repositorio de GitHub, ve a **Settings → Pages**.
3. En **Build and deployment → Source**, selecciona **GitHub Actions**.
4. Cada vez que hagas `push` a `main` (o ejecutes el workflow manualmente en la pestaña **Actions**), GitHub compilará la app automáticamente con `.github/workflows/deploy.yml` y la publicará con **HTTPS gratuito** (necesario para usar la cámara desde el celular).

## Uso en local

```bash
npm install
npm run dev
```

Para generar la carpeta estática lista para subir a cualquier hosting gratuito:

```bash
npm run build
```
