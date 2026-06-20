(function () {
  "use strict";

  var POR_PAG = 8; // miniaturas por página en cada proyecto

  // --- Formulario de credenciales por proyecto -----------------------------
  function filaRol(etiqueta) {
    var div = document.createElement("div");
    div.className = "rol";
    div.innerHTML =
      '<input class="etiqueta" placeholder="rol (ej. común)" value="' + esc(etiqueta || "") + '">'
      + '<input class="usuario" placeholder="usuario / email" autocomplete="off">'
      + '<input class="clave" type="password" placeholder="contraseña" autocomplete="off">'
      + '<button type="button" class="quitarRol" title="quitar">✕</button>';
    div.querySelector(".quitarRol").addEventListener("click", function () {
      var cont = div.parentNode;
      div.remove();
      if (cont && !cont.querySelector(".rol")) cont.appendChild(filaRol(""));
    });
    return div;
  }

  function rolesDe(form) {
    var pub = form.querySelector(".esPublico");
    if (pub && pub.checked) return [];
    var roles = [];
    form.querySelectorAll(".rol").forEach(function (r) {
      var usuario = r.querySelector(".usuario").value.trim();
      var clave = r.querySelector(".clave").value;
      var etiqueta = r.querySelector(".etiqueta").value.trim();
      if (usuario && clave) roles.push({ etiqueta: etiqueta || "rol", usuario: usuario, clave: clave });
    });
    return roles;
  }

  document.querySelectorAll(".proy").forEach(function (proy) {
    var toggle = proy.querySelector(".toggle");
    var form = proy.querySelector(".creds");
    var roles = form.querySelector(".roles");
    if (roles) roles.appendChild(filaRol(""));

    toggle.addEventListener("click", function () {
      form.hidden = !form.hidden;
    });

    var addRol = form.querySelector(".addRol");
    if (addRol) addRol.addEventListener("click", function () { roles.appendChild(filaRol("")); });

    var pub = form.querySelector(".esPublico");
    if (pub) pub.addEventListener("change", function () {
      roles.classList.toggle("inactiva", pub.checked);
      var addBtn = form.querySelector(".addRol");
      if (addBtn) addBtn.disabled = pub.checked;
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      lanzar(proy, { slug: proy.dataset.slug, roles: rolesDe(form) });
    });

    var btnDesc = proy.querySelector(".descubrir");
    if (btnDesc) btnDesc.addEventListener("click", function () { descubrir(proy, btnDesc); });
  });

  // --- Descubrir rutas automáticamente -------------------------------------
  function slugify(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  }

  function descubrir(proy, boton) {
    var caja = proy.querySelector(".resultado");
    var antes = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Buscando…";
    caja.hidden = false;
    caja.innerHTML = "Analizando el sitio y buscando rutas…";
    fetch("/api/descubrir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: proy.dataset.slug, roles: [] }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "Falló el descubrimiento");
        pintarDescubiertas(proy, caja, j.rutas || []);
      })
      .catch(function (e) { caja.innerHTML = '<span class="err">Error: ' + esc(e.message) + '</span>'; })
      .finally(function () { boton.disabled = false; boton.textContent = antes; });
  }

  function pintarDescubiertas(proy, caja, rutas) {
    if (!rutas.length) { caja.innerHTML = "No se encontraron rutas (¿el sitio responde? ¿tiene enlaces?)."; return; }
    var items = rutas.map(function (r, i) {
      return '<label class="ruta-item"><input type="checkbox" data-i="' + i + '" checked> '
        + esc(r.label) + ' <span class="mono">' + esc(r.path) + '</span></label>';
    }).join("");
    caja.innerHTML = '<div class="descubiertas"><h4>' + rutas.length + ' rutas encontradas</h4>'
      + items
      + '<div class="barra-desc"><button type="button" class="guardarDesc primario">Guardar en el proyecto</button>'
      + '<span class="msgDesc"></span></div></div>';
    var guardar = caja.querySelector(".guardarDesc");
    var msg = caja.querySelector(".msgDesc");
    guardar.addEventListener("click", function () {
      var elegidas = [];
      caja.querySelectorAll(".ruta-item input:checked").forEach(function (chk) {
        elegidas.push(rutas[parseInt(chk.dataset.i, 10)]);
      });
      if (!elegidas.length) { msg.textContent = "Elegí al menos una"; return; }
      guardar.disabled = true; msg.textContent = "Guardando…";
      fetch("/api/config").then(function (r) { return r.json(); }).then(function (cfg) {
        var p = (cfg.projects || []).find(function (x) { return slugify(x.name) === proy.dataset.slug; });
        if (!p) throw new Error("No encontré el proyecto en la config");
        var existentes = {};
        (p.routes || []).forEach(function (r) { existentes[r.path] = true; });
        elegidas.forEach(function (r) { if (!existentes[r.path]) p.routes.push({ path: r.path, label: r.label }); });
        return fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || "No se pudo guardar");
        msg.textContent = "Guardado. Recargando…";
        setTimeout(function () { location.reload(); }, 600);
      }).catch(function (e) { guardar.disabled = false; msg.textContent = "Error: " + e.message; });
    });
  }

  // --- Disparar captura ----------------------------------------------------
  function lanzar(proy, cuerpo) {
    var caja = proy.querySelector(".resultado");
    var boton = proy.querySelector(".lanzar");
    var antes = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Capturando…";
    caja.hidden = false;
    caja.innerHTML = "Trabajando… (puede tardar según las rutas y los roles)";
    fetch("/capturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Falló la captura");
        pintar(caja, data.proyectos);
      })
      .catch(function (e) { caja.innerHTML = '<span class="err">Error: ' + esc(e.message) + '</span>'; })
      .finally(function () { boton.disabled = false; boton.textContent = antes; });
  }

  // --- Render de miniaturas paginadas por proyecto -------------------------
  function pintar(caja, proyectos) {
    caja.innerHTML = "";
    proyectos.forEach(function (p) {
      var sec = document.createElement("div");
      sec.className = "proyResultado";
      sec.innerHTML = '<div class="resumenLinea"><b>' + esc(p.name) + '</b> · '
        + '<span class="ok">' + p.ok + ' OK</span>'
        + (p.errores ? ' · <span class="err">' + p.errores + ' con error</span>' : '')
        + ' · <a href="/gallery.html" target="_blank">revisar en la galería →</a></div>';

      var grilla = document.createElement("div");
      grilla.className = "miniGrilla";
      var nav = document.createElement("div");
      nav.className = "paginador";
      sec.appendChild(grilla);
      sec.appendChild(nav);
      caja.appendChild(sec);

      var caps = p.capturas || [];
      var pag = 0;
      function render() {
        var total = Math.ceil(caps.length / POR_PAG) || 1;
        if (pag >= total) pag = total - 1;
        var trozo = caps.slice(pag * POR_PAG, pag * POR_PAG + POR_PAG);
        grilla.innerHTML = trozo.map(function (c) {
          var media = c.ok === false
            ? '<div class="miniPlaceholder">error</div>'
            : '<img src="' + esc(c.archivo) + '" loading="lazy" alt="' + esc(c.label) + '" '
              + 'onerror="this.parentNode.innerHTML=&apos;<div class=&quot;miniPlaceholder&quot;>no encontrada</div>&apos;">';
          return '<a class="mini" href="' + esc(c.archivo) + '" target="_blank">'
            + '<div class="miniMarco"><span class="miniBadge">' + esc(c.rol) + ' · ' + esc(c.viewport) + '</span>'
            + media + '</div>'
            + '<span class="miniLabel">' + esc(c.label) + '</span></a>';
        }).join("");
        nav.innerHTML = total > 1
          ? '<button type="button" class="prev"' + (pag === 0 ? " disabled" : "") + '>← anterior</button>'
            + '<span>' + (pag + 1) + ' / ' + total + '</span>'
            + '<button type="button" class="next"' + (pag === total - 1 ? " disabled" : "") + '>siguiente →</button>'
          : "";
        var prev = nav.querySelector(".prev");
        var next = nav.querySelector(".next");
        if (prev) prev.addEventListener("click", function () { if (pag > 0) { pag--; render(); } });
        if (next) next.addEventListener("click", function () { if (pag < total - 1) { pag++; render(); } });
      }
      render();
    });
  }

  // --- Capturar todos (pasada pública, sin credenciales) -------------------
  var todos = document.getElementById("todos");
  todos.addEventListener("click", function () {
    var caja = document.getElementById("resumenTodos");
    if (!caja) {
      caja = document.createElement("div");
      caja.id = "resumenTodos";
      caja.className = "resultado";
      caja.style.background = "var(--bg-2)";
      caja.style.border = "1px solid var(--linea)";
      caja.style.borderRadius = "10px";
      caja.style.padding = "16px 18px";
      caja.style.marginBottom = "14px";
      todos.parentNode.after(caja);
    }
    caja.hidden = false;
    caja.innerHTML = "Trabajando…";
    todos.disabled = true;
    var antes = todos.textContent;
    todos.textContent = "Capturando…";
    fetch("/capturar?all=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, roles: [] }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Falló");
        pintar(caja, data.proyectos);
      })
      .catch(function (e) { caja.innerHTML = '<span class="err">Error: ' + esc(e.message) + '</span>'; })
      .finally(function () { todos.disabled = false; todos.textContent = antes; });
  });

  var borrarTodo = document.getElementById("borrarTodo");
  if (borrarTodo) borrarTodo.addEventListener("click", function () {
    if (!confirm("¿Borrar TODAS las capturas? Se elimina todo lo de output/ y la galería queda vacía. Esto no se puede deshacer.")) return;
    var caja = document.getElementById("resumenTodos");
    if (!caja) {
      caja = document.createElement("div");
      caja.id = "resumenTodos";
      caja.className = "resultado";
      caja.style.background = "var(--bg-2)";
      caja.style.border = "1px solid var(--linea)";
      caja.style.borderRadius = "10px";
      caja.style.padding = "16px 18px";
      caja.style.marginBottom = "14px";
      borrarTodo.parentNode.after(caja);
    }
    caja.hidden = false;
    caja.innerHTML = "Borrando…";
    borrarTodo.disabled = true;
    var antes = borrarTodo.textContent;
    borrarTodo.textContent = "Borrando…";
    fetch("/api/eliminar-todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Falló");
        caja.innerHTML = "Listo: capturas borradas. Recargando…";
        setTimeout(function () { location.reload(); }, 700);
      })
      .catch(function (e) {
        caja.innerHTML = '<span class="err">Error: ' + esc(e.message) + '</span>';
        borrarTodo.disabled = false;
        borrarTodo.textContent = antes;
      });
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();

