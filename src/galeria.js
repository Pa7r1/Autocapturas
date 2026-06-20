// Genera output/gallery.html, la galería de revisión. El HTML es autocontenido
// (los datos del manifest van embebidos), así funciona servido o con file://.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../config.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Genera el HTML de la galería a partir del manifest. Devuelve la ruta del HTML.
export async function generarGaleria(cfg = config) {
  const outDir = path.resolve(RAIZ, cfg.outDir);
  const manifestPath = path.join(outDir, "manifest.json");

  let manifest = { generadoEn: null, proyectos: [] };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      // si el manifest está roto generamos una galería vacía
    }
  }

  const destino = path.join(outDir, "gallery.html");
  await writeFile(destino, plantilla(manifest));
  return destino;
}

// Serializa datos para embeber sin riesgo dentro de un <script>.
function jsonSeguro(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function plantilla(manifest) {
  const datos = jsonSeguro(manifest);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Galería · Autocapturas</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #1a1512;
    --bg-2: #221b16;
    --panel: #2b221c;
    --linea: #3a2e25;
    --texto: #ece3d8;
    --tenue: #a8978a;
    --ambar: #f0a24b;
    --ambar-suave: #c9803a;
    --rojo: #e2543f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--texto);
    font-family: "Space Grotesk", system-ui, sans-serif;
    line-height: 1.5;
  }
  code, .mono { font-family: "JetBrains Mono", monospace; }

  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(26, 21, 18, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--linea);
    padding: 18px 28px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  header h1 {
    font-size: 18px;
    margin: 0;
    letter-spacing: 0.5px;
    font-weight: 700;
  }
  header h1 .punto { color: var(--ambar); }
  .contador {
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    color: var(--tenue);
  }
  .contador b { color: var(--rojo); }
  .acciones { margin-left: auto; display: flex; gap: 10px; }

  button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--texto);
    background: var(--panel);
    border: 1px solid var(--linea);
    border-radius: 7px;
    padding: 8px 14px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  button:hover { border-color: var(--ambar-suave); color: var(--ambar); }
  button.primario {
    background: var(--ambar);
    color: #1a1512;
    border-color: var(--ambar);
    font-weight: 700;
  }
  button.primario:hover { background: var(--ambar-suave); color: #1a1512; }

  main { padding: 28px; max-width: 1500px; margin: 0 auto; }

  .vacio {
    text-align: center;
    color: var(--tenue);
    padding: 80px 20px;
  }
  .vacio code { color: var(--ambar); }

  .proyecto { margin-bottom: 48px; }
  .proyecto > h2 {
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--ambar);
    border-bottom: 1px dashed var(--linea);
    padding-bottom: 10px;
    margin: 0 0 22px;
  }
  .proyecto > h2 span { color: var(--tenue); font-weight: 400; letter-spacing: 0; text-transform: none; }

  .grilla {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 22px;
  }

  .paginador {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-top: 18px;
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    color: var(--tenue);
  }
  .paginador:empty { display: none; }
  .paginador button:disabled { opacity: .4; cursor: default; }

  .tarjeta {
    background: var(--bg-2);
    border: 1px solid var(--linea);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .tarjeta.elegida {
    border-color: var(--rojo);
    box-shadow: 0 0 0 1px var(--rojo), 0 8px 24px rgba(226, 84, 63, 0.15);
  }

  .marco {
    position: relative;
    background: #120e0b;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-bottom: 1px solid var(--linea);
  }
  .marco a.zoom { display: block; width: 100%; height: 100%; }
  .marco img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
    display: block;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tenue);
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    text-align: center;
    padding: 16px;
  }
  .badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(18, 14, 11, 0.85);
    border: 1px solid var(--linea);
    color: var(--ambar);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 5px;
  }
  .badge.error { color: var(--rojo); border-color: var(--rojo); }

  .check {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(18, 14, 11, 0.85);
    border: 1px solid var(--linea);
    padding: 4px 9px 4px 7px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 12px;
    user-select: none;
  }
  .check input { accent-color: var(--rojo); cursor: pointer; margin: 0; }

  .cuerpo { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
  .titulo { font-weight: 500; font-size: 14px; }
  .ruta { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--tenue); word-break: break-all; }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 52px;
    background: var(--panel);
    color: var(--texto);
    border: 1px solid var(--linea);
    border-radius: 6px;
    padding: 8px;
    font-family: inherit;
    font-size: 13px;
  }
  textarea:focus { outline: none; border-color: var(--ambar-suave); }
  textarea::placeholder { color: var(--tenue); }
  .cuerpo .tags {
    width: 100%;
    background: var(--panel);
    color: var(--texto);
    border: 1px solid var(--linea);
    border-radius: 6px;
    padding: 7px 8px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
  }
  .cuerpo .tags:focus { outline: none; border-color: var(--ambar-suave); }
  .cuerpo .tags::placeholder { color: var(--tenue); }
  .cuerpo .borrar {
    align-self: flex-start;
    font-size: 12px;
    color: var(--rojo);
    background: transparent;
    border: 1px solid var(--linea);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .cuerpo .borrar:hover { border-color: var(--rojo); }

  .aviso {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--ambar);
    color: #1a1512;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: 8px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
  }
  .aviso.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<header>
  <h1>auto<span class="punto">·</span>capturas</h1>
  <span class="contador"><b id="nSel">0</b> elegidas</span>
  <div class="acciones">
    <button id="btnTodas">Marcar todas</button>
    <button id="btnNinguna">Desmarcar todas</button>
    <button id="btnMd">Copiar Markdown</button>
    <button id="btnJson">Descargar JSON</button>
    <button id="btnZip">Descargar seleccionadas</button>
    <button id="btnExport" class="primario">Exportar al portfolio</button>
  </div>
