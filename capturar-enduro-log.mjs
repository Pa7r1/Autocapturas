// Captura a medida de "EnduroLog": SPA mobile-first navegada por una tab-bar de
// botones (Moto · Mantenim. · Suspensión · Checklists · Sesiones), sin URLs por
// pantalla. El crawler del motor no la recorre, así que este script loguea y
// clickea cada pestaña, capturando por viewport en output/ + manifest + galería.
//
// Uso: node capturar-enduro-log.mjs   (con EnduroLog levantado en localhost:5173)
import { chromium } from "playwright";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generarGaleria } from "./src/galeria.js";
import { iniciarSesion } from "./src/motor.js";
import config from "./config.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(RAIZ, config.outDir);
const BASE = "http://localhost:5173/";
const CRED = { etiqueta: "principal", usuario: "valentincarpio32@gmail.com", clave: "patrik166" };
const ROL = "principal";
const SETTLE = config.settleMs || 800;

const projName = "enduro-log";
const projSlug = "enduro-log";
const rolDir = path.join(OUTDIR, projSlug, ROL);
await rm(path.join(OUTDIR, projSlug), { recursive: true, force: true });
await mkdir(rolDir, { recursive: true });

const capturas = [];

async function settle(page) {
  await page.waitForTimeout(SETTLE);
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.evaluate(async () => {
      await new Promise((r) => { let y = 0; const t = setInterval(() => { window.scrollBy(0, 600); y += 600; if (y > document.body.scrollHeight) { clearInterval(t); r(); } }, 40); });
      window.scrollTo(0, 0);
    });
  } catch { /* da igual */ }
  await page.waitForTimeout(150);
}

async function cap(page, viewport, base, label) {
  const archivo = `${base}--${viewport}.png`;
  try {
    await settle(page);
    await page.screenshot({ path: path.join(rolDir, archivo), fullPage: true, animations: "disabled" });
    capturas.push({ archivo: `${projSlug}/${ROL}/${archivo}`, label, viewport, ruta: "/", rol: ROL, ok: true });
    console.log(`  ✓ ${label} (${viewport})`);
  } catch (e) {
    capturas.push({ archivo: `${projSlug}/${ROL}/${archivo}`, label, viewport, ruta: "/", rol: ROL, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✗ ${label} (${viewport}): ${e.message.split("\n")[0]}`);
  }
}

// Secciones = pestañas de la tab-bar. [texto del botón, slug archivo, label].
const TABS = [
  ["Moto", "moto", "Moto (inicio)"],
  ["Mantenim.", "mantenimiento", "Mantenimiento"],
  ["Suspensión", "suspension", "Suspensión"],
  ["Checklists", "checklists", "Checklists"],
  ["Sesiones", "sesiones", "Sesiones"],
];

async function recorrer(page, vp) {
  console.log(`\n— viewport ${vp} —`);
  await iniciarSesion(page, { url: "/login" }, CRED, BASE);
  await page.waitForTimeout(1500);
  for (const [texto, base, label] of TABS) {
    try {
      await page.getByRole("button", { name: new RegExp("^" + texto.replace(".", "\\.") + "$", "i") }).first().click({ timeout: 6000 });
    } catch (e) {
      console.log(`  (no pude abrir ${texto}: ${e.message.split("\n")[0]})`);
    }
    await cap(page, vp, base, label);
  }
}

const browser = await chromium.launch();
try {
  for (const v of config.viewports) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await recorrer(page, v.name);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// Manifest: reemplazar solo la entrada de enduro-log (preservar el resto), galería.
const manifestPath = path.join(OUTDIR, "manifest.json");
let manifest = { generadoEn: null, proyectos: [] };
if (existsSync(manifestPath)) { try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* nuevo */ } }
manifest.proyectos = (manifest.proyectos || []).filter((p) => p.slug !== projSlug);
manifest.proyectos.push({ name: projName, slug: projSlug, capturas });
manifest.generadoEn = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await generarGaleria(config);

const ok = capturas.filter((c) => c.ok).length;
console.log(`\nTotal: ${ok}/${capturas.length} capturas OK. Galería: ${path.join(OUTDIR, "gallery.html")}`);
