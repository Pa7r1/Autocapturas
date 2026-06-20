// Descubrimiento de rutas (crawl del sitio + sitemap) y de secciones dentro de
// una página, para poder capturarlas por separado.

// Enlaces que no seguimos al crawlear: logout, descargas, externos.
const IGNORAR = /\/(logout|signout|sign-out|cerrar-sesion|salir)(\/|$|\?)/i;
const EXT_ARCHIVO = /\.(pdf|zip|rar|gz|tgz|png|jpe?g|gif|webp|svg|mp4|webm|mp3|csv|xlsx?|docx?|woff2?|ttf)(\?|$)/i;

// Normaliza una URL a "pathname" relativo y estable (sin hash ni barra final).
function normalizarPath(u) {
  let p = u.pathname || "/";
  if (p.length > 1) p = p.replace(/\/+$/, ""); // saca barra final (menos en "/")
  return p + (u.search || "");
}

// Etiqueta linda a partir del path (último segmento) o "Inicio" para "/".
function etiquetaDesdePath(path) {
  const limpio = path.split("?")[0];
  if (limpio === "/" || limpio === "") return "Inicio";
  const seg = limpio.split("/").filter(Boolean).pop() || "pagina";
  return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Lee y parsea sitemap.xml (si existe). Devuelve pathnames del mismo origen.
async function leerSitemap(origin) {
  try {
    const res = await fetch(origin + "/sitemap.xml", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const paths = [];
    for (const loc of locs) {
      try {
        const u = new URL(loc);
        if (u.origin === origin) paths.push(normalizarPath(u));
      } catch {
        /* loc inválida */
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// Descubre rutas del sitio. `page` es una página de Playwright (ya logueada si
// hace falta). Devuelve [{ path, label }] (path relativo a baseUrl).
export async function descubrirRutas(page, baseUrl, opciones = {}) {
  const maxPaginas = opciones.maxPaginas || 40;
  const profundidad = opciones.profundidad != null ? opciones.profundidad : 2;
  const origin = new URL(baseUrl).origin;
  const baseInicial = normalizarPath(new URL(baseUrl));

  const rutas = new Map(); // path -> label
  const visitados = new Set();
  const cola = [{ path: baseInicial, depth: 0 }];

  // Sembrar con el sitemap (fuente preferente): se agregan a la cola.
  for (const p of await leerSitemap(origin)) {
    if (!cola.some((c) => c.path === p)) cola.push({ path: p, depth: 0 });
  }

  // Sembrar con rutas extra (ej. las ya configuradas en el proyecto).
  for (const s of opciones.seeds || []) {
    try {
      const p = normalizarPath(new URL(s, origin));
      if (!cola.some((c) => c.path === p)) cola.push({ path: p, depth: 0 });
    } catch {
      /* seed inválida */
    }
  }

  while (cola.length && visitados.size < maxPaginas) {
    const { path, depth } = cola.shift();
    if (visitados.has(path)) continue;
    visitados.add(path);

    const url = new URL(path, origin).href;
    let titulo = "";
    let enlaces = [];
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: 20000 });
      if (resp && resp.status() >= 400) continue; // no sumamos páginas de error (404, etc.)
      // En SPAs (React/Vue) los <a href> aparecen recién cuando el cliente
      // pinta: esperamos a que haya enlaces y dejamos asentar antes de leerlos.
      await page.waitForSelector("a[href]", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
      titulo = (await page.title()) || "";
      enlaces = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
      );
    } catch {
      continue; // ruta caída: la salteamos
    }

    rutas.set(path, (titulo && titulo.trim()) || etiquetaDesdePath(path));

    if (depth >= profundidad) continue;
    for (const href of enlaces) {
      let u;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      if (IGNORAR.test(u.pathname) || EXT_ARCHIVO.test(u.pathname)) continue;
      const np = normalizarPath(u);
      if (!visitados.has(np) && !cola.some((c) => c.path === np)) {
        cola.push({ path: np, depth: depth + 1 });
      }
    }
  }

  return [...rutas.entries()].map(([path, label]) => ({ path, label }));
}

// Detecta secciones dentro de la página ya cargada. Devuelve [{ id, label }].
export async function detectarSecciones(page) {
  return page.evaluate(() => {
    const vistos = new Set();
    const out = [];
    const sel = "section[id], [data-section], main > *[id], article[id]";
    document.querySelectorAll(sel).forEach((el) => {
      const id = el.id || el.getAttribute("data-section");
      if (!id || vistos.has(id)) return;
      // Ignorar elementos invisibles o minúsculos.
      const r = el.getBoundingClientRect();
      if (r.height < 80) return;
      vistos.add(id);
      const h = el.querySelector("h1, h2, h3");
      const label = (h && h.textContent.trim()) || id.replace(/[-_]+/g, " ");
      out.push({ id: id, label: label.slice(0, 80) });
    });
    return out;
  });
}
