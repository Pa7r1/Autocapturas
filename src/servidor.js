// Servidor local con el panel de control (npm start). HTTP nativo de Node, sin
// frameworks. Escucha solo en localhost: dispara capturas, sirve las imágenes y
// la galería, y expone la API del panel.

import http from "node:http";
import { readFile, writeFile, unlink, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { chromium } from "playwright";
import config from "../config.js";
import { capturarProyecto, slug, iniciarSesion } from "./motor.js";
import { descubrirRutas } from "./crawler.js";
import { generarGaleria } from "./galeria.js";

// Raíz del proyecto (este módulo vive en src/).
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(RAIZ, config.outDir);
const PUBLIC = path.join(RAIZ, "public");
const PUERTO = config.serverPort || 4800;
const CONFIG_JSON = path.resolve(RAIZ, "config.json");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const REVISION = path.join(OUT_DIR, "revision.json");
const JSON_TIPO = "application/json; charset=utf-8";

// Relee config.js fresco (saltea el cache de import con un query único). Así
// podés editar config.js y disparar la captura sin reiniciar el servidor.
async function cargarConfig() {
  const mod = await import("../config.js?v=" + Date.now());
  return mod.default;
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);

  try {
    // Panel de control
    if (req.method === "GET" && url.pathname === "/") {
      const cfg = await cargarConfig();
      return enviar(res, 200, "text/html; charset=utf-8", panel(cfg));
    }

    // Disparar captura. Recibe un body JSON: { slug, all, roles }.
    if (req.method === "POST" && url.pathname === "/capturar") {
      return await capturar(req, url, res);
    }

    // Config editable desde el panel.
    if (req.method === "GET" && url.pathname === "/api/config") {
      return await apiGetConfig(res);
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      return await apiPostConfig(req, res);
    }

    // Borrar una captura.
    if (req.method === "POST" && url.pathname === "/api/eliminar") {
      return await apiEliminar(req, res);
    }

    // Borrar TODAS las capturas (limpieza total de output/).
    if (req.method === "POST" && url.pathname === "/api/eliminar-todo") {
      return await apiEliminarTodo(req, res);
    }

    // Descargar las capturas elegidas como un .zip (PNG originales).
    if (req.method === "POST" && url.pathname === "/api/descargar-zip") {
      return await apiDescargarZip(req, res);
    }

    // Metadatos de revisión (selección, descripción, etiquetas).
    if (req.method === "GET" && url.pathname === "/api/revision") {
      return enviar(res, 200, JSON_TIPO, JSON.stringify(await leerJson(REVISION, {})));
    }
    if (req.method === "POST" && url.pathname === "/api/revision") {
      return await apiPostRevision(req, res);
    }

    // Exportar las capturas elegidas al repo del portfolio.
    if (req.method === "POST" && url.pathname === "/api/exportar") {
      return await apiExportar(req, res);
    }

    // Descubrir rutas automáticamente (crawl + sitemap).
    if (req.method === "POST" && url.pathname === "/api/descubrir") {
      return await apiDescubrir(req, res);
    }

    // Cualquier otra cosa: archivo estático dentro de output/
    return await servirEstatico(url.pathname, res);
  } catch (e) {
    enviar(res, 500, "text/plain; charset=utf-8", "Error: " + e.message);
  }
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`\nAutocapturas levantado en  http://localhost:${PUERTO}`);
  console.log("Abrí esa dirección en el navegador. Ctrl+C para cortar.\n");
});

