# Autocapturas

Herramienta para sacar screenshots de mis proyectos web y elegir cuáles van al
portfolio. Recorre cada proyecto, captura sus pantallas en escritorio y móvil, y
arma una galería local donde marco las que me gustan, les pongo descripción y las
exporto listas para el portfolio.

Funciona solo con proyectos web (locales o desplegados). Maneja un navegador, no
el sistema, así que apps de escritorio o Android quedan afuera.

## Requisitos

- Node.js 18 o superior.
- Linux (probado ahí; el navegador lo trae Playwright).

## Instalación

```bash
npm install
npx playwright install chromium        # descarga el navegador
npx playwright install-deps chromium   # librerías del sistema (pide sudo)
```

## Cómo lanzarlo

Levantar el panel:

```bash
npm start
```

Y abrir http://localhost:4800 en el navegador.

También se puede capturar directo por línea de comandos:

```bash
npm run capture                    # captura todos los proyectos del config
npm run capture -- "Nombre"        # captura uno por nombre
```

Antes de capturar, asegurate de tener el proyecto levantado en la URL que
configuraste (por ejemplo `http://localhost:5173`).

## Cómo se usa

1. **Configurar.** En el panel, botón Configurar. Ahí se crean y editan los
   proyectos (nombre, URL base, rutas, login opcional) y los ajustes (tamaños de
   pantalla, puerto, carpeta de export). Se puede usar "Descubrir rutas" para que
   recorra el sitio y proponga las páginas. La configuración se guarda en
   `config.json`.
2. **Capturar.** Desde el panel se dispara la captura de un proyecto o de todos.
   Las imágenes quedan en `output/<proyecto>/<rol>/`.
3. **Revisar.** En la galería (botón "Abrir galería") se ven todas las capturas
   agrupadas por proyecto. Se pueden marcar/desmarcar (de a una o todas), escribir
   una descripción y etiquetas, y borrar las que no sirven.
4. **Descargar o exportar.**
   - "Descargar seleccionadas" baja un `.zip` con los PNG originales (para
     editarlos antes de subirlos).
   - "Exportar al portfolio" copia las elegidas, optimizadas a webp, dentro del
     repo del portfolio, y genera un `capturas.json` y un `capturas.md`. Para esto
     hay que configurar la carpeta del repo en Configurar.

## Login y roles

Si un proyecto necesita login, en la configuración solo se describe dónde está el
formulario (los selectores son opcionales: si faltan, se intentan detectar). Las
credenciales no se guardan en el repo: se cargan en el panel al momento de
capturar, y se puede capturar con varios roles (por ejemplo usuario común y
administrador), cada uno en su subcarpeta.

## Configuración

- `config.js` trae los valores por defecto y un proyecto de ejemplo. Sirve como
  semilla.
- `config.json` es la configuración real, la que escribe el panel. Pisa a
  `config.js` y no se versiona (queda en tu máquina).

## Estructura

```
config.js          valores por defecto / semilla
src/
  motor.js         motor de capturas (Playwright)
  crawler.js       descubrimiento de rutas y secciones
  galeria.js       genera la galería HTML
  servidor.js      servidor local + API del panel
public/
  panel.js         lógica del panel
  panel.css        estilos del panel
output/            capturas, manifest y galería (generado)
```
