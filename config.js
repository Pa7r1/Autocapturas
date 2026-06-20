// Valores por defecto y semilla de la configuración.
// Lo normal es editar todo desde el panel (npm start → Configurar), que guarda
// en config.json. Si config.json existe, sus valores pisan a los de acá.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORDEFECTO = {
  // Carpeta de salida (capturas y galería), relativa a este archivo.
  outDir: "output",

  // Tamaños a capturar. Se usa un navegador por cada uno. `name` aparece en el
  // nombre del archivo y como badge en la galería.
  viewports: [
    { name: "escritorio", width: 1440, height: 900 },
    { name: "movil", width: 390, height: 844 },
  ],

  // true = página entera (scroll completo); false = solo lo visible.
  fullPage: true,

  // Espera fija tras cargar la página, para que se asienten animaciones,
  // fuentes e imágenes. No usamos networkidle: los dev servers con hot-reload
  // dejan un websocket abierto y nunca se "calma".
  settleMs: 800,

  // Puerto del servidor local con el panel (npm start).
  serverPort: 4800,

  // Exportar al portfolio: carpeta del repo local del portfolio y subcarpeta
  // donde se copian las capturas elegidas (optimizadas a webp). Se configuran
  // desde el panel. Ej: exportSubdir "public/capturas".
  exportDir: "",
  exportSubdir: "capturas",

  // Proyectos a capturar. Uno por cada proyecto web.
  projects: [
    {
      // Nombre legible. Define la carpeta: output/<nombre-en-slug>/
      name: "Proyecto de ejemplo",

      // URL base donde está levantado el proyecto (con su puerto).
      baseUrl: "http://localhost:5173/",

      // Login opcional. null si el proyecto no lo necesita. Las credenciales NO
      // van acá: se cargan en el panel. Acá solo se describe dónde está el
      // formulario; todos los selectores son opcionales (si faltan se auto-detectan).
      // Ejemplo:
      // login: {
      //   url: "/login",
      //   userSel: 'input[name="email"]',
      //   passSel: 'input[type="password"]',
      //   submitSel: 'button[type="submit"]',
      //   exitoUrl: "**/dashboard",
      // },
      login: null,

      // Pantallas a capturar. `path` se pega a baseUrl; `label` es el nombre
      // que se muestra en la galería.
      routes: [
        { path: "/", label: "Inicio" },
        { path: "/about", label: "Acerca de" },
      ],
    },
  ],
};

// Si existe config.json (lo escribe el panel), sus campos pisan los de acá.
// outDir se mantiene siempre desde este archivo.
let guardado = {};
const rutaJson = path.join(__dirname, "config.json");
if (existsSync(rutaJson)) {
  try {
    guardado = JSON.parse(readFileSync(rutaJson, "utf8"));
  } catch {
    // config.json roto: lo ignoramos y seguimos con los valores por defecto.
  }
}

export default { ...PORDEFECTO, ...guardado, outDir: PORDEFECTO.outDir };