// Junta el body de la request y lo parsea como JSON (o {} si no hay/está roto).
function leerBody(req) {
  return new Promise((resolve) => {
    let datos = "";
    req.on("data", (c) => (datos += c));
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// --- Captura: corre el motor (con los roles que mandó el panel) y regenera
//     la galería. Devuelve las capturas para mostrarlas como miniaturas. ----
async function capturar(req, url, res) {
  const cfg = await cargarConfig();
  const body = await leerBody(req);

  const all = url.searchParams.has("all") || body.all === true;
  const filtro = body.slug || url.searchParams.get("project");
  const roles = Array.isArray(body.roles) ? body.roles : [];

  const proyectos = all
    ? cfg.projects
    : cfg.projects.filter((p) => slug(p.name) === filtro);

  if (!proyectos.length) {
    return enviar(res, 404, "application/json; charset=utf-8",
      JSON.stringify({ ok: false, error: "Proyecto no encontrado" }));
  }

  const resultados = [];
  for (const p of proyectos) {
    console.log(`\n▶ ${p.name}`);
    const r = await capturarProyecto(p, cfg, { roles });
    console.log(`  Guardado en: ${r.dir}`);
    resultados.push({
      name: r.name,
      slug: r.slug,
      dir: r.dir,
      ok: r.ok,
      errores: r.errores,
      capturas: r.capturas,
    });
  }

  await generarGaleria(cfg);

  enviar(res, 200, "application/json; charset=utf-8",
    JSON.stringify({ ok: true, proyectos: resultados }));
}

// --- API de configuración: leer y guardar config.json ---------------------
async function apiGetConfig(res) {
  const cfg = await cargarConfig();
  const data = {
    viewports: cfg.viewports,
    fullPage: cfg.fullPage,
    settleMs: cfg.settleMs,
    serverPort: cfg.serverPort,
    exportDir: cfg.exportDir || "",
    exportSubdir: cfg.exportSubdir || "capturas",
    projects: cfg.projects,
  };
  enviar(res, 200, "application/json; charset=utf-8", JSON.stringify(data));
}

// Valida la config que llega del panel. Devuelve un string con el error o null.
function validarConfig(data) {
  if (!data || typeof data !== "object") return "Configuración inválida.";
  if (!Array.isArray(data.projects)) return "Falta la lista de proyectos.";
  for (const p of data.projects) {
    if (!p || typeof p.name !== "string" || !p.name.trim())
      return "Cada proyecto necesita un nombre.";
    if (typeof p.baseUrl !== "string" || !p.baseUrl.trim())
      return `El proyecto "${p.name}" necesita una URL base.`;
    if (!Array.isArray(p.routes) || !p.routes.length)
      return `El proyecto "${p.name}" necesita al menos una ruta.`;
    for (const r of p.routes) {
      if (!r || typeof r.path !== "string" || !r.path.trim())
        return `Hay una ruta sin "path" en "${p.name}".`;
    }
    if (p.login != null) {
      if (typeof p.login !== "object" || typeof p.login.url !== "string" || !p.login.url.trim())
        return `El login de "${p.name}" necesita la URL del formulario.`;
    }
  }
  if (!Array.isArray(data.viewports) || !data.viewports.length)
    return "Necesitás al menos un tamaño de pantalla (viewport).";
  for (const v of data.viewports) {
    if (!v || typeof v.name !== "string" || !v.name.trim())
      return "Cada viewport necesita un nombre.";
    if (!Number.isFinite(v.width) || !Number.isFinite(v.height) || v.width <= 0 || v.height <= 0)
      return `El viewport "${v.name || ""}" necesita ancho y alto válidos.`;
  }
  return null;
}

// Normaliza un proyecto que llega del panel a la forma que espera el motor.
function limpiarProyecto(p) {
  const proy = {
    name: String(p.name).trim(),
    baseUrl: String(p.baseUrl).trim(),
    secciones: !!p.secciones,
    routes: (p.routes || [])
      .filter((r) => r && typeof r.path === "string" && r.path.trim())
      .map((r) => ({ path: String(r.path).trim(), label: String(r.label || r.path).trim() })),
    login: null,
  };
  if (p.login && typeof p.login === "object" && p.login.url) {
    const l = { url: String(p.login.url).trim() };
    for (const k of ["userSel", "passSel", "submitSel", "exitoUrl"]) {
      if (p.login[k] && String(p.login[k]).trim()) l[k] = String(p.login[k]).trim();
    }
    proy.login = l;
  }
  return proy;
}

async function apiPostConfig(req, res) {
  const body = await leerBody(req);
  const error = validarConfig(body);
  if (error) {
    return enviar(res, 400, "application/json; charset=utf-8",
      JSON.stringify({ ok: false, error }));
  }
  // Guardamos solo los campos editables, normalizados.
  const limpio = {
    viewports: body.viewports.map((v) => ({
      name: String(v.name).trim(),
      width: Math.round(v.width),
      height: Math.round(v.height),
    })),
    fullPage: !!body.fullPage,
    settleMs: Number.isFinite(body.settleMs) ? Math.max(0, Math.round(body.settleMs)) : 800,
    serverPort: Number.isFinite(body.serverPort) ? Math.round(body.serverPort) : PUERTO,
    exportDir: typeof body.exportDir === "string" ? body.exportDir.trim() : "",
    exportSubdir: typeof body.exportSubdir === "string" && body.exportSubdir.trim()
      ? body.exportSubdir.trim().replace(/^\/+|\/+$/g, "")
      : "capturas",
    projects: body.projects.map(limpiarProyecto),
  };
  await writeFile(CONFIG_JSON, JSON.stringify(limpio, null, 2));
  console.log(`  ✓ Configuración guardada en ${CONFIG_JSON}`);
  // El puerto sólo aplica tras reiniciar (el server ya escucha en el viejo).
  enviar(res, 200, "application/json; charset=utf-8",
    JSON.stringify({ ok: true, reinicioPuerto: limpio.serverPort !== PUERTO }));
}

// --- Helpers de archivos JSON y rutas seguras ------------------------------
async function leerJson(ruta, porDefecto) {
  try {
    return JSON.parse(await readFile(ruta, "utf8"));
  } catch {
    return porDefecto;
  }
}

// Resuelve una ruta relativa dentro de OUT_DIR; null si se escapa (traversal).
function dentroDeOut(rel) {
  const destino = path.join(OUT_DIR, decodeURIComponent(rel).replace(/^\/+/, ""));
  return destino.startsWith(OUT_DIR) ? destino : null;
}

// --- Borrar una captura: archivo + manifest + revisión, y regenerar galería -
async function apiEliminar(req, res) {
  const body = await leerBody(req);
  const rel = typeof body.archivo === "string" ? body.archivo : "";
  const destino = rel && dentroDeOut(rel);
  if (!destino) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false, error: "Archivo inválido" }));
  }

  if (existsSync(destino)) {
    try { await unlink(destino); } catch { /* ya no estaba */ }
  }

  // Sacar la captura del manifest (y los proyectos que queden vacíos).
  const manifest = await leerJson(MANIFEST, { generadoEn: null, proyectos: [] });
  for (const p of manifest.proyectos || []) {
    p.capturas = (p.capturas || []).filter((c) => c.archivo !== rel);
  }
  manifest.proyectos = (manifest.proyectos || []).filter((p) => (p.capturas || []).length);
  manifest.generadoEn = new Date().toISOString();
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  // Sacar el metadato de revisión.
  const rev = await leerJson(REVISION, {});
  if (rev[rel]) {
    delete rev[rel];
    await writeFile(REVISION, JSON.stringify(rev, null, 2));
  }

  await generarGaleria(await cargarConfig());
  console.log(`  ✓ Borrada: ${rel}`);
  enviar(res, 200, JSON_TIPO, JSON.stringify({ ok: true }));
}

