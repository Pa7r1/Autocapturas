// Motor de capturas. Se usa por CLI (npm run capture [nombre]) o importando
// capturarProyecto/capturarTodos desde el servidor.

import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../config.js";
import { detectarSecciones, descubrirRutas } from "./crawler.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Texto a nombre seguro para archivos: sin acentos, minúsculas, a-z0-9 y guiones.
export function slug(texto) {
  const s = String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "x";
}

function dirSalida(cfg) {
  return path.resolve(RAIZ, cfg.outDir);
}

// Reemplaza en el manifest solo la entrada del proyecto dado, sin tocar el resto.
async function actualizarManifest(cfg, entrada) {
  const ruta = path.join(dirSalida(cfg), "manifest.json");
  let manifest = { generadoEn: null, proyectos: [] };
  if (existsSync(ruta)) {
    try {
      manifest = JSON.parse(await readFile(ruta, "utf8"));
    } catch {
      // manifest corrupto: arrancamos de cero sin romper la corrida
    }
  }
  manifest.proyectos = (manifest.proyectos || []).filter(
    (p) => p.slug !== entrada.slug
  );
  manifest.proyectos.push(entrada);
  manifest.generadoEn = new Date().toISOString();
  await writeFile(ruta, JSON.stringify(manifest, null, 2));
}

// Login con la config del proyecto y las credenciales del rol. Los selectores
// son opcionales (si faltan se auto-detectan los campos típicos). Usa timeouts
// para que un login mal configurado no cuelgue la corrida.
export async function iniciarSesion(page, loginCfg, cred, baseUrl) {
  const loginUrl = new URL(loginCfg.url || "/", baseUrl).href;
  await page.goto(loginUrl, { waitUntil: "load", timeout: 30000 });

  // Campos: primero el selector configurado (si hay), después la auto-detección.
  const userDefault =
    'input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[type="text"]';
  const passDefault = 'input[type="password"]';

  if (!(await rellenarCampo(page, [loginCfg.userSel, userDefault], cred.usuario)))
    throw new Error("No encontré el campo de usuario/email en el formulario.");
  if (!(await rellenarCampo(page, [loginCfg.passSel, passDefault], cred.clave)))
    throw new Error("No encontré el campo de contraseña en el formulario.");

  // Enviar: botón configurado, auto-detección, o Enter en la contraseña.
  const submitDefault =
    'button[type="submit"], input[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar"), button:has-text("Iniciar"), button:has-text("Log in"), button:has-text("Sign in")';
  const urlAntes = page.url();
  if (!(await clickPrimero(page, [loginCfg.submitSel, submitDefault]))) {
    await page.locator(passDefault).first().press("Enter").catch(() => {});
  }

  // Esperar a que el login termine. Si hay exitoUrl, la usamos. Si no, esperamos
  // a que la URL cambie (redirección al dashboard): cubre logins asíncronos de
  // SPAs (NextAuth/Auth.js, etc.) que no disparan un 'load' nuevo. NO usamos solo
  // 'load' porque en una SPA resuelve al instante y seguiríamos sin loguear.
  if (loginCfg.exitoUrl) {
    await page.waitForURL(loginCfg.exitoUrl, { timeout: 15000 }).catch(() => {});
  } else {
    await page.waitForURL((u) => u.href !== urlAntes, { timeout: 12000 }).catch(() => {});
  }
  await page.waitForTimeout(1000); // settle: que se asiente la sesión/redirección

  // Si no redirigió Y seguimos viendo el formulario (campo de contraseña), lo más
  // probable es credenciales incorrectas: lo marcamos para que se vea en consola.
  if (!loginCfg.exitoUrl && page.url() === urlAntes) {
    const sigueEnForm = await page.locator(passDefault).first().count().catch(() => 0);
    if (sigueEnForm) {
      throw new Error("el login no avanzó: ¿credenciales incorrectas? (o configurá 'URL de éxito')");
    }
  }
}

// Prueba selectores en orden y rellena el primero que exista. Tolera selectores
// inválidos (los saltea) para que una mala config no rompa todo el login.
async function rellenarCampo(page, selectores, valor) {
  for (const sel of selectores) {
    if (!sel) continue;
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.fill(valor, { timeout: 10000 });
        return true;
      }
    } catch {
      /* selector inválido o no rellenable: probamos el siguiente */
    }
  }
  return false;
}

