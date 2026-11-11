# Revisor de pósters · Genética y Salud

Página para que los estudiantes suban su póster y reciban retroalimentación formativa según la rúbrica.

## Variables de entorno
- `ANTHROPIC_API_KEY` (obligatoria): clave de API de Anthropic. Nunca va en el código.
- `ACCESS_CODE`: código que los estudiantes escriben para entrar. Si no se define, la página queda abierta.
- `MODEL` (opcional, por defecto `claude-sonnet-5-5`).
- `DAILY_LIMIT` (opcional, por defecto 5 revisiones por IP al día).

## Ejecutar localmente
    export ANTHROPIC_API_KEY=tu_clave
    export ACCESS_CODE=codigo_para_estudiantes
    npm start

Luego abre http://localhost:3000.

## Publicar en Render
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render, crea un "Web Service" desde ese repositorio (o usa render.yaml como Blueprint).
3. En "Environment", agrega `ANTHROPIC_API_KEY` y `ACCESS_CODE`.
4. Render entrega una URL pública: esa es el link para tus estudiantes.