// --- Borrar TODAS las capturas: limpieza total de output/ -------------------
// Elimina todas las subcarpetas de proyecto dentro de output/ (incluidas
// sobrantes viejas), resetea manifest y revisión, y regenera la galería vacía.
// No toca manifest.json/revision.json/gallery.html (se reescriben/regeneran).
async function apiEliminarTodo(req, res) {
  let borradas = 0;
  let entradas = [];
  try {
    entradas = await readdir(OUT_DIR, { withFileTypes: true });
  } catch {
    entradas = []; // output/ no existe todavía: no hay nada que borrar
  }

  for (const ent of entradas) {
    if (!ent.isDirectory()) continue; // solo carpetas de proyecto
    const destino = dentroDeOut(ent.name); // guard anti-traversal
    if (!destino) continue;
    try {
      await rm(destino, { recursive: true, force: true });
      borradas++;
    } catch { /* ya no estaba */ }
  }

  // Resetear índices.
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    MANIFEST,
    JSON.stringify({ generadoEn: new Date().toISOString(), proyectos: [] }, null, 2)
  );
  await writeFile(REVISION, JSON.stringify({}, null, 2));

  await generarGaleria(await cargarConfig());
  console.log(`  ✓ Borradas todas las capturas (${borradas} carpeta/s).`);
  enviar(res, 200, JSON_TIPO, JSON.stringify({ ok: true, borradas }));
}

// --- Armar un .zip en memoria (sin dependencias) ----------------------------
// Tabla CRC-32 (estándar, polinomio 0xEDB88320). El formato ZIP exige el CRC
// del contenido sin comprimir de cada archivo.
const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