// Igual que rellenarCampo pero hace click en el primer selector que exista.
async function clickPrimero(page, selectores) {
  for (const sel of selectores) {
    if (!sel) continue;
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.click({ timeout: 10000 });
        return true;
      }
    } catch {
      /* probamos el siguiente */
    }
  }
  return false;
}

// Deja la página lista para una captura fiel de páginas largas: espera fuentes,
// hace auto-scroll (dispara lazy-load y animaciones al scroll) y vuelve al tope.
// Sin esto, fullPage sale cortado o en blanco.
async function prepararPagina(page, cfg) {
  // Esperar a que carguen las fuentes (evita reflow tras la foto).
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

  await page
    .evaluate(async () => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

      // Forzar scroll instantáneo: con `scroll-behavior: smooth` el scrollBy se
      // anima/encola y el auto-scroll no llega de verdad al fondo.
      const estilo = document.createElement("style");
      estilo.setAttribute("data-autocapturas", "");
      estilo.textContent =
        "html, body, * { scroll-behavior: auto !important; }";
      document.head.appendChild(estilo);

      const alto = () =>
        Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        );

      // Auto-scroll guiado por scrollY real (no por contador), esperando frames
      // en cada paso para que disparen los reveals (IntersectionObserver) y el
      // lazy-load. Recalcula el alto porque la página puede crecer.
      const paso = Math.max(200, Math.floor(window.innerHeight * 0.85));
      for (let i = 0; i < 80; i++) {
        const antes = window.scrollY;
        window.scrollBy(0, paso);
        await frame();
        await frame();
        await dormir(120);
        // ¿Llegamos al fondo? (con margen de 2px) o ¿ya no avanza el scroll?
        if (window.scrollY + window.innerHeight >= alto() - 2) break;
        if (window.scrollY <= antes) break; // no scrollea más (tope real)
      }

      // Esperar a que carguen las imágenes (incluido el lazy-load), con tope.
      const imgs = Array.from(document.images || []).filter((im) => !im.complete);
      await Promise.race([
        Promise.all(
          imgs.map(
            (im) =>
              new Promise((res) => {
                im.addEventListener("load", res, { once: true });
                im.addEventListener("error", res, { once: true });
              })
          )
        ),
        dormir(3000),
      ]);

      // Desanclar elementos fijos/pegajosos: en una captura fullPage los
      // position:fixed quedan "flotando" en el medio y tapan el contenido. Los
      // pasamos a absolute; haciendo `body` posicionado, un header (top:0) queda
      // arriba y una barra (bottom:0) al fondo REAL del documento, no a una
      // pantalla de altura. Los sticky pasan a static (quedan en su lugar).
      let huboFijos = false;
      document.querySelectorAll("body *").forEach((el) => {
        const pos = getComputedStyle(el).position;
        if (pos === "fixed") { el.style.setProperty("position", "absolute", "important"); huboFijos = true; }
        else if (pos === "sticky") el.style.setProperty("position", "static", "important");
      });
      if (huboFijos && getComputedStyle(document.body).position === "static") {
        document.body.style.setProperty("position", "relative", "important");
      }

      // Volver al tope y sacar el estilo temporal.
      window.scrollTo(0, 0);
      estilo.remove();
    })
    .catch(() => {});

  // Dejar asentar (fuentes, imágenes, animaciones) antes de la foto.
  await page.waitForTimeout(cfg.settleMs);
}

// Une dos listas de rutas sin duplicar por path (configuradas primero).
function unirRutas(configuradas, descubiertas) {
  const vistas = new Set();
  const out = [];
  for (const r of [...(configuradas || []), ...(descubiertas || [])]) {
    if (!r || vistas.has(r.path)) continue;
    vistas.add(r.path);
    out.push(r);
  }
  return out;
}