(function () {
  "use strict";

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById("cfgDatos").textContent); } catch (e) { cfg = {}; }

  var editor = document.getElementById("editor");
  var abrir = document.getElementById("abrirEditor");
  var construido = false;

  abrir.addEventListener("click", function () {
    if (!construido) { construir(); construido = true; }
    editor.hidden = !editor.hidden;
    if (!editor.hidden) editor.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Helpers de creación de nodos.
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function input(cls, val, ph, type) {
    var i = document.createElement("input");
    i.className = cls;
    i.type = type || "text";
    if (ph) i.placeholder = ph;
    if (val != null) i.value = val;
    return i;
  }
  function etiqueta(texto, nodo) {
    var l = el("label", "campo");
    l.appendChild(document.createTextNode(texto));
    l.appendChild(nodo);
    return l;
  }

  function construir() {
    editor.innerHTML = "";
    var cab = el("div", "editorCab", "<h2>Configuración</h2>");
    var cerrar = el("button", "cerrarEditor", "cerrar");
    cerrar.addEventListener("click", function () { editor.hidden = true; });
    cab.appendChild(cerrar);
    editor.appendChild(cab);

    // Proyectos
    editor.appendChild(el("h3", null, "Proyectos"));
    var lista = el("div"); lista.id = "listaProyectos";
    editor.appendChild(lista);
    (cfg.projects || []).forEach(function (p) { lista.appendChild(cardProyecto(p)); });
    var addP = el("button", "addProyecto", "＋ Nuevo proyecto");
    addP.addEventListener("click", function () {
      var card = cardProyecto({ name: "", baseUrl: "", login: null, routes: [{ path: "/", label: "Inicio" }] });
      lista.appendChild(card);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    editor.appendChild(addP);

    // Ajustes
    editor.appendChild(el("h3", null, "Ajustes"));
    var ajustes = el("div"); ajustes.id = "ajustes";
    ajustes.appendChild(el("div", "rutaHead", "Tamaños de pantalla (viewports)"));
    var lvp = el("div"); lvp.id = "listaViewports";
    (cfg.viewports || []).forEach(function (v) { lvp.appendChild(filaViewport(v)); });
    ajustes.appendChild(lvp);
    var addV = el("button", "addViewport", "＋ viewport");
    addV.addEventListener("click", function () { lvp.appendChild(filaViewport({ name: "", width: 1280, height: 800 })); });
    ajustes.appendChild(addV);

    var filaFull = el("div", "ajusteFila");
    var lblFull = el("label");
    var chkFull = input("fullPage", null, null, "checkbox"); chkFull.checked = !!cfg.fullPage;
    lblFull.appendChild(chkFull);
    lblFull.appendChild(document.createTextNode(" Página completa (scroll entero)"));
    filaFull.appendChild(lblFull);
    ajustes.appendChild(filaFull);

    var filaNum = el("div", "ajusteFila");
    filaNum.appendChild(etiqueta("Espera tras cargar (ms)", input("settleMs", cfg.settleMs, null, "number")));
    filaNum.appendChild(etiqueta("Puerto del panel", input("serverPort", cfg.serverPort, null, "number")));
    filaNum.appendChild(el("small", null, "el puerto aplica al reiniciar (npm start)"));
    ajustes.appendChild(filaNum);

    ajustes.appendChild(el("div", "rutaHead", "Exportar al portfolio (repo de GitHub)"));
    ajustes.appendChild(etiqueta("Carpeta del clon local del repo (exportDir)",
      input("exportDir", cfg.exportDir || "", "ruta al repo local de tu portfolio")));
    ajustes.appendChild(etiqueta("Subcarpeta dentro del repo (exportSubdir)",
      input("exportSubdir", cfg.exportSubdir || "capturas", "public/capturas")));
    editor.appendChild(ajustes);

    // Guardar
    var barra = el("div", "guardarBarra");
    var guardar = el("button", "primario", "Guardar cambios"); guardar.id = "guardarCfg";
    var msg = el("span"); msg.id = "guardarMsg";
    barra.appendChild(guardar); barra.appendChild(msg);
    editor.appendChild(barra);
    guardar.addEventListener("click", onGuardar);
  }

  function cardProyecto(p) {
    var card = el("div", "pcard");
    var cab = el("div", "pcardCab");
    cab.appendChild(input("pNombre", p.name, "Nombre del proyecto"));
    var borrar = el("button", "borrarProy", "borrar");
    borrar.addEventListener("click", function () { card.remove(); });
    cab.appendChild(borrar);
    card.appendChild(cab);

    card.appendChild(etiqueta("URL base (con http:// y puerto)", input("pBase", p.baseUrl, "http://localhost:5173/")));

    var filaSec = el("div", "ajusteFila");
    var lblSec = el("label");
    var chkSec = input("pSecciones", null, null, "checkbox"); chkSec.checked = !!p.secciones;
    lblSec.appendChild(chkSec);
    lblSec.appendChild(document.createTextNode(" Capturar también cada sección de la página (además del full-page)"));
    filaSec.appendChild(lblSec);
    card.appendChild(filaSec);

    var le = el("div", "loginEdit");
    var lblTiene = el("label");
    var chk = input("pTieneLogin", null, null, "checkbox"); chk.checked = !!p.login;
    lblTiene.appendChild(chk);
    lblTiene.appendChild(document.createTextNode(" Tiene login (las credenciales se cargan al capturar)"));
    le.appendChild(lblTiene);

    var campos = el("div", "loginCampos");
    if (!p.login) campos.hidden = true;
    var lg = p.login || {};
    campos.appendChild(etiqueta("URL del formulario de login", input("lUrl", lg.url || "/login", "/login")));
    var det = el("details");
    det.appendChild(el("summary", null, "Selectores (avanzado · opcional, se autodetectan si los dejás vacíos)"));
    det.appendChild(etiqueta("Campo usuario (userSel)", input("lUser", lg.userSel || "", 'input[name="email"]')));
    det.appendChild(etiqueta("Campo contraseña (passSel)", input("lPass", lg.passSel || "", 'input[type="password"]')));
    det.appendChild(etiqueta("Botón enviar (submitSel)", input("lSubmit", lg.submitSel || "", 'button[type="submit"]')));
    det.appendChild(etiqueta("URL de éxito (exitoUrl)", input("lExito", lg.exitoUrl || "", "**/dashboard")));
    campos.appendChild(det);
    le.appendChild(campos);
    chk.addEventListener("change", function () { campos.hidden = !chk.checked; });
    card.appendChild(le);

    card.appendChild(el("div", "rutaHead", "Rutas a capturar"));
    var lr = el("div", "listaRutas");
    (p.routes || []).forEach(function (r) { lr.appendChild(filaRuta(r)); });
    card.appendChild(lr);
    var addR = el("button", "addRuta", "＋ ruta");
    addR.addEventListener("click", function () { lr.appendChild(filaRuta({ path: "", label: "" })); });
    card.appendChild(addR);
    return card;
  }

  function filaRuta(r) {
    var row = el("div", "ruta");
    row.appendChild(input("rPath", r.path, "/ruta"));
    row.appendChild(input("rLabel", r.label, "Etiqueta (ej. Inicio)"));
    var q = el("button", "quitarRuta", "✕");
    q.addEventListener("click", function () { row.remove(); });
    row.appendChild(q);
    return row;
  }

  function filaViewport(v) {
    var row = el("div", "vp");
    row.appendChild(input("vName", v.name, "nombre (ej. escritorio)"));
    row.appendChild(input("vWidth", v.width, "ancho", "number"));
    row.appendChild(input("vHeight", v.height, "alto", "number"));
    var q = el("button", "quitarVp", "✕");
    q.addEventListener("click", function () { row.remove(); });
    row.appendChild(q);
    return row;
  }

  function recolectar() {
    var projects = [];
    document.querySelectorAll("#listaProyectos .pcard").forEach(function (card) {
      var routes = [];
      card.querySelectorAll(".listaRutas .ruta").forEach(function (r) {
        var ruta = r.querySelector(".rPath").value.trim();
        var label = r.querySelector(".rLabel").value.trim();
        if (ruta) routes.push({ path: ruta, label: label || ruta });
      });
      var login = null;
      if (card.querySelector(".pTieneLogin").checked) {
        login = { url: card.querySelector(".lUrl").value.trim() };
        var map = { lUser: "userSel", lPass: "passSel", lSubmit: "submitSel", lExito: "exitoUrl" };
        Object.keys(map).forEach(function (c) {
          var v = card.querySelector("." + c).value.trim();
          if (v) login[map[c]] = v;
        });
      }
      projects.push({
        name: card.querySelector(".pNombre").value.trim(),
        baseUrl: card.querySelector(".pBase").value.trim(),
        secciones: card.querySelector(".pSecciones").checked,
        routes: routes,
        login: login,
      });
    });
    var viewports = [];
    document.querySelectorAll("#listaViewports .vp").forEach(function (row) {
      viewports.push({
        name: row.querySelector(".vName").value.trim(),
        width: parseInt(row.querySelector(".vWidth").value, 10),
        height: parseInt(row.querySelector(".vHeight").value, 10),
      });
    });
    return {
      projects: projects,
      viewports: viewports,
      fullPage: document.querySelector(".fullPage").checked,
      settleMs: parseInt(document.querySelector(".settleMs").value, 10),
      serverPort: parseInt(document.querySelector(".serverPort").value, 10),
      exportDir: document.querySelector(".exportDir").value.trim(),
      exportSubdir: document.querySelector(".exportSubdir").value.trim(),
    };
  }

  function onGuardar() {
    var msg = document.getElementById("guardarMsg");
    var btn = document.getElementById("guardarCfg");
    btn.disabled = true; msg.className = ""; msg.textContent = "Guardando…";
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recolectar()),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { msg.className = "err"; msg.textContent = j.error || "No se pudo guardar"; btn.disabled = false; return; }
        msg.className = "ok";
        msg.textContent = j.reinicioPuerto
          ? "Guardado. El cambio de puerto aplica al reiniciar el server. Recargando…"
          : "Guardado. Recargando…";
        setTimeout(function () { location.reload(); }, j.reinicioPuerto ? 1600 : 600);
      })
      .catch(function (e) { msg.className = "err"; msg.textContent = "Error: " + e.message; btn.disabled = false; });
  }
})();