// Construye un Buffer con un .zip a partir de [{ nombre, datos: Buffer }].
// Usa deflate (método 8) vía zlib. Implementa lo mínimo del formato: cabecera
// local por archivo + directorio central + EOCD.
function crearZip(archivos) {
  const trozos = [];
  const central = [];
  let offset = 0;
  for (const { nombre, datos } of archivos) {
    const nombreBuf = Buffer.from(nombre, "utf8");
    const crc = crc32(datos);
    const comp = deflateRawSync(datos);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // firma local file header
    lfh.writeUInt16LE(20, 4);         // versión necesaria
    lfh.writeUInt16LE(0x0800, 6);     // flags: bit 11 = nombre en UTF-8
    lfh.writeUInt16LE(8, 8);          // método: deflate
    lfh.writeUInt16LE(0, 10);         // hora
    lfh.writeUInt16LE(0, 12);         // fecha
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(datos.length, 22);
    lfh.writeUInt16LE(nombreBuf.length, 26);
    lfh.writeUInt16LE(0, 28);         // largo de extra
    trozos.push(lfh, nombreBuf, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // firma central directory header
    cdh.writeUInt16LE(20, 4);         // versión que lo creó
    cdh.writeUInt16LE(20, 6);         // versión necesaria
    cdh.writeUInt16LE(0x0800, 8);     // flags UTF-8
    cdh.writeUInt16LE(8, 10);         // método deflate
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(datos.length, 24);
    cdh.writeUInt16LE(nombreBuf.length, 28);
    cdh.writeUInt16LE(0, 30);         // extra
    cdh.writeUInt16LE(0, 32);         // comentario
    cdh.writeUInt16LE(0, 34);         // disco
    cdh.writeUInt16LE(0, 36);         // atributos internos
    cdh.writeUInt32LE(0, 38);         // atributos externos
    cdh.writeUInt32LE(offset, 42);    // offset de la cabecera local
    central.push(Buffer.concat([cdh, nombreBuf]));

    offset += lfh.length + nombreBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);  // firma end of central directory
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(archivos.length, 8);
  eocd.writeUInt16LE(archivos.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...trozos, centralBuf, eocd]);
}

// --- Descargar las capturas elegidas como .zip (PNG originales) -------------
async function apiDescargarZip(req, res) {
  const body = await leerBody(req);
  const pedidos = Array.isArray(body.archivos) ? body.archivos : [];
  const archivos = [];
  for (const rel of pedidos) {
    if (typeof rel !== "string") continue;
    const abs = dentroDeOut(rel); // guard anti-traversal
    if (!abs || !existsSync(abs)) continue;
    try {
      archivos.push({ nombre: rel.replace(/^\/+/, ""), datos: await readFile(abs) });
    } catch { /* no se pudo leer: la salteamos */ }
  }
  if (!archivos.length) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false, error: "No hay capturas válidas para descargar" }));
  }
  const zip = crearZip(archivos);
  console.log(`  ✓ Zip generado: ${archivos.length} captura/s.`);
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="capturas-seleccionadas.zip"',
    "Content-Length": zip.length,
  });
  res.end(zip);
}

// --- Guardar metadatos de revisión (objeto { archivo: {sel,desc,etiquetas} }) -
async function apiPostRevision(req, res) {
  const body = await leerBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false, error: "Revisión inválida" }));
  }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(REVISION, JSON.stringify(body, null, 2));
  enviar(res, 200, JSON_TIPO, JSON.stringify({ ok: true }));
}

// --- Exportar al portfolio: optimiza a webp y copia al repo -----------------
// Optimiza un PNG a webp (full + thumbnail) usando el Chromium de Playwright
// (canvas → toDataURL), sin dependencias extra. Devuelve dos Buffers.
async function optimizarWebp(page, srcAbs, calidad, maxThumb) {
  const dataUrl = "data:image/png;base64," + (await readFile(srcAbs)).toString("base64");
  const r = await page.evaluate(async (args) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = args.dataUrl; });
    const dibujar = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/webp", args.calidad);
    };
    const w = img.naturalWidth, h = img.naturalHeight;
    const escala = Math.min(1, args.maxThumb / w);
    return { full: dibujar(w, h), thumb: dibujar(Math.round(w * escala), Math.round(h * escala)) };
  }, { dataUrl, calidad, maxThumb });
  return {
    full: Buffer.from(r.full.split(",")[1], "base64"),
    thumb: Buffer.from(r.thumb.split(",")[1], "base64"),
  };
}

