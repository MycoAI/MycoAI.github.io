/*
  3D model of the MycoAI logo for the home page hero: a mushroom robot on a floating island,
  in toon shading with ink outlines. Needs three.js r128 and OrbitControls, loaded before this
  file (assets/js/vendor/, see _layouts/default.html). The logo image stays visible in the
  stage until the scene is running, so without WebGL or when anything here fails, visitors see
  the logo instead of an empty box.
*/
(function () {
  var stage = document.getElementById("stage");
  if (!stage || !window.THREE || !THREE.OrbitControls) return;

  function fallBack() {
    stage.classList.remove("is-3d");
    var canvas = stage.querySelector("canvas");
    if (canvas) canvas.remove();
  }
  try {
    start().catch(fallBack);
  } catch (e) {
    fallBack();
  }

  /* lets the browser handle input and paint between the steps of building the scene */
  function pause() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  async function start() {
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.setAttribute("aria-hidden", "true");
    stage.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    var HOME = new THREE.Vector3(4.2, 3.2, 9.2), TARGET = new THREE.Vector3(0, 1.3, 0);
    camera.position.copy(HOME);
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(3, 6, 5);
    scene.add(key);

    /* logo palette */
    var C = {
      orange: 0xf39a2b, orangeDeep: 0xe5801c, orangeLight: 0xf9c784, rim: 0xee8a22, gillBg: 0xf6b45a,
      cream: 0xf4ecd8, creamShade: 0xe6dac0, ink: 0x3a2a25, moss: 0x9d9a45, mossDark: 0x7e7d34,
      soil: 0x4a3229, soilDark: 0x3a2620, mini: 0xef6f2e, white: 0xffffff
    };

    /* toon shading with 3 tones, like a flat illustration */
    var gc = document.createElement("canvas");
    gc.width = 3;
    gc.height = 1;
    var gx = gc.getContext("2d");
    [150, 210, 255].forEach(function (v, i) { gx.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; gx.fillRect(i, 0, 1, 1); });
    var grad = new THREE.CanvasTexture(gc);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.generateMipmaps = false;
    /* materials are shared per colour */
    var toons = {}, flats = {};
    function toon(c, extra) {
      if (extra) return new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, extra));
      return toons[c] || (toons[c] = new THREE.MeshToonMaterial({ color: c, gradientMap: grad }));
    }
    function flat(c) { return flats[c] || (flats[c] = new THREE.MeshBasicMaterial({ color: c })); }
    var OUT = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });

    var SPH = new THREE.SphereGeometry(1, 40, 28), CYL = new THREE.CylinderGeometry(1, 1, 2, 28);
    var BOX = new THREE.BoxGeometry(1, 1, 1), CONE = new THREE.ConeGeometry(1, 1, 5);

    /* part: unit geometry scaled; outline = inverted hull W units thicker */
    function part(geo, mat, parent, pos, scl, rot, W) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      m.scale.set(scl[0], scl[1], scl[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      parent.add(m);
      if (W !== 0) {
        var w = W || 0.028;
        var o = new THREE.Mesh(geo, OUT);
        o.position.copy(m.position);
        o.rotation.copy(m.rotation);
        o.scale.set(scl[0] + w, scl[1] + w, scl[2] + w);
        parent.add(o);
      }
      return m;
    }
    var Y = new THREE.Vector3(0, 1, 0);
    function limb(parent, a, b, r, mat) {
      var A = new THREE.Vector3(a[0], a[1], a[2]), B = new THREE.Vector3(b[0], b[1], b[2]);
      var d = B.clone().sub(A), L = d.length();
      var q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), mid = A.clone().add(B).multiplyScalar(0.5);
      [[mat, 0], [OUT, 0.028]].forEach(function (pair) {
        var c = new THREE.Mesh(CYL, pair[0]);
        c.position.copy(mid);
        c.quaternion.copy(q);
        c.scale.set(r + pair[1], L / 2, r + pair[1]);
        parent.add(c);
      });
      part(SPH, mat, parent, b, [r, r, r]);
    }
    function roundBox(r) {
      var g = new THREE.BoxGeometry(2, 2, 2, 12, 12, 12), p = g.attributes.position;
      var v = new THREE.Vector3(), c = new THREE.Vector3(), k = 1 - r;
      for (var i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        c.set(Math.max(-k, Math.min(k, v.x)), Math.max(-k, Math.min(k, v.y)), Math.max(-k, Math.min(k, v.z)));
        v.sub(c);
        if (v.lengthSq() > 0) v.normalize().multiplyScalar(r);
        v.add(c);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    }

    var world = new THREE.Group();
    scene.add(world);
    await pause();

    /* ---------- floating island ---------- */
    var island = new THREE.Group();
    world.add(island);
    var mossGeo = new THREE.CylinderGeometry(2.05, 2.15, 0.2, 14, 1);
    (function () {
      var p = mossGeo.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), f = 1 + 0.05 * Math.sin(a * 5) + 0.03 * Math.sin(a * 11);
        p.setX(i, x * f);
        p.setZ(i, z * f);
      }
      mossGeo.computeVertexNormals();
    })();
    part(mossGeo, toon(C.moss), island, [0, -0.1, 0], [1, 1, 1], null, 0.03);
    part(new THREE.CylinderGeometry(2.1, 1.55, 0.6, 14), toon(C.soil), island, [0, -0.5, 0], [1, 1, 1], null, 0.03);
    part(BOX, toon(C.soilDark), island, [0, -0.92, 0], [2.6, 0.22, 1.3], null, 0.03);
    part(BOX, toon(C.soilDark), island, [0, -1.16, 0.05], [1.3, 0.3, 0.9], null, 0.03);
    [[-0.35, -1.4], [0.4, -1.4]].forEach(function (xy) {
      part(BOX, toon(C.soilDark), island, [xy[0], xy[1], 0.1], [0.12, 0.22, 0.12], null, 0.025);
    });
    [[0.3, C.orangeDeep], [0.9, C.moss], [-0.5, C.orangeDeep], [1.6, C.moss], [-1.1, C.orange], [2.4, C.moss]].forEach(function (ac, i) {
      var r = 1.86 - 0.1 * (i % 2);
      part(SPH, flat(ac[1]), island, [Math.sin(ac[0]) * r, -0.48 - 0.12 * (i % 3), Math.cos(ac[0]) * r], [0.06, 0.06, 0.06], null, 0);
    });
    /* moss tufts */
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2 + 0.2, r = 1.75 + Math.random() * 0.3;
      part(CONE, toon(i % 2 ? C.mossDark : C.moss), island,
        [Math.cos(a) * r, 0.08, Math.sin(a) * r], [0.06, 0.22 + Math.random() * 0.18, 0.06],
        [(Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6], 0.02);
    }

    /* small orange mushrooms */
    [[2.1, 1.25, 0.95], [2.75, 1.55, 0.7], [0.6, 1.5, 1.05], [-0.7, 1.35, 0.8], [-1.9, 1.55, 1.0], [3.6, 1.3, 0.6], [4.4, 1.6, 0.85]].forEach(function (m) {
      var g = new THREE.Group();
      g.position.set(Math.cos(m[0]) * m[1], 0, Math.sin(m[0]) * m[1]);
      island.add(g);
      part(CYL, toon(C.cream), g, [0, m[2] / 2, 0], [0.035, m[2] / 2, 0.035], null, 0.02);
      part(SPH, toon(C.mini), g, [0, m[2] + 0.03, 0], [0.17, 0.11, 0.17], null, 0.022);
      part(SPH, flat(C.orangeLight), g, [0.05, m[2] + 0.1, 0.06], [0.035, 0.02, 0.035], null, 0);
    });

    await pause();

    /* ---------- robot body ---------- */
    var bot = new THREE.Group();
    world.add(bot);
    var cream = toon(C.cream), shade = toon(C.creamShade), ink = flat(C.ink);
    [-1, 1].forEach(function (s) {
      part(SPH, cream, bot, [s * 0.2, 0.1, 0.06], [0.17, 0.1, 0.22]);
      limb(bot, [s * 0.2, 0.18, 0], [s * 0.19, 0.48, 0], 0.1, cream);
      limb(bot, [s * 0.19, 0.48, 0], [s * 0.17, 0.78, 0], 0.11, cream);
    });
    part(SPH, cream, bot, [0, 0.86, 0], [0.3, 0.2, 0.24]);
    part(SPH, cream, bot, [0, 1.22, 0], [0.37, 0.42, 0.3]);
    [1.12, 1.3].forEach(function (y) {
      var t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 48), ink);
      var dy = (y - 1.22) / 0.42, f = Math.sqrt(1 - dy * dy);
      t.position.set(0, y, 0);
      t.rotation.x = Math.PI / 2;
      t.scale.set(0.37 * f, 0.3 * f, 0.3);
      bot.add(t);
    });
    part(SPH, shade, bot, [0, 1.22, 0.24], [0.12, 0.12, 0.06], null, 0.02);
    part(CYL, shade, bot, [0, 1.66, 0], [0.1, 0.08, 0.1]);
    var arms = [];
    [-1, 1].forEach(function (s) {
      var arm = new THREE.Group();
      arm.position.set(s * 0.34, 1.45, 0);
      bot.add(arm);
      arms.push([arm, s]);
      part(SPH, cream, arm, [0, 0, 0], [0.12, 0.12, 0.12]);
      limb(arm, [0, 0, 0], [s * 0.18, -0.28, 0.03], 0.085, cream);
      limb(arm, [s * 0.18, -0.28, 0.03], [s * 0.26, -0.52, 0.07], 0.08, cream);
      part(SPH, cream, arm, [s * 0.29, -0.66, 0.08], [0.15, 0.17, 0.12]);
      part(SPH, cream, arm, [s * 0.17, -0.6, 0.12], [0.06, 0.09, 0.06], null, 0.02);
    });

    /* head with big eyes */
    var head = new THREE.Group();
    head.position.set(0, 2.02, 0);
    bot.add(head);
    part(roundBox(0.32), cream, head, [0, 0, 0], [0.52, 0.42, 0.45]);
    var eyes = [];
    [-1, 1].forEach(function (s) {
      var e = new THREE.Group();
      e.position.set(s * 0.2, 0.0, 0.43);
      head.add(e);
      eyes.push(e);
      part(SPH, flat(C.white), e, [0, 0, 0], [0.12, 0.16, 0.04], null, 0.035);
      part(SPH, ink, e, [0, -0.01, 0.025], [0.085, 0.12, 0.03], null, 0);
      part(SPH, flat(C.white), e, [-0.025, 0.045, 0.05], [0.025, 0.03, 0.01], null, 0);
    });

    await pause();

    /* mushroom cap */
    var cap = new THREE.Group();
    cap.position.set(0, 2.35, 0);
    bot.add(cap);
    var dome = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    part(dome, toon(C.orange), cap, [0, 0, 0], [1.32, 1.08, 1.32], null, 0.035);
    var shine = new THREE.Mesh(new THREE.SphereGeometry(1.004, 40, 12, 0, Math.PI * 2, 0, 0.36), flat(0xfff6e6));
    shine.scale.set(1.32, 1.08, 1.32);
    shine.rotation.set(-0.12, 0, 0.05);
    cap.add(shine);
    var blush = new THREE.Mesh(new THREE.SphereGeometry(1.003, 40, 16, 0.9, 1.4, 0.55, 0.55), toon(C.orangeLight));
    blush.scale.set(1.32, 1.08, 1.32);
    cap.add(blush);
    /* spots on the cap */
    [[0.9, 0.7, 0.08], [1.25, 0.95, 0.05], [2.6, 0.6, 0.07], [3.3, 0.85, 0.05], [4.2, 0.55, 0.08], [5.1, 0.9, 0.06], [5.8, 0.65, 0.05], [0.3, 1.05, 0.04]].forEach(function (s) {
      var th = s[0], ph = s[1], r = s[2];
      var n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
      var p = new THREE.Vector3(n.x * 1.32, n.y * 1.08, n.z * 1.32);
      var sp = new THREE.Mesh(SPH, toon(C.orangeDeep));
      sp.position.copy(p);
      sp.lookAt(p.clone().add(n));
      sp.scale.set(r, r, 0.012);
      cap.add(sp);
    });
    /* rim */
    var rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 14, 80), toon(C.rim));
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.34, 1.34, 1.15);
    cap.add(rim);
    var rimO = new THREE.Mesh(new THREE.TorusGeometry(1, 0.128, 14, 80), OUT);
    rimO.rotation.x = Math.PI / 2;
    rimO.scale.set(1.34, 1.34, 1.25);
    cap.add(rimO);
    /* gills: radial lines painted on the underside */
    var gcv = document.createElement("canvas");
    gcv.width = gcv.height = 512;
    var g2 = gcv.getContext("2d");
    function hex(n) { return "#" + n.toString(16).padStart(6, "0"); }
    g2.fillStyle = hex(C.gillBg);
    g2.fillRect(0, 0, 512, 512);
    var rg = g2.createRadialGradient(256, 256, 40, 256, 256, 256);
    rg.addColorStop(0, "rgba(120,60,20,.35)");
    rg.addColorStop(1, "rgba(120,60,20,0)");
    g2.fillStyle = rg;
    g2.fillRect(0, 0, 512, 512);
    g2.strokeStyle = hex(C.ink);
    g2.lineCap = "round";
    for (var j = 0; j < 64; j++) {
      var ang = j / 64 * Math.PI * 2, r0 = j % 2 ? 120 : 80;
      g2.lineWidth = j % 2 ? 2 : 3.2;
      g2.beginPath();
      g2.moveTo(256 + Math.cos(ang) * r0, 256 + Math.sin(ang) * r0);
      g2.lineTo(256 + Math.cos(ang) * 236, 256 + Math.sin(ang) * 236);
      g2.stroke();
    }
    var under = new THREE.Mesh(new THREE.CircleGeometry(1.3, 72), toon(0xffffff, { map: new THREE.CanvasTexture(gcv), side: THREE.DoubleSide }));
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.02;
    cap.add(under);

    await pause();

    /* floating dots like in the logo */
    var dots = [];
    [[-2.1, 2.9, 0.3, C.ink], [2.2, 3.3, -0.2, C.ink], [-1.6, 1.4, 1.2, C.orangeDeep], [2.0, 1.9, 0.9, C.ink], [1.6, 3.9, 0.4, C.ink],
     [-2.4, 2.2, -0.6, C.orangeDeep], [2.5, 1.1, -0.5, C.orangeDeep], [-1.2, 3.7, -0.4, C.ink], [0.6, 4.1, 0.8, C.orangeDeep]].forEach(function (d, i) {
      var m = part(SPH, flat(d[3]), world, [d[0], d[1], d[2]], [0.05, 0.05, 0.05], null, 0);
      m.userData = { y: d[1], ph: i * 1.3 };
      dots.push(m);
    });

    /* controls: rotate by drag; zoom only via buttons, Ctrl+wheel or pinch so the page still scrolls */
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(TARGET);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = !reduce;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = 2.0;
    controls.autoRotateSpeed = 1.1;
    controls.update();

    function zoom(f) {
      var v = camera.position.clone().sub(controls.target);
      camera.position.copy(controls.target).add(v.setLength(THREE.MathUtils.clamp(v.length() * f, 3.6, 15)));
      wake();
    }
    renderer.domElement.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.08 : 0.92);
    }, { passive: false });
    var pinch = 0;
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    renderer.domElement.addEventListener("touchstart", function (e) { if (e.touches.length === 2) pinch = dist(e.touches); }, { passive: true });
    renderer.domElement.addEventListener("touchmove", function (e) {
      if (e.touches.length !== 2 || !pinch) return;
      var d = dist(e.touches);
      zoom(pinch / d);
      pinch = d;
    }, { passive: true });

    var tools = document.getElementById("hero-tools"), caption = document.getElementById("hero-caption");
    document.getElementById("zin").addEventListener("click", function () { zoom(0.85); });
    document.getElementById("zout").addEventListener("click", function () { zoom(1.18); });
    document.getElementById("reset").addEventListener("click", function () {
      camera.position.copy(HOME);
      controls.target.copy(TARGET);
      controls.update();
      wake();
    });
    var spinBtn = document.getElementById("spin"), spinIco = document.getElementById("spinIco");
    var PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
    var PLAY = '<path d="M7 5l12 7-12 7z"/>';
    function setSpin(on) {
      controls.autoRotate = on;
      spinIco.innerHTML = on ? PAUSE : PLAY;
      spinBtn.setAttribute("aria-label", on ? "Pause rotation" : "Start rotation");
      wake();
    }
    setSpin(!reduce);
    spinBtn.addEventListener("click", function () { setSpin(!controls.autoRotate); });
    controls.addEventListener("start", function () { setSpin(false); });
    controls.addEventListener("change", wake);

    function size() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake();
    }
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage);
    else window.addEventListener("resize", size);
    size();

    /* rendering pauses when the stage is off-screen or the tab is hidden; with reduced motion
       the scene is drawn only when something changes (drag, zoom, resize) */
    var visible = true, running = false;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) wake(); }).observe(stage);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });

    var clock = new THREE.Clock(), nextBlink = 2;
    function frame() {
      running = false;
      if (!visible || document.hidden) return;
      var t = clock.getElapsedTime();
      if (!reduce) {
        world.position.y = Math.sin(t * 1.1) * 0.07;
        head.rotation.z = Math.sin(t * 0.8) * 0.05;
        cap.rotation.z = Math.sin(t * 0.8) * 0.035;
        arms.forEach(function (a) { a[0].rotation.z = a[1] * (0.06 + Math.sin(t * 1.6 + a[1]) * 0.06); });
        dots.forEach(function (d) { d.position.y = d.userData.y + Math.sin(t * 1.3 + d.userData.ph) * 0.12; });
        var b = t - nextBlink, sy = b > 0 && b < 0.14 ? 0.12 : 1;
        eyes.forEach(function (e) { e.scale.y = sy; });
        if (b >= 0.14) nextBlink = t + 2.5 + Math.random() * 3;
      }
      controls.update();
      renderer.render(scene, camera);
      if (!reduce) schedule();
    }
    function schedule() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }
    function wake() {
      schedule();
    }

    await pause();
    renderer.compile(scene, camera);
    await pause();
    frame();
    stage.classList.add("is-3d");
    if (tools) tools.hidden = false;
    if (caption) caption.hidden = false;
  }
})();