// Abre un contexto, loguea (si corresponde) y descubre las rutas del sitio
// navegando desde la página de aterrizaje. Devuelve [{ path, label }]; vacío si
// algo falla. Siembra el crawl con las rutas ya configuradas en el proyecto.
async function descubrirParaRol(browser, project, rol, hayLogin) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let rutas = [];
  try {
    let base = project.baseUrl;
    if (hayLogin) {
      await iniciarSesion(page, project.login, rol, project.baseUrl);
      base = page.url() || base; // arrancar el crawl desde donde quedó tras loguear
    } else {
      await page.goto(project.baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      base = page.url() || base;
    }
    const seeds = (project.routes || []).map((r) => r.path);
    rutas = await descubrirRutas(page, base, { seeds });
  } catch (e) {
    console.warn(`  ⚠ No pude descubrir rutas (${rol.etiqueta || "publico"}): ${e.message}`);
  }
  await ctx.close();
  return rutas;
}

// Captura un proyecto en todos los viewports, una pasada por rol (credenciales).
// Sin roles, una sola pasada pública. opciones.roles = [{ etiqueta, usuario, clave }].
export async function capturarProyecto(project, cfg = config, opciones = {}) {
  const projSlug = slug(project.name);
  const projDir = path.join(dirSalida(cfg), projSlug);

  // Roles a capturar. Prioridad: los pasados por la UI (override) > multi-rol del
  // config > credenciales guardadas en el login del proyecto > pasada pública.
  const credGuardadas =
    project.login && project.login.usuario && project.login.clave
      ? [{ etiqueta: "principal", usuario: project.login.usuario, clave: project.login.clave }]
      : null;
  const roles =
    (Array.isArray(opciones.roles) && opciones.roles.length && opciones.roles) ||
    (Array.isArray(project.roles) && project.roles.length && project.roles) ||
    credGuardadas ||
    [{ etiqueta: "publico", usuario: null, clave: null }];

  const browser = await chromium.launch();
  const capturas = [];
  let ok = 0;
  let errores = 0;

  // Pre-chequeo: ¿el proyecto responde en baseUrl? Si no, frenamos acá con un
  // mensaje claro en vez de fallar ruta por ruta.
  {
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    let alcanzable = true;
    try {
      await pg.goto(project.baseUrl, { waitUntil: "domcontentloaded", timeout: 8000 });
    } catch {
      alcanzable = false;
    }
    await ctx.close();
    if (!alcanzable) {
      await browser.close();
      const error = `El proyecto no responde en ${project.baseUrl}. ¿Está levantado?`;
      console.warn(`  ⚠ ${error}`);
      return { name: project.name, slug: projSlug, dir: projDir, ok: 0, errores: 0, capturas: [], error };
    }
  }

  // ¿Capturar también cada sección detectada en cada página?
  const capturarSecciones = !!(opciones.secciones || project.secciones);
  // ¿Recorrer el sitio (ya logueado) y capturar todas las rutas que aparezcan?
  const crawl = !!(opciones.crawl || project.crawl);

  try {
    for (const rol of roles) {
      const rolEtiqueta = rol.etiqueta || "publico";
      const rolSlug = slug(rolEtiqueta);
      const rolDir = path.join(projDir, rolSlug);
      await mkdir(rolDir, { recursive: true });

      // Hay login si el proyecto lo tiene configurado y el rol trae credenciales.
      const hayLogin = project.login && rol.usuario && rol.clave;

      // Rutas a capturar para este rol. Con crawl, se descubren navegando el
      // sitio ya logueado (así se ven las páginas detrás del login). Sin crawl,
      // se usan las rutas configuradas en el proyecto.
      let rutas = project.routes;
      if (crawl) {
        const descubiertas = await descubrirParaRol(browser, project, rol, hayLogin);
        rutas = unirRutas(project.routes, descubiertas); // configuradas + descubiertas, sin duplicar
        console.log(`  ↳ ${descubiertas.length} descubiertas, ${rutas.length} a capturar (${rolEtiqueta})`);
      }

      // Un contexto (sesión) por viewport. Así el login se reutiliza entre rutas.
      for (const viewport of cfg.viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 2, // capturas nítidas (retina/HiDPI)
        });
        const page = await context.newPage();

        // Login una sola vez por contexto. Si falla, avisamos y seguimos
        // (no cortamos toda la corrida).
        if (hayLogin) {
          try {
            await iniciarSesion(page, project.login, rol, project.baseUrl);
          } catch (e) {
            console.warn(
              `  ⚠ Login falló (${rolEtiqueta}/${viewport.name}): ${e.message}. Sigo sin sesión.`
            );
          }
        }

        for (const route of rutas) {
          const base = slug(route.path) || slug(route.label) || "pagina";
          const archivo = `${base}--${viewport.name}.png`;
          const destino = path.join(rolDir, archivo);
          const url = new URL(route.path, project.baseUrl).href;
          // Ruta relativa a output/, que es lo que la galería necesita.
          const rel = `${projSlug}/${rolSlug}/${archivo}`;

          try {
            await page.goto(url, { waitUntil: "load", timeout: 30000 });
            // Preparar la página: fuentes + auto-scroll (lazy-load) + settle.
            // (A propósito NO usamos networkidle: con hot-reload nunca se calma).
            await prepararPagina(page, cfg);
            await page.screenshot({
              path: destino,
              fullPage: cfg.fullPage,
              animations: "disabled", // congela CSS para una foto consistente
            });
            ok++;
            capturas.push({
              archivo: rel,
              label: route.label || route.path,
              viewport: viewport.name,
              ruta: route.path,
              rol: rolEtiqueta,
              ok: true,
            });
            console.log(`  ✓ ${route.label} (${rolEtiqueta}/${viewport.name})`);

            // Capturar cada sección detectada (además del full-page).
            if (capturarSecciones) {
              let secciones = [];
              try {
                secciones = await detectarSecciones(page);
              } catch {
                secciones = [];
              }
              for (const sec of secciones) {
                const secArchivo = `${base}__${slug(sec.id)}--${viewport.name}.png`;
                const secRel = `${projSlug}/${rolSlug}/${secArchivo}`;
                try {
                  await page.locator('[id="' + sec.id + '"]').first().screenshot({
                    path: path.join(rolDir, secArchivo),
                    animations: "disabled",
                  });
                  ok++;
                  capturas.push({
                    archivo: secRel,
                    label: `${route.label || route.path} › ${sec.label}`,
                    viewport: viewport.name,
                    ruta: `${route.path}#${sec.id}`,
                    rol: rolEtiqueta,
                    ok: true,
                  });
                  console.log(`    ↳ sección "${sec.label}" (${rolEtiqueta}/${viewport.name})`);
                } catch {
                  /* sección no capturable: la salteamos sin sumar error */
                }
              }
            }
          } catch (e) {
            errores++;
            capturas.push({
              archivo: rel,
              label: route.label || route.path,
              viewport: viewport.name,
              ruta: route.path,
              rol: rolEtiqueta,
              ok: false,
              error: e.message,
            });
            console.warn(
              `  ✗ ${route.label} (${rolEtiqueta}/${viewport.name}): ${e.message}`
            );
          }
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const entrada = { name: project.name, slug: projSlug, capturas };
  await actualizarManifest(cfg, entrada);

  return { name: project.name, slug: projSlug, dir: projDir, ok, errores, capturas };
}

// Captura todos los proyectos del config, uno tras otro.
export async function capturarTodos(cfg = config) {
  const resultados = [];
  for (const project of cfg.projects) {
    console.log(`\n▶ ${project.name}`);
    resultados.push(await capturarProyecto(project, cfg));
  }
  return resultados;
}

// Modo CLI: solo si se ejecuta este archivo directamente.
const esCLI =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (esCLI) {
  const arg = process.argv[2];
  const proyectos = arg
    ? config.projects.filter(
        (p) => slug(p.name) === slug(arg) || p.name === arg
      )
    : config.projects;

  if (proyectos.length === 0) {
    console.error(`No encontré ningún proyecto que coincida con "${arg}".`);
    process.exit(1);
  }

  let totalOk = 0;
  let totalErr = 0;
  for (const p of proyectos) {
    console.log(`\n▶ ${p.name}`);
    const r = await capturarProyecto(p);
    totalOk += r.ok;
    totalErr += r.errores;
    console.log(`  Guardado en: ${r.dir}`);
  }

  // Regeneramos la galería con lo que haya en el manifest.
  const { generarGaleria } = await import("./galeria.js");
  const galeria = await generarGaleria();

  console.log(`\nResumen: ${totalOk} OK, ${totalErr} con error.`);
  console.log(`Galería: ${galeria}`);
}