async function apiExportar(req, res) {
  const cfg = await cargarConfig();
  const exportDir = (cfg.exportDir || "").trim();
  if (!exportDir) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false,
      error: "Configurá la carpeta del repo (exportDir) en ⚙ Configurar." }));
  }
  if (!existsSync(exportDir)) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false,
      error: "La carpeta del repo no existe: " + exportDir }));
  }
  const subdir = (cfg.exportSubdir || "capturas").replace(/^\/+|\/+$/g, "");
  const baseOut = path.join(exportDir, subdir);

  const manifest = await leerJson(MANIFEST, { proyectos: [] });
  const rev = await leerJson(REVISION, {});

  // Solo las elegidas (sel) que se capturaron OK.
  const elegidas = [];
  let total = 0;
  for (const p of manifest.proyectos || []) {
    const caps = (p.capturas || []).filter((c) => c.ok !== false && rev[c.archivo] && rev[c.archivo].sel);
    if (caps.length) { elegidas.push({ p, caps }); total += caps.length; }
  }
  if (!total) {
    return enviar(res, 400, JSON_TIPO, JSON.stringify({ ok: false,
      error: "No hay capturas elegidas para exportar." }));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const salida = { generadoEn: new Date().toISOString(), base: subdir, proyectos: [] };
  let copiadas = 0;
  try {
    for (const { p, caps } of elegidas) {
      const entrada = { slug: p.slug, nombre: p.name, capturas: [] };
      for (const c of caps) {
        const srcAbs = path.join(OUT_DIR, c.archivo);
        if (!existsSync(srcAbs)) continue;
        const relWebp = c.archivo.replace(/\.png$/i, ".webp");
        const relThumb = c.archivo.replace(/\.png$/i, ".thumb.webp");
        const { full, thumb } = await optimizarWebp(page, srcAbs, 0.82, 480);
        await mkdir(path.dirname(path.join(baseOut, relWebp)), { recursive: true });
        await writeFile(path.join(baseOut, relWebp), full);
        await writeFile(path.join(baseOut, relThumb), thumb);
        copiadas++;
        const meta = rev[c.archivo] || {};
        entrada.capturas.push({
          archivo: relWebp,
          thumb: relThumb,
          label: c.label,
          descripcion: (meta.desc || "").trim(),
          etiquetas: Array.isArray(meta.etiquetas) ? meta.etiquetas : [],
          rol: c.rol || "publico",
          viewport: c.viewport,
        });
      }
      salida.proyectos.push(entrada);
    }
  } finally {
    await browser.close();
  }

  // capturas.json (por slug) + capturas.md, dentro de la subcarpeta.
  await mkdir(baseOut, { recursive: true });
  await writeFile(path.join(baseOut, "capturas.json"), JSON.stringify(salida, null, 2));
  const md = salida.proyectos
    .map((pr) => {
      const items = pr.capturas
        .map((c) => {
          const linea = "![" + c.label + "](" + c.archivo + ")";
          return c.descripcion ? linea + "\n\n" + c.descripcion : linea;
        })
        .join("\n\n");
      return "## " + pr.nombre + "\n\n" + items;
    })
    .join("\n\n");
  await writeFile(path.join(baseOut, "capturas.md"), md + "\n");

  console.log(`  ✓ Exportadas ${copiadas} capturas a ${baseOut}`);
  enviar(res, 200, JSON_TIPO, JSON.stringify({ ok: true, copiadas, destino: baseOut }));
}

// --- Descubrir rutas del sitio (crawl same-origin + sitemap) ---------------
async function apiDescubrir(req, res) {
  const body = await leerBody(req);
  const cfg = await cargarConfig();
  const proj = (cfg.projects || []).find((p) => slug(p.name) === body.slug);
  if (!proj) {
    return enviar(res, 404, JSON_TIPO, JSON.stringify({ ok: false, error: "Proyecto no encontrado" }));
  }
  const roles = Array.isArray(body.roles) ? body.roles : [];
  const cred = roles.find((r) => r && r.usuario && r.clave);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Si el proyecto tiene login y nos pasaron credenciales, entramos primero
    // (así el crawl descubre también lo privado). Si falla, seguimos público.
    if (proj.login && cred) {
      try { await iniciarSesion(page, proj.login, cred, proj.baseUrl); } catch { /* sigue público */ }
    }
    const rutas = await descubrirRutas(page, proj.baseUrl, {});
    console.log(`  ✓ Descubiertas ${rutas.length} rutas en ${proj.name}`);
    enviar(res, 200, JSON_TIPO, JSON.stringify({ ok: true, rutas }));
  } catch (e) {
    enviar(res, 500, JSON_TIPO, JSON.stringify({ ok: false, error: e.message }));
  } finally {
    await browser.close();
  }
}