</header>
<main id="main"></main>
<div class="aviso" id="aviso"></div>

<script id="datos" type="application/json">${datos}</script>
<script>
(function () {
  "use strict";
  var manifest = JSON.parse(document.getElementById("datos").textContent);
  var CLAVE = "autocapturas/seleccion";
  // ¿La galería está servida por el server (http) o abierta como file://?
  var SERVIDO = location.protocol === "http:" || location.protocol === "https:";

  // Estado de revisión: { archivo: { sel: bool, desc: string, etiquetas: [] } }
  var estado = {};
  function localCargar() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch (e) { return {}; }
  }

  var guardarTimer;
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) {}
    if (SERVIDO) {
      clearTimeout(guardarTimer);
      guardarTimer = setTimeout(function () {
        fetch("/api/revision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(estado),
        }).catch(function () {});
      }, 400);
    }
  }
  function entrada(archivo) {
    if (!estado[archivo]) estado[archivo] = { sel: false, desc: "", etiquetas: [] };
    if (!estado[archivo].etiquetas) estado[archivo].etiquetas = [];
    return estado[archivo];
  }

  var main = document.getElementById("main");
  var proyectos = manifest.proyectos || [];
  var POR_PAG = 12; // capturas por página dentro de cada proyecto
  var renders = []; // un re-render por proyecto, para refrescar la vista (marcar todas)

  function arrancar() {
    renders.length = 0;
    if (!proyectos.length) {
      main.innerHTML = '<div class="vacio">Todavía no hay capturas. Corré una captura desde el panel o con <code>npm run capture</code>.</div>';
    }
    proyectos.forEach(function (proy) {
      var sec = document.createElement("section");
      sec.className = "proyecto";
      var caps = proy.capturas || [];
      sec.innerHTML = '<h2>' + esc(proy.name) + ' <span>· ' + caps.length + ' capturas</span></h2>';
      var grilla = document.createElement("div");
      grilla.className = "grilla";
      var nav = document.createElement("div");
      nav.className = "paginador";
      sec.appendChild(grilla);
      sec.appendChild(nav);
      main.appendChild(sec);

      var pag = 0;
      function render() {
        var total = Math.ceil(caps.length / POR_PAG) || 1;
        if (pag >= total) pag = total - 1;
        grilla.innerHTML = "";
        caps.slice(pag * POR_PAG, pag * POR_PAG + POR_PAG).forEach(function (cap) {
          grilla.appendChild(tarjetaDe(cap));
        });
        nav.innerHTML = total > 1
          ? '<button class="prev"' + (pag === 0 ? " disabled" : "") + '>← anterior</button>'
            + '<span>' + (pag + 1) + ' / ' + total + '</span>'
            + '<button class="next"' + (pag === total - 1 ? " disabled" : "") + '>siguiente →</button>'
          : "";
        var prev = nav.querySelector(".prev");
        var next = nav.querySelector(".next");
        if (prev) prev.addEventListener("click", function () { if (pag > 0) { pag--; render(); } });
        if (next) next.addEventListener("click", function () { if (pag < total - 1) { pag++; render(); } });
      }
      renders.push(render);
      render();
    });
    actualizarContador();
    var exp = document.getElementById("btnExport");
    if (exp && !SERVIDO) exp.style.display = "none";
  }

  // Cargar la revisión: del servidor si está servida, si no de localStorage.
  if (SERVIDO) {
    fetch("/api/revision")
      .then(function (r) { return r.json(); })
      .then(function (d) { estado = (d && typeof d === "object") ? d : {}; })
      .catch(function () { estado = localCargar(); })
      .then(arrancar, arrancar);
  } else {
    estado = localCargar();
    arrancar();
  }

  // Crea la tarjeta de una captura, con sus listeners de selección/descripción.
  function tarjetaDe(cap) {
    var st = entrada(cap.archivo);
    var tarjeta = document.createElement("article");
    tarjeta.className = "tarjeta" + (st.sel ? " elegida" : "");

    var img = cap.ok === false
      ? '<div class="placeholder">captura con error<br>' + esc(cap.error || "") + '</div>'
      : '<a class="zoom" href="' + esc(cap.archivo) + '" target="_blank" title="Ver a tamaño completo">'
        + '<img src="' + esc(cap.archivo) + '" alt="' + esc(cap.label) + '" loading="lazy" '
        + 'onerror="this.parentNode.innerHTML=\\'<div class=&quot;placeholder&quot;>imagen no encontrada</div>\\'" />'
        + '</a>';

    tarjeta.innerHTML =
      '<div class="marco">'
      + '<span class="badge' + (cap.ok === false ? ' error' : '') + '">' + esc(cap.rol || "publico") + ' · ' + esc(cap.viewport) + '</span>'
      + '<label class="check"><input type="checkbox"' + (st.sel ? " checked" : "") + '> elegir</label>'
      + img
      + '</div>'
      + '<div class="cuerpo">'
      + '<div class="titulo">' + esc(cap.label) + '</div>'
      + '<div class="ruta">' + esc(cap.ruta || "") + '</div>'
      + '<textarea placeholder="Descripción para el portfolio…">' + esc(st.desc) + '</textarea>'
      + '<input class="tags" placeholder="etiquetas (coma): react, dashboard" value="' + esc((st.etiquetas || []).join(", ")) + '">'
      + (SERVIDO ? '<button class="borrar" type="button">🗑 borrar</button>' : "")
      + '</div>';

    var check = tarjeta.querySelector("input[type=checkbox]");
    var texto = tarjeta.querySelector("textarea");
    var tags = tarjeta.querySelector(".tags");
    check.addEventListener("change", function () {
      st.sel = check.checked;
      tarjeta.classList.toggle("elegida", st.sel);
      guardar();
      actualizarContador();
    });
    texto.addEventListener("input", function () {
      st.desc = texto.value;
      guardar();
    });
    tags.addEventListener("input", function () {
      st.etiquetas = tags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      guardar();
    });
    var borrar = tarjeta.querySelector(".borrar");
    if (borrar) borrar.addEventListener("click", function () {
      if (!confirm("¿Borrar esta captura? Se elimina el archivo del disco.")) return;
      borrar.disabled = true;
      fetch("/api/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivo: cap.archivo }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) throw new Error(j.error || "No se pudo borrar");
          aviso("Captura borrada");
          setTimeout(function () { location.reload(); }, 500);
        })
        .catch(function (e) { borrar.disabled = false; aviso("Error: " + e.message); });
    });
    return tarjeta;
  }

  function elegidas() {
    var lista = [];
    proyectos.forEach(function (proy) {
      (proy.capturas || []).forEach(function (cap) {
        var st = estado[cap.archivo];
        if (st && st.sel) {
          lista.push({
            proyecto: proy.name,
            label: cap.label,
            rol: cap.rol || "publico",
            viewport: cap.viewport,
            ruta: cap.ruta,
            archivo: cap.archivo,
            descripcion: (st.desc || "").trim(),
            etiquetas: st.etiquetas || []
          });
        }
      });
    });
    return lista;
  }

  function actualizarContador() {
    document.getElementById("nSel").textContent = elegidas().length;
  }
  actualizarContador();

  // Marca (o desmarca) todas las capturas de todos los proyectos a la vez.
  // Al marcar, salteamos las que fallaron (no tiene sentido elegirlas).
  function marcarTodas(valor) {
    proyectos.forEach(function (proy) {
      (proy.capturas || []).forEach(function (cap) {
        if (valor && cap.ok === false) return;
        entrada(cap.archivo).sel = valor;
      });
    });
    guardar();
    renders.forEach(function (r) { r(); }); // refrescar checkboxes y clase .elegida
    actualizarContador();
    aviso(valor ? "Todas marcadas" : "Todas desmarcadas");
  }
  document.getElementById("btnTodas").addEventListener("click", function () { marcarTodas(true); });
  document.getElementById("btnNinguna").addEventListener("click", function () { marcarTodas(false); });

  // --- Exportar JSON (descarga un archivo) ---
  document.getElementById("btnJson").addEventListener("click", function () {
    var data = elegidas();
    if (!data.length) return aviso("No hay capturas elegidas");
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "seleccion-portfolio.json";
    a.click();
    URL.revokeObjectURL(a.href);
    aviso("JSON descargado");
  });

  // --- Descargar seleccionadas como .zip (PNG originales, vía server) ---
  var btnZip = document.getElementById("btnZip");
  // El zip lo arma el servidor: en file:// no hay backend, así que lo ocultamos.
  if (btnZip && !SERVIDO) btnZip.style.display = "none";
  if (btnZip && SERVIDO) btnZip.addEventListener("click", function () {
    var data = elegidas();
    if (!data.length) return aviso("No hay capturas elegidas");
    var archivos = data.map(function (c) { return c.archivo; });
    var antes = btnZip.textContent;
    btnZip.disabled = true;
    btnZip.textContent = "Armando zip…";
    fetch("/api/descargar-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivos: archivos }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || "Falló la descarga"); });
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "capturas-seleccionadas.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        aviso("Descargadas " + archivos.length + " capturas (.zip)");
      })
      .catch(function (e) { aviso("Error: " + e.message); })
      .finally(function () { btnZip.disabled = false; btnZip.textContent = antes; });
  });

  // --- Exportar al portfolio (copia webp + JSON/MD al repo, vía server) ---
  var btnExport = document.getElementById("btnExport");
  if (btnExport) btnExport.addEventListener("click", function () {
    if (!elegidas().length) return aviso("No hay capturas elegidas");
    var antes = btnExport.textContent;
    btnExport.disabled = true;
    btnExport.textContent = "Exportando…";
    // Primero aseguramos que el server tenga la selección actual, después export.
    fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado),
    })
      .then(function () { return fetch("/api/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "Falló la exportación");
        aviso("Exportadas " + j.copiadas + " · " + j.destino);
      })
      .catch(function (e) { aviso("Error: " + e.message); })
      .finally(function () { btnExport.disabled = false; btnExport.textContent = antes; });
  });

  // --- Copiar como Markdown ---
  document.getElementById("btnMd").addEventListener("click", function () {
    var data = elegidas();
    if (!data.length) return aviso("No hay capturas elegidas");
    var md = data.map(function (c) {
      var alt = c.rol && c.rol !== "publico" ? c.label + " (" + c.rol + ")" : c.label;
      var linea = "![" + alt + "](" + c.archivo + ")";
      return c.descripcion ? linea + "\\n\\n" + c.descripcion : linea;
    }).join("\\n\\n");
    copiar(md);
  });

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(
        function () { aviso("Markdown copiado"); },
        function () { copiarFallback(texto); }
      );
    } else {
      copiarFallback(texto);
    }
  }
  function copiarFallback(texto) {
    var ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); aviso("Markdown copiado"); }
    catch (e) { aviso("No se pudo copiar"); }
    document.body.removeChild(ta);
  }

  var avisoTimer;
  function aviso(msg) {
    var el = document.getElementById("aviso");
    el.textContent = msg;
    el.classList.add("visible");
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { el.classList.remove("visible"); }, 1800);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
</script>
</body>
</html>
`;
}

// Permite regenerar la galería a mano: node gallery.js
const esCLI =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esCLI) {
  const ruta = await generarGaleria();
  console.log(`Galería generada: ${ruta}`);
}
