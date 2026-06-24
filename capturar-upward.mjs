// Captura a medida de "upward": una SPA con estado (resetea el onboarding en
// cada login y navega por botones, sin URLs hasta estar onboardeada). El motor
// genérico no puede recorrerla, así que este script reproduce el flujo completo
// por viewport y escribe las capturas en output/ + manifest + galería.
//
// Uso: node capturar-upward.mjs   (con la app levantada en localhost:5173)
import { chromium } from "playwright";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generarGaleria } from "./src/galeria.js";
import { slug } from "./src/motor.js";
import config from "./config.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(RAIZ, config.outDir);
const BASE = "http://localhost:5173/";
const EMAIL = "dev@upward.app";
const PASS = "upward123";
const ROL = "comun";
const SETTLE = config.settleMs || 800;

const projSlug = "upward";
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

async function cap(page, viewport, base, label, ruta) {
  const archivo = `${base}--${viewport}.png`;
  try {
    await settle(page);
    await page.screenshot({ path: path.join(rolDir, archivo), fullPage: true, animations: "disabled" });
    capturas.push({ archivo: `${projSlug}/${ROL}/${archivo}`, label, viewport, ruta, rol: ROL, ok: true });
    console.log(`  ✓ ${label} (${viewport})`);
  } catch (e) {
    capturas.push({ archivo: `${projSlug}/${ROL}/${archivo}`, label, viewport, ruta, rol: ROL, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✗ ${label} (${viewport}): ${e.message.split("\n")[0]}`);
  }
}

const btn = (page, re) => page.getByRole("button", { name: re }).first();
async function clickBtn(page, re, t = 6000) { const b = btn(page, re); await b.waitFor({ state: "visible", timeout: t }); await b.click(); }

async function recorrer(page, vp) {
  console.log(`\n— viewport ${vp} —`);

  // 1) Onboarding intro (deslogueado): recorrer el carrusel paso a paso.
  await page.goto(new URL("/onboarding", BASE).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(800);
  for (let i = 1; i <= 8; i++) {
    if (!/onboarding/.test(page.url())) break;
    await cap(page, vp, `onboarding-intro-${i}`, `Onboarding intro ${i}`, "/onboarding");
    const cont = btn(page, /^continuar$/i);
    if (!(await cont.count())) break;       // llegó a un paso con formulario u otro CTA
    await cont.click().catch(() => {});
    await page.waitForTimeout(900);
  }

  // 2) Auth (deslogueado): email y, al tipearlo, aparece el paso de contraseña.
  await page.goto(new URL("/auth?mode=login", BASE).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(700);
  await cap(page, vp, "auth-email", "Entrar · email", "/auth");
  const email = page.locator("#Email, input[type=email]").first();
  await email.click();
  await email.pressSequentially(EMAIL, { delay: 22 });
  await page.waitForSelector("input[type=password]", { timeout: 6000 });
  await cap(page, vp, "auth-password", "Entrar · contraseña", "/auth");
  await page.locator("input[type=password]").first().fill(PASS);
  await clickBtn(page, /^entrar$/i);
  await page.waitForTimeout(2200);

  // 3) Onboarding identidad (logueado).
  await cap(page, vp, "onboarding-identidad", "Crear identidad", "/onboarding");
  await page.locator("textarea").first().fill("Hace ejercicio cada mañana y lee 20 minutos").catch(() => {});
  await clickBtn(page, /crear mi identidad/i);
  await page.waitForTimeout(1300);
  await cap(page, vp, "onboarding-identidad-lista", "Identidad lista", "/onboarding");
  await clickBtn(page, /prefiero hacerlo yo/i, 6000);
  await page.waitForTimeout(1500);

  // 4) Wizard de hábito (4 pasos).
  await page.locator("input[type=text]").first().fill("Hacer ejercicio").catch(() => {});
  await page.locator("select").first().selectOption({ index: 1 }).catch(() => {});
  await page.waitForTimeout(300);
  await clickBtn(page, /sugerirme un h.bito completo/i, 6000).catch(() => {});
  await page.waitForTimeout(2200);
  const pasosHabito = ["habito-1-el-habito", "habito-2-la-senal", "habito-3-facilitalo", "habito-4-recompensa"];
  const labelsHabito = ["Hábito · el hábito", "Hábito · la señal", "Hábito · facilitalo", "Hábito · la recompensa"];
  for (let i = 0; i < pasosHabito.length; i++) {
    await cap(page, vp, pasosHabito[i], labelsHabito[i], "/habits/new");
    // En "Facilitalo" elegir una dificultad si hace falta.
    const dif = btn(page, /low requiere poco esfuerzo/i);
    if (await dif.count()) await dif.click().catch(() => {});
    const avanzar = btn(page, /^siguiente$|crear h.bito/i);
    if (!(await avanzar.count())) break;
    await avanzar.click().catch(() => {});
    await page.waitForTimeout(1300);
    if (!/habits\/new/.test(page.url())) break;
  }
  await page.waitForTimeout(1000);

  // 5) Secciones principales (ya onboardeado, URLs reales).
  for (const [ruta, base, label] of [
    ["/today", "today", "Hoy"],
    ["/identity", "identity", "Identidad"],
    ["/habits", "habits", "Hábitos"],
    ["/progress", "progress", "Progreso"],
  ]) {
    await page.goto(new URL(ruta, BASE).href, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1200);
    await cap(page, vp, base, label, ruta);
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

// Manifest: reemplazar solo la entrada de upward, regenerar galería.
const manifestPath = path.join(OUTDIR, "manifest.json");
let manifest = { generadoEn: null, proyectos: [] };
if (existsSync(manifestPath)) { try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* nuevo */ } }
manifest.proyectos = (manifest.proyectos || []).filter((p) => p.slug !== projSlug);
manifest.proyectos.push({ name: "UPWARD", slug: projSlug, capturas });
manifest.generadoEn = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await generarGaleria(config);

const ok = capturas.filter((c) => c.ok).length;
console.log(`\nTotal: ${ok}/${capturas.length} capturas OK. Galería: ${path.join(OUTDIR, "gallery.html")}`);
void slug;