// --- Servir archivos estáticos de output/ (imágenes y gallery.html) --------
async function servirEstatico(pathname, res) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");

  // Primero buscamos en public/ (assets del front: panel.css, panel.js…),
  // después en output/ (capturas y gallery.html). Anti path-traversal en ambos.
  const enPublic = path.join(PUBLIC, rel);
  const enOut = path.join(OUT_DIR, rel);
  let destino = null;
  if (rel && enPublic.startsWith(PUBLIC) && existsSync(enPublic)) destino = enPublic;
  else if (enOut.startsWith(OUT_DIR) && existsSync(enOut)) destino = enOut;

  if (!destino) {
    return enviar(res, 404, "text/plain; charset=utf-8", "No encontrado");
  }

  const ext = path.extname(destino).toLowerCase();
  const tipo = TIPOS[ext] || "application/octet-stream";
  const datos = await readFile(destino);
  enviar(res, 200, tipo, datos);
}

function enviar(res, codigo, tipo, cuerpo) {
  res.writeHead(codigo, { "Content-Type": tipo });
  res.end(cuerpo);
}

// --- HTML del panel de control ---------------------------------------------
function panel(cfg) {
  // Config editable embebida para sembrar el editor sin pedirla aparte.
  const cfgEditable = JSON.stringify({
    viewports: cfg.viewports,
    fullPage: cfg.fullPage,
    settleMs: cfg.settleMs,
    serverPort: cfg.serverPort,
    exportDir: cfg.exportDir || "",
    exportSubdir: cfg.exportSubdir || "capturas",
    projects: cfg.projects,
  }).replace(/</g, "\\u003c");

  const tarjetas = cfg.projects
    .map((p) => {
      const s = slug(p.name);
      const nrutas = (p.routes || []).length;
      const tieneLogin = !!p.login;
      return `<article class="proy" data-slug="${esc(s)}" data-login="${tieneLogin ? "1" : "0"}">
        <div class="cab">
          <div class="info">
            <h3>${esc(p.name)}</h3>
            <p class="meta mono">${esc(p.baseUrl)} · ${nrutas} ruta${nrutas === 1 ? "" : "s"}${tieneLogin ? " · con login" : ""}</p>
          </div>
          <div class="acciones-proy">
            <button class="descubrir" type="button">🔎 Descubrir rutas</button>
            <button class="toggle">Capturar</button>
          </div>
        </div>
        <form class="creds" hidden>
          ${tieneLogin
            ? `<label class="publico"><input type="checkbox" class="esPublico"> Capturar sin login (público)</label>
          <p class="ayuda">Agregá un juego de credenciales por cada rol que quieras capturar (ej. común y administrador).</p>
          <div class="roles"></div>
          <button type="button" class="addRol">＋ agregar rol</button>`
            : `<p class="ayuda">Este proyecto no tiene login configurado: se captura como público.</p>`}
          <div class="lanzarBarra">
            <button type="submit" class="lanzar primario">Capturar ahora</button>
          </div>
        </form>
        <div class="resultado" hidden></div>
      </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Panel · Autocapturas</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/panel.css">
</head>
<body>
<header>
  <h1>auto<span class="punto">·</span>capturas</h1>
  <button id="abrirEditor">⚙ Configurar</button>
  <a href="/gallery.html" target="_blank">Abrir galería →</a>
</header>
<main>
  <section id="editor" class="editor" hidden></section>
  <p class="intro">Elegí un proyecto y dispará la captura. Asegurate de tener el proyecto levantado en la URL configurada. Las imágenes se guardan en <span class="mono">${esc(OUT_DIR)}</span>. Para crear o editar proyectos y ajustes, usá <b>⚙ Configurar</b>.</p>
  <div class="barra">
    <button id="todos">Capturar todos (público)</button>
    <button id="borrarTodo" class="peligro" type="button">🗑 Borrar todas las capturas</button>
  </div>
  ${tarjetas}
</main>

<script id="cfgDatos" type="application/json">${cfgEditable}</script>

<script src="/panel.js"></script>
</body>
</html>
`;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
