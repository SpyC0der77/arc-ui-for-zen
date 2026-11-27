/* Liquid Glass for the settings window's sliders, segmented controls and pop-up lists.
 *
 * The look and motion follow onemorethink.dev's Liquid Glass UI (MIT, Copyright (c) 2026
 * Bilal Abdullah Gürşen; licence in liquid-glass-LICENSE.txt). The slider's glass is a
 * WebGL2 port of that kit's lens shader (controls/glass/runtime.ts) and its spring and
 * press morph (physics.ts, RangeSlider.tsx). The segments adapt GlassLens to native
 * radios and refract a snapshot of their labels. The pop-up list follows GlassPopup's
 * stretching surface (glass-popup.tsx): the list melts out of the button, held by a neck
 * that thins and lets go, and the options arrive one after another; closing draws it back in.
 *
 * Behaviour stays native: the range input still takes the pointer and the keyboard, and
 * the list is a popover of buttons. Without WebGL2 every control keeps its CSS look. */
var ZenniaLiquidGlass = {
  install(window, { reduced: reducedMotion = () => false } = {}) {
    const XHTML = "http://www.w3.org/1999/xhtml";

    /* ---------- springs and the press morph (physics.ts) ---------- */
    const lerp = (a, b, t) => a + (b - a) * t;
    const saturate = v => Math.max(0, Math.min(1, v));
    function stepSpring(s, target, omega, zeta, dt) {
      const d = s.x - target;
      if (zeta > 0.9995) {
        const b = s.v + omega * d, e = Math.exp(-omega * dt);
        s.x = target + (d + b * dt) * e;
        s.v = (s.v - omega * b * dt) * e;
      } else {
        const wd = omega * Math.sqrt(1 - zeta * zeta);
        const b = (s.v + zeta * omega * d) / wd;
        const e = Math.exp(-zeta * omega * dt), cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
        const x = (d * cos + b * sin) * e;
        s.x = target + x;
        s.v = e * wd * (b * cos - d * sin) - zeta * omega * x;
      }
      const settled = Math.abs(s.x - target) < 5e-4 * Math.max(1, Math.abs(target)) && Math.abs(s.v) < 0.005;
      if (settled) { s.x = target; s.v = 0; }
      return !settled;
    }
    /** Seconds since the last frame. The springs are solved exactly, so a slow frame can take a
     *  long step without overshooting; only a stall (a hidden window) is capped. */
    const frameStep = (time, last) => (last ? Math.min(0.25, (time - last) / 1000) : 1 / 60);
    const PRESS = { omega: 16, zeta: 0.6 };
    const OPTICS = {
      refraction: 37, restRefraction: 6, bevelWidth: 62, cornerRadius: 126, magnification: 0,
      dispersion: 0.12, blurCenter: 0.35, blurEdge: 2.2, frostBlur: 4, rimIntensity: 0.55,
      topReflection: 0.3, innerShading: 0.1, causticStrength: 0.08,
      shadowOpacity: 0.12, shadowSoftness: 34, shadowOffset: 22,
    };
    function pressedLens(press, rest, lens, o = OPTICS) {
      const p = Math.max(-0.12, Math.min(1.15, press)), pc = saturate(press);
      const hx = lerp(rest.w / 2, lens.w / 2, p), hy = lerp(rest.h / 2, lens.h / 2, p);
      const frost = 1 - pc, clear = pc;
      return {
        hx, hy,
        radius: Math.min(lerp(rest.h / 2, o.cornerRadius, pc), Math.min(hx, hy) - 1),
        bevel: Math.max(lerp(rest.h * 0.42, o.bevelWidth, pc), 2),
        refract: lerp(o.restRefraction, o.refraction, pc) * lerp(0.06, 1, clear),
        mag: o.magnification * pc,
        disp: o.dispersion * clear,
        blurCenter: lerp(o.blurCenter, o.frostBlur, frost),
        blurEdge: lerp(o.blurEdge, o.frostBlur, frost),
        frost,
        rim: o.rimIntensity * lerp(0.04, 1, clear),
        caustic: o.causticStrength * clear,
        inner: o.innerShading * clear,
        topRefl: o.topReflection * clear,
        // The kit's resting pill casts no shadow on its grey page. These sliders sit on white
        // cards, so the pill keeps a faint one there to stay visible past the track.
        shadowOpacity: o.shadowOpacity * lerp(0.55, 1, pc) * Math.max(clear, 0.45),
        shadowSoftness: o.shadowSoftness * lerp(0.6, 1, pc),
        shadowOffset: o.shadowOffset * lerp(0.5, 1, pc),
      };
    }

    /* ---------- the lens shader (runtime.ts createMaterial), GLSL ES 3.0 ---------- */
    const VERTEX = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform vec2 uSize, uCenter, uHalf, uStretch, uShift;
uniform float uUnit, uDevicePx, uBlurShift, uRadius, uBevel, uRefract, uMag, uDisp, uBlurC, uBlurE;
uniform float uFrost, uRim, uCaustic, uInner, uTopRefl, uShOp, uShSoft, uShOff;
uniform vec3 uFrostCenter, uFrostEdge, uSurface;
uniform bool uPaintBackdrop, uPreserveInk;
in vec2 vUv; out vec4 outColor;
const float CENTER_FLATNESS = 1.4, NORMAL_STRENGTH = 42.0, EDGE_DISTORTION = 1.6, FRESNEL_POWER = 6.0, RIM_WIDTH = 1.1;
float sdRR(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec2 toUv(vec2 d) { vec2 px = d * uUnit; return clamp(vec2(px.x / uSize.x, 1.0 - px.y / uSize.y), vec2(0.0005), vec2(0.9995)); }
vec3 backdrop(vec2 st, float lod) { vec4 c = textureLod(uBg, st, lod); return c.rgb * c.a + (1.0 - c.a) * uSurface; }
vec3 dim(vec3 k) { return pow(clamp(k, 0.0, 1.0), vec3(1.0 / 2.2)); }
float dimf(float k) { return pow(clamp(k, 0.0, 1.0), 1.0 / 2.2); }
float glassHeight(vec2 p) {
  float t = pow(clamp(-sdRR(p, uHalf, uRadius) / uBevel, 0.0, 1.0), 1.0 / CENTER_FLATNESS);
  return sqrt(1.0 - pow(1.0 - t, 2.0));
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 p = px / uUnit;
  vec4 base = uPaintBackdrop ? texture(uBg, vUv) : vec4(0.0);
  vec2 local = (p - uCenter) / uStretch;
  float dist = sdRR(local, uHalf, uRadius);

  float vFade = smoothstep(-0.1, 0.9, local.y / uHalf.y) * 0.92 + 0.08;
  float outside = smoothstep(-4.0, 14.0, dist);
  float near = 1.0 - smoothstep(-6.0, uShSoft, sdRR(local - vec2(0.0, uShOff), uHalf, uRadius));
  float far = 1.0 - smoothstep(-10.0, uShSoft * 1.5, sdRR(local - vec2(0.0, uShOff * 1.6), uHalf, uRadius));
  float border = min(min(px.x, px.y), min(uSize.x - px.x, uSize.y - px.y));
  float shadow = clamp((near * uShOp + far * uShOp) * vFade * outside, 0.0, 0.85) * smoothstep(0.0, 14.0, border);
  float keep = dimf(1.0 - shadow);
  vec4 outsideCol = vec4(base.rgb * keep, base.a + (1.0 - base.a) * (1.0 - keep));

  float eps = 1.25;
  float h = glassHeight(local);
  vec2 hGrad = vec2(glassHeight(local + vec2(eps, 0.0)) - h, glassHeight(local + vec2(0.0, eps)) - h) / eps;
  vec3 normal = normalize(vec3(-hGrad * NORMAL_STRENGTH, 1.0));
  float depth = clamp(1.0 - h, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, uBevel * 0.35, -dist);
  vec2 sdfDir = normalize(vec2(sdRR(local + vec2(eps, 0.0), uHalf, uRadius) - dist, sdRR(local + vec2(0.0, eps), uHalf, uRadius) - dist) + 1e-6);

  vec2 magnified = local * (1.0 / (uMag * h + 1.0));
  vec2 refr = -sdfDir * uRefract * pow(edge, EDGE_DISTORTION);
  float disp = uDisp * 0.35;
  vec2 origin = uCenter + uShift;
  float lod = max(mix(uBlurC, uBlurE, pow(edge, 1.3)) + uBlurShift, 0.0);
  vec3 glass = vec3(
    backdrop(toUv(origin + magnified + refr * (disp + 1.0)), lod).r,
    backdrop(toUv(origin + magnified + refr), lod).g,
    backdrop(toUv(origin + magnified + refr * (1.0 - disp)), lod).b);

  float ny = local.y / uHalf.y, nx = local.x / uHalf.x;
  float topRefl = (1.0 - smoothstep(-0.05, 0.75, ny)) * (nx * -0.12 + 1.0) * uTopRefl * 0.6 + 0.02;
  glass *= dim(1.0 - vec3(1.0, 1.0, 0.72) * topRefl);
  glass = mix(glass, mix(uFrostCenter, uFrostEdge, pow(depth, 1.6)), uFrost);
  if (uPreserveInk) glass += (backdrop(vUv, 0.0) - uSurface) * uFrost;

  float up = clamp(-sdfDir.y, 0.0, 1.0), right = clamp(sdfDir.x, 0.0, 1.0);
  float left = clamp(-sdfDir.x, 0.0, 1.0), down = clamp(sdfDir.y, 0.0, 1.0);
  float innerBand = smoothstep(uBevel * -0.19, uBevel * -0.024, dist);
  glass *= dimf(1.0 - innerBand * (up + left * 0.6 + right * 0.3 + down * 0.15) * uInner * 2.2);
  float deepBand = smoothstep(uBevel * -0.73, uBevel * -0.13, dist);
  glass *= dimf(1.0 - deepBand * left * uInner * 2.0);
  float ring = exp(-pow((dist + uBevel * 0.45) / (uBevel * 0.26), 2.0));
  glass *= dimf(1.0 - ring * (right * 0.9 + up * 0.5 + left * 0.4 + down * 0.3) * uInner * 1.5);

  float fresnel = pow(clamp(1.0 - normal.z, 0.0, 1.0), FRESNEL_POWER);
  float rimW = max(uDevicePx * RIM_WIDTH, 1.0);
  float rim = 1.0 - smoothstep(0.0, rimW * 1.6, abs(dist + rimW * 1.8));
  float rimFalloff = exp(-pow(local.y / 30.0, 2.0));
  float rimDir = pow(right, 2.0) * rimFalloff * 0.9 + pow(down, 2.0) * 0.2 + pow(left, 2.0) * 0.55;
  vec3 warmCool = mix(vec3(0.82, 0.9, 1.08), vec3(1.2, 0.95, 0.78), 1.0 - smoothstep(-0.5, 0.1, nx));
  vec3 rimCol = mix(vec3(1.0), warmCool, down * 0.6);
  rimCol = mix(rimCol, vec3(0.12, 0.6, 1.2), left * 0.85);
  glass += rimCol * (rim * rimDir * uRim + fresnel * right * 0.02);
  glass += vec3(1.0, 0.92, 0.86) * smoothstep(0.72, 0.98, depth) * down * uCaustic;

  float aa = max(fwidth(dist), 1e-4);
  float mask = 1.0 - smoothstep(-aa, aa, dist);
  vec4 col = mix(outsideCol, vec4(clamp(glass, 0.0, 1.0), 1.0), mask);
  outColor = vec4(col.rgb * col.a, col.a);
}`;
    const UNIFORMS = ["uBg", "uSize", "uCenter", "uHalf", "uStretch", "uShift", "uUnit", "uDevicePx", "uBlurShift",
      "uRadius", "uBevel", "uRefract", "uMag", "uDisp", "uBlurC", "uBlurE", "uFrost", "uRim", "uCaustic",
      "uInner", "uTopRefl", "uShOp", "uShSoft", "uShOff", "uFrostCenter", "uFrostEdge", "uSurface", "uPaintBackdrop", "uPreserveInk"];
    const SHADER_DPR_REF = 2.27;

    /* ---------- the pop-up list's shape (glass-popup.tsx), GLSL ES 3.0 ----------
       The list melts out of its button: a smooth union of the button's pill and the list's box,
       softened most at the neck (engine.ts blobSoft). The button paints itself, so only the part
       outside it is drawn here, plus its border where the neck leaves it, so the two read as one. */
    const GOO = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uDpr, uRadius, uLineWidth, uShadowY, uShadowBlur;
uniform vec4 uButton, uList, uFill, uLine, uShadow;
uniform vec3 uNeck;
in vec2 vUv; out vec4 outColor;
float sdRR(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float button(vec2 p) { return sdRR(p - uButton.xy, uButton.zw, uButton.w); }
float list(vec2 p) { return sdRR(p - uList.xy, uList.zw, uRadius); }
float shape(vec2 p) {
  float a = button(p), b = list(p);
  float n = (p.x - uNeck.y) / uNeck.z;
  float k = max(uNeck.x * exp(0.2 - sqrt(n * n + 0.04)), 1e-3);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// Abramowitz and Stegun 7.1.27: close enough to a Gaussian for a box-shadow's falloff.
float erf(float x) {
  float s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
  x *= x;
  return s - s / (x * x);
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize / uDpr;
  float aa = 0.75 / uDpr;
  float d = shape(p), b = button(p);
  // Outside the button, or on its border where goo lies just past it.
  vec2 normal = normalize(vec2(button(p + vec2(0.5, 0.0)) - button(p - vec2(0.5, 0.0)),
    button(p + vec2(0.0, 0.5)) - button(p - vec2(0.0, 0.5))) + 1e-6);
  float border = (1.0 - smoothstep(1.0, 2.0, -b)) * (1.0 - smoothstep(-aa, aa, shape(p + normal * (1.5 - b))));
  float glass = (1.0 - smoothstep(-aa, aa, d)) * max(smoothstep(-aa, aa, b), border) * uFill.a;
  float line = 1.0 - smoothstep(uLineWidth - aa, uLineWidth + aa, -d);
  vec3 fill = mix(uFill.rgb, uLine.rgb, line * uLine.a);
  // The list's CSS box-shadow: offset down, a Gaussian of half the blur radius.
  float sigma = uShadowBlur * 0.5;
  float shadow = uShadow.a * (0.5 - 0.5 * erf(list(p - vec2(0.0, uShadowY)) / (sigma * 1.4142)));
  float under = shadow * (1.0 - glass);
  outColor = vec4(fill * glass + uShadow.rgb * under, glass + under);
}`;
    const GOO_UNIFORMS = ["uSize", "uDpr", "uRadius", "uLineWidth", "uShadowY", "uShadowBlur", "uButton", "uList", "uFill", "uLine", "uShadow", "uNeck"];

    // The controls in a document share one WebGL2 renderer; each copies its frame onto its own 2D canvas.
    const renderers = new WeakMap();
    function rendererFor(doc) {
      if (renderers.has(doc)) return renderers.get(doc);
      let renderer = null;
      try {
        const canvas = doc.createElementNS(XHTML, "canvas");
        const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
        if (gl) {
          const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
            return shader;
          };
          const link = (fragment, uniforms) => {
            const program = gl.createProgram();
            gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
            gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
            gl.bindAttribLocation(program, 0, "aPos");
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            return { program, loc: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program, name)])) };
          };
          const lens = link(FRAGMENT, UNIFORMS), goo = link(GOO, GOO_UNIFORMS);
          const quad = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, quad);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.useProgram(lens.program);
          gl.uniform1i(lens.loc.uBg, 0);
          renderer = { canvas, gl, lens, goo, width: 0, height: 0, textures: new WeakMap() };
          // A lost context cannot be drawn to, and its textures are gone. Stay on the CSS look: no
          // event preventDefault, so the browser does not restore this context and rendererFor
          // never hands it out again.
          canvas.addEventListener("webglcontextlost", () => {
            renderers.set(doc, null);
            for (const item of controls) item.sync(false);
          });
        }
      } catch (error) {
        console.error("[Zennia] Liquid Glass controls fall back to CSS", error);
        renderer = null;
      }
      renderers.set(doc, renderer);
      return renderer;
    }

    /** The resting slider pill's frost: white at its middle, a cool grey at its rim. */
    const WHITE_PILL = [[1, 1, 1], [0xe9 / 255, 0xeb / 255, 0xef / 255]];
    /** Selects a program, and a viewport the target's size in the shared canvas. */
    function begin(renderer, { program }, target) {
      const { gl } = renderer, w = target.width, h = target.height;
      if (renderer.width < w || renderer.height < h) {
        renderer.width = renderer.canvas.width = Math.max(renderer.width, w);
        renderer.height = renderer.canvas.height = Math.max(renderer.height, h);
      }
      gl.useProgram(program);
      gl.viewport(0, renderer.height - h, w, h);
    }
    /** Draws the quad and copies the frame onto the target's own 2D canvas. */
    function present(renderer, target) {
      const { gl } = renderer, w = target.width, h = target.height;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const ctx = target.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(renderer.canvas, 0, 0, w, h, 0, 0, w, h);
    }
    function draw(renderer, target, background, spec) {
      const { gl } = renderer, { loc } = renderer.lens;
      const w = target.width, h = target.height;
      begin(renderer, renderer.lens, target);
      // Each backdrop has its own texture, uploaded only when the control redrew it.
      let texture = renderer.textures.get(background);
      if (!texture) {
        texture = { handle: gl.createTexture(), version: -1 };
        gl.bindTexture(gl.TEXTURE_2D, texture.handle);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        renderer.textures.set(background, texture);
      }
      gl.bindTexture(gl.TEXTURE_2D, texture.handle);
      const version = backdropVersions.get(background) ?? 0;
      if (texture.version !== version) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, background);
        gl.generateMipmap(gl.TEXTURE_2D);
        texture.version = version;
      }
      const l = spec.lens;
      gl.uniform2f(loc.uSize, w, h);
      gl.uniform1f(loc.uUnit, spec.unit * spec.dpr);
      gl.uniform1f(loc.uDevicePx, 1 / (spec.unit * spec.dpr));
      gl.uniform1f(loc.uBlurShift, Math.log2(Math.max(spec.unit * spec.dpr / SHADER_DPR_REF, 1e-3)));
      gl.uniform2f(loc.uCenter, spec.x, spec.y);
      gl.uniform2f(loc.uHalf, Math.max(l.hx, 0.5), Math.max(l.hy, 0.5));
      gl.uniform2f(loc.uStretch, spec.stretchX, spec.stretchY);
      gl.uniform2f(loc.uShift, spec.shiftX, 0);
      gl.uniform1f(loc.uRadius, Math.max(0, Math.min(l.radius, Math.min(l.hx, l.hy) - 0.5)));
      gl.uniform1f(loc.uBevel, Math.max(l.bevel, 1));
      for (const [name, value] of [["uRefract", l.refract], ["uMag", l.mag], ["uDisp", l.disp], ["uBlurC", l.blurCenter],
        ["uBlurE", l.blurEdge], ["uFrost", l.frost], ["uRim", l.rim], ["uCaustic", l.caustic], ["uInner", l.inner],
        ["uTopRefl", l.topRefl], ["uShOp", l.shadowOpacity], ["uShSoft", l.shadowSoftness], ["uShOff", l.shadowOffset]])
        gl.uniform1f(loc[name], value);
      const [frostCenter, frostEdge] = spec.frost ?? WHITE_PILL;
      gl.uniform3fv(loc.uFrostCenter, frostCenter);
      gl.uniform3fv(loc.uFrostEdge, frostEdge);
      gl.uniform3f(loc.uSurface, ...spec.surface);
      gl.uniform1i(loc.uPaintBackdrop, spec.paintBackdrop !== false);
      gl.uniform1i(loc.uPreserveInk, !!spec.preserveInk);
      present(renderer, target);
    }

    // The host passes the resolved theme. Computed colours can still be mid-transition
    // after a mode switch, and a 2D canvas would keep them.
    const PALETTES = {
      light: { track: "#c6c5c9", well: "#0000000d", card: [1, 1, 1], window: [0.925, 0.925, 0.925], segment: [1, 1, 1] },
      dark: { track: "#34353b", well: "#ffffff14", card: [0.173, 0.173, 0.173], window: [0.165, 0.165, 0.165], segment: [0.36, 0.36, 0.38] },
    };
    const ACCENT = "#3291ff";
    let palette = PALETTES.light;
    const controls = new Set();

    /** How many times each backdrop canvas has been redrawn, so draw() re-uploads only changed ones. */
    const backdropVersions = new WeakMap();
    /** Sizes a control's output canvas and its backdrop, and returns the backdrop's context in CSS px. */
    function prepareCanvas(canvas, background, dpr, width, height, left, top) {
      backdropVersions.set(background, (backdropVersions.get(background) ?? 0) + 1);
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h || background.width !== w || background.height !== h) {
        canvas.width = background.width = w;
        canvas.height = background.height = h;
      }
      Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px` });
      const ctx = background.getContext("2d");
      ctx.resetTransform();
      ctx.clearRect(0, 0, w, h);
      ctx.scale(dpr, dpr);
      return ctx;
    }
    function pill(ctx, x, y, w, h, color) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, h / 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    const usable = doc => {
      const renderer = rendererFor(doc);
      return !!renderer && !renderer.gl.isContextLost();
    };

    /* ---------- slider (RangeSlider.tsx) ---------- */
    // Design units per CSS px, and the pill's size at rest and held, sized for the settings rows.
    const UNIT = 0.3;
    const THUMB = { w: 34, h: 20 };
    const REST = { w: THUMB.w / UNIT, h: THUMB.h / UNIT };
    const LENS = { w: 66 / UNIT, h: 35 / UNIT };
    /** CSS px: the track's height, and room around it for the swollen lens and its shadow. */
    const TRACK = 8, PAD_X = 42, PAD_TOP = 28, PAD_BOTTOM = 56;
    const VALUE = { omega: 30, zeta: 1 };

    function slider(input) {
      const doc = input.ownerDocument;
      const wrapper = doc.createElementNS(XHTML, "div");
      wrapper.className = "zennia-glass-slider";
      wrapper.style.setProperty("--glass-thumb-width", `${THUMB.w}px`);
      wrapper.style.setProperty("--glass-thumb-height", `${THUMB.h}px`);
      const canvas = doc.createElementNS(XHTML, "canvas");
      canvas.setAttribute("aria-hidden", "true");
      input.replaceWith(wrapper);
      wrapper.append(canvas, input);
      const background = doc.createElementNS(XHTML, "canvas");
      const view = () => wrapper.ownerDocument.defaultView;
      // `value` is null until the pill has been placed; it then follows the input on a spring.
      let value = null, press = { x: 0, v: 0 }, stretch = 0, pressed = false;
      let enabled = false, frame = 0, last = 0, pointer = null, backdrop = "";

      const fraction = () => {
        const min = Number(input.min || 0), max = Number(input.max || 100);
        return max > min ? saturate((Number(input.value) - min) / (max - min)) : 0;
      };
      function render() {
        const width = wrapper.clientWidth;
        if (!enabled || !width || !value) return;
        const dpr = view().devicePixelRatio || 1;
        const at = saturate(value.x);
        const thumb = THUMB.w / 2 + at * (width - THUMB.w);
        // The track only changes with the value, size or theme; a press alone reuses it.
        const key = [width, wrapper.clientHeight, dpr, at, palette.track].join();
        if (key !== backdrop) {
          backdrop = key;
          const ctx = prepareCanvas(canvas, background, dpr, width + 2 * PAD_X, PAD_TOP + PAD_BOTTOM,
            -PAD_X, wrapper.clientHeight / 2 - PAD_TOP);
          const trackTop = PAD_TOP - TRACK / 2;
          pill(ctx, PAD_X, trackTop, width, TRACK, palette.track);
          // At the top end the short unfilled tail would show through the held lens.
          if (at > 0) pill(ctx, PAD_X, trackTop, at === 1 ? width : thumb, TRACK, ACCENT);
        }
        draw(rendererFor(doc), canvas, background, {
          lens: pressedLens(press.x, REST, LENS), unit: UNIT, dpr, surface: palette.card,
          x: (PAD_X + thumb) / UNIT, y: PAD_TOP / UNIT,
          stretchX: 1 + Math.abs(stretch), stretchY: 1 - Math.abs(stretch) * 0.45, shiftX: stretch * -60,
        });
      }
      function tick(time) {
        frame = 0;
        const dt = frameStep(time, last);
        last = time;
        let moving = false;
        if (!value || reducedMotion()) {
          value = { x: fraction(), v: 0 };
          press = { x: pressed ? 1 : 0, v: 0 };
          stretch = 0;
        } else {
          moving = stepSpring(value, fraction(), VALUE.omega, VALUE.zeta, dt);
          // Squash and stretch with speed (design units per second).
          const speed = value.v * wrapper.clientWidth / UNIT;
          stretch += (Math.max(-0.04, Math.min(0.04, speed * 9e-5)) - stretch) * Math.min(1, dt * 18);
          moving = stepSpring(press, pressed ? 1 : 0, PRESS.omega, PRESS.zeta, dt) || moving || Math.abs(stretch) > 1e-4;
        }
        render();
        if (moving) wake();
        else last = 0;
      }
      function wake() {
        if (enabled && !frame && wrapper.isConnected) frame = view().requestAnimationFrame(tick);
      }
      function release() {
        pointer?.abort();
        pointer = null;
        pressed = false;
        wake();
      }
      input.addEventListener("pointerdown", event => {
        if (event.button !== 0 || input.disabled) return;
        pointer?.abort();
        pointer = new window.AbortController();
        pressed = true;
        wake();
        const win = view(), signal = pointer.signal;
        win.addEventListener("pointerup", release, { capture: true, signal });
        win.addEventListener("pointercancel", release, { capture: true, signal });
        win.addEventListener("blur", release, { signal });
      });
      input.addEventListener("input", wake);

      const controller = {
        /** Turns the glass on or off (`on`), or redraws after an outside change. */
        sync(on, paletteChanged) {
          if (on !== undefined) {
            enabled = on && usable(doc);
            wrapper.toggleAttribute("data-glass", enabled);
            if (!enabled) {
              pointer?.abort();
              pointer = null;
              pressed = false;
              if (frame) view().cancelAnimationFrame(frame);
              frame = last = 0;
              value = null;
              press = { x: 0, v: 0 };
              stretch = 0;
            }
          }
          if (!enabled || !wrapper.isConnected || frame) return;
          if (!value || Math.abs(value.x - fraction()) < 1e-6) {
            value = { x: fraction(), v: 0 };
            render();
          } else {
            if (paletteChanged) render();
            wake();
          }
        },
        destroy() {
          resize.disconnect();
          controller.sync(false);
          controls.delete(controller);
        },
      };
      const resize = new window.ResizeObserver(() => controller.sync());
      resize.observe(wrapper);
      controls.add(controller);
    }

    /* ---------- segmented controls (GlassLens) ---------- */
    // The pill slides to a new choice as a clear lens, then settles back into the frosted CSS pill.
    const SEGMENT_SLIDE = { omega: 21, zeta: 0.83 };
    const SEGMENT_DRAG = { omega: 48, zeta: 1 };
    const SEGMENT_SWELL = { omega: 23, zeta: 0.82 };
    // Back to the resting pill quickly, so the CSS pill and its highlight return at once.
    const SEGMENT_SETTLE = { omega: 30, zeta: 0.92 };
    /** CSS px around the rail for the swollen lens and its shadow. */
    const SEG_PAD = { x: 18, top: 14, bottom: 26 };

    function segment(root) {
      const doc = root.ownerDocument;
      const canvas = doc.createElementNS(XHTML, "canvas");
      canvas.className = "zennia-segment-lens";
      canvas.setAttribute("aria-hidden", "true");
      root.prepend(canvas);
      const background = doc.createElementNS(XHTML, "canvas");
      const surface = root.classList.contains("zennia-edit-mode") ? "window" : "card";
      const view = () => root.ownerDocument.defaultView;
      const position = { x: 0, v: 0 }, width = { x: 0, v: 0 }, press = { x: 0, v: 0 };
      let enabled = false, target = null, gesture = null, snapshot = null, frame = 0, last = 0;

      const options = () => Array.from(root.querySelectorAll(":scope > label"), item => ({
        input: item.control, x: item.offsetLeft + item.offsetWidth / 2, w: item.offsetWidth, h: item.offsetHeight,
      })).filter(box => box.w && box.h);
      const checked = () => options().find(box => box.input.checked) ?? null;
      const nearest = (boxes, x) => boxes.reduce((best, box) => (Math.abs(x - box.x) < Math.abs(x - best.x) ? box : best));
      const optionAt = (boxes, x) => boxes.find(box => Math.abs(x - box.x) < box.w / 2) ?? nearest(boxes, x);

      /** Puts the lens at rest on the selected choice; it fades out over the CSS pill (settings.css).
       *  data-glass-refraction stays, so the lens keeps its place over the labels while it fades. */
      function rest() {
        if (frame) view().cancelAnimationFrame(frame);
        frame = last = 0;
        snapshot = null;
        position.x = target?.x ?? 0;
        width.x = target?.w ?? 0;
        position.v = width.v = press.x = press.v = 0;
        root.removeAttribute("data-glass-traveling");
      }
      /** Snapshots the rail and its labels once per travel, so the lens can bend them. */
      function sample(dpr) {
        const h = root.clientHeight, w = root.clientWidth;
        const ctx = prepareCanvas(canvas, background, dpr, w + 2 * SEG_PAD.x, SEG_PAD.top + h + SEG_PAD.bottom, -SEG_PAD.x, -SEG_PAD.top);
        const rect = root.getBoundingClientRect();
        root.setAttribute("data-glass-sampling", "");
        ctx.save();
        try {
          ctx.translate(SEG_PAD.x, SEG_PAD.top);
          ctx.drawWindow(view(), rect.left, rect.top, w, h, "transparent");
          const pixel = ctx.getImageData(Math.round((SEG_PAD.x + 5) * dpr), Math.round((SEG_PAD.top + h / 2) * dpr), 1, 1).data;
          if (pixel[3]) return { dpr, w, h, ink: true, backdrop: [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255] };
        } catch {
          // drawWindow only works in privileged documents; fall back to a plain rail.
        } finally {
          ctx.restore();
          root.removeAttribute("data-glass-sampling");
        }
        ctx.clearRect(0, 0, w + 2 * SEG_PAD.x, SEG_PAD.top + h + SEG_PAD.bottom);
        pill(ctx, SEG_PAD.x, SEG_PAD.top, w, h, palette.well);
        return { dpr, w, h, ink: false, backdrop: palette[surface] };
      }
      function paint() {
        if (!usable(doc)) return false;
        const dpr = view().devicePixelRatio || 1;
        if (!snapshot || snapshot.dpr !== dpr || snapshot.w !== root.clientWidth || snapshot.h !== root.clientHeight) {
          snapshot = sample(dpr);
          root.toggleAttribute("data-glass-refraction", snapshot.ink);
        }
        const unit = target.h / 80;
        const restSize = { w: width.x / unit, h: 80 };
        const lens = pressedLens(press.x, restSize, { w: restSize.w * 1.12, h: restSize.h * 1.35 });
        lens.radius = Math.min(lens.hx, lens.hy);
        lens.mag = 0.12 * saturate(press.x);
        // The compact rail keeps strong edge distortion away from its labels.
        lens.refract *= 0.55;
        lens.disp *= 0.5;
        lens.shadowOpacity *= 0.5;
        draw(rendererFor(doc), canvas, background, {
          lens, unit, dpr, surface: snapshot.backdrop, frost: [palette.segment, palette.segment],
          paintBackdrop: false, preserveInk: snapshot.ink,
          x: (SEG_PAD.x + position.x) / unit, y: (SEG_PAD.top + snapshot.h / 2) / unit,
          stretchX: 1, stretchY: 1, shiftX: 0,
        });
        if (!root.hasAttribute("data-glass-traveling")) root.setAttribute("data-glass-traveling", "");
        return true;
      }
      function tick(time) {
        frame = 0;
        if (reducedMotion() || !target || !root.clientWidth) { endGesture(); rest(); return; }
        const dt = frameStep(time, last);
        last = time;
        const goal = gesture?.preview ?? target;
        const x = gesture?.x ?? goal.x;
        const slide = gesture?.dragging ? SEGMENT_DRAG : SEGMENT_SLIDE;
        let moving = stepSpring(position, x, slide.omega, slide.zeta, dt);
        moving = stepSpring(width, goal.w, slide.omega, slide.zeta, dt) || moving;
        // Swollen while held or still on its way; settles quickly once it arrives.
        const swollen = !!gesture || Math.abs(position.x - x) > goal.w * 0.06;
        const morph = swollen ? SEGMENT_SWELL : SEGMENT_SETTLE;
        moving = stepSpring(press, swollen ? 1 : 0, morph.omega, morph.zeta, dt) || moving;
        if (!gesture && Math.abs(position.x - x) < 0.5 && Math.abs(position.v) < 20 &&
            Math.abs(width.x - goal.w) < 0.5 && Math.abs(press.x) < 0.04) {
          rest();
          return;
        }
        if (!paint()) { endGesture(); rest(); return; }
        if (moving) wake();
        else last = 0;
      }
      function wake() {
        if (!frame) frame = view().requestAnimationFrame(tick);
      }
      function endGesture() {
        gesture?.listeners.abort();
        gesture = null;
        root.removeAttribute("data-glass-dragging");
      }
      function down(event) {
        const label = event.target.closest("label");
        if (!enabled || reducedMotion() || event.button !== 0 || label?.parentElement !== root) return;
        // A new press always takes over, even if an earlier gesture never saw its release.
        endGesture();
        target ??= checked();
        const boxes = options();
        const preview = boxes.find(box => box.input === label.control);
        if (!target || !preview) return;
        const localX = e => e.clientX - root.getBoundingClientRect().left;
        const startX = localX(event), pointerId = event.pointerId;
        const min = Math.min(...boxes.map(box => box.x)), max = Math.max(...boxes.map(box => box.x));
        const listeners = new window.AbortController();
        const current = gesture = { preview, listeners, x: preview.x, dragging: false };
        const win = view(), listen = { capture: true, signal: listeners.signal };
        win.addEventListener("pointermove", e => {
          if (e.pointerId !== pointerId) return;
          const x = localX(e);
          const option = optionAt(boxes, x);
          if (!current.dragging) {
            if (option === preview && Math.abs(x - startX) < 4) return;
            // Dragging retargets the native click to the rail, so release selects the choice itself.
            root.setPointerCapture(pointerId);
            root.setAttribute("data-glass-dragging", "");
            current.dragging = true;
          }
          current.x = Math.max(min, Math.min(max, x));
          current.preview = option;
          wake();
        }, listen);
        const end = e => {
          if (e.pointerId !== undefined && e.pointerId !== pointerId) return;
          const selected = current.dragging && e.type === "pointerup" ? optionAt(boxes, localX(e)).input : null;
          endGesture();
          if (selected) {
            selected.focus({ preventScroll: true });
            selected.click();
          }
          wake();
        };
        win.addEventListener("pointerup", end, listen);
        win.addEventListener("pointercancel", end, listen);
        root.addEventListener("lostpointercapture", end, { signal: listeners.signal });
        win.addEventListener("blur", end, { signal: listeners.signal });
        wake();
      }

      const controller = {
        sync(on, paletteChanged) {
          if (on !== undefined) enabled = on && usable(doc);
          const next = enabled ? checked() : null;
          if (!next || !target || reducedMotion()) {
            target = next;
            endGesture();
            rest();
          } else if (next.input !== target.input) {
            // A new choice: travel there from where the pill is.
            target = next;
            if (paletteChanged) snapshot = null;
            wake();
          } else if (next.x !== target.x || next.w !== target.w || next.h !== target.h) {
            // The rail was laid out again (shown, resized): jump.
            target = next;
            endGesture();
            rest();
          } else if (paletteChanged && root.hasAttribute("data-glass-traveling")) {
            snapshot = null;
            wake();
          }
        },
        destroy() {
          resize.disconnect();
          root.removeEventListener("pointerdown", down);
          root.removeEventListener("change", onChange);
          controller.sync(false);
          canvas.remove();
          controls.delete(controller);
        },
      };
      const onChange = () => controller.sync();
      const resize = new window.ResizeObserver(() => controller.sync());
      resize.observe(root);
      root.addEventListener("pointerdown", down);
      root.addEventListener("change", onChange);
      controls.add(controller);
    }

    /* ---------- pop-up list (glass-popup.tsx's stretching surface) ---------- */
    // GOOEY (engine.ts) for a wide control: the list opens on one spring and is held to its button
    // by a bridge until it is `detach` open; the bridge then thins into a neck at the button's middle
    // and lets go. Closing pulls the list back in on a quicker spring, and the bridge forms again
    // as it nears the button (`rejoin`), so the close mirrors the opening.
    const POPUP = {
      open: { omega: 11, zeta: 0.82 },
      close: { omega: 26, zeta: 0.7 },
      attach: { omega: 28, zeta: 1 },
      thin: { omega: 5.6, zeta: 1 },
      letGo: { omega: 16, zeta: 1 },
      detach: 0.1,
      rejoin: [0.25, 0.8],
      /** Px: the bridge's softness at full strength, and how far the list leans back to the button while held. */
      softness: 50,
      pull: 11,
      /** Px the button sags towards the list while they hold on. */
      sag: 6,
      /** The options: how far open the list is when the first appears, then the gap and fade (seconds), and how fast they leave. */
      itemsAt: 0.85,
      itemsGap: 0.06,
      itemsFade: 0.22,
      itemsOut: 0.07,
    };
    const smooth = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    /** A computed CSS colour as straight RGBA, 0–1. */
    const rgba = css => {
      const [r = 0, g = 0, b = 0, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
      return [r / 255, g / 255, b / 255, a];
    };

    function popup(trigger, menu, { gap = () => 12, glass = () => true } = {}) {
      const doc = trigger.ownerDocument;
      const canvas = doc.createElementNS(XHTML, "canvas");
      canvas.className = "zennia-glass-goo";
      canvas.setAttribute("aria-hidden", "true");
      menu.prepend(canvas);
      const view = () => menu.ownerDocument.defaultView;
      const items = () => [...menu.children].filter(child => child !== canvas);
      // Shut, the list is all bridge: it holds on from the first frame it comes out.
      const open = { x: 0, v: 0 }, bridge = { x: 1, v: 0 };
      // `shown` is the list's own fade, `reveal` seconds since its first option started to come in.
      let target = 0, below = true, joined = false, snapped = false, shown = 0, reveal = 0, frame = 0, last = 0;

      const animated = () => glass() && !reducedMotion() && usable(menu.ownerDocument);
      function place() {
        const win = view(), t = trigger.getBoundingClientRect();
        menu.style.minWidth = glass() ? `${t.width}px` : "";
        const width = menu.offsetWidth, height = menu.offsetHeight, g = gap();
        below = t.bottom + g + height <= win.innerHeight - 8 || t.top - g - height < 8;
        const left = t.left + (glass() ? (t.width - width) / 2 : 0);
        menu.style.left = `${Math.max(8, Math.min(left, win.innerWidth - width - 8))}px`;
        menu.style.top = `${below ? t.bottom + g : t.top - g - height}px`;
      }
      /** Draws this frame: the button sags on its bridge, the list grows out of it, the options come in. */
      function paint() {
        const dir = below ? 1 : -1, p = saturate(open.x), b = saturate(bridge.x);
        // The list overshoots a little as it lands, and dips under the button as it goes back in.
        const y = Math.max(-0.04, Math.min(1.08, open.x));
        const hold = b * smooth(0, 0.6, p);
        const w = trigger.offsetWidth, h = trigger.offsetHeight;
        trigger.style.translate = hold ? `0 ${(dir * POPUP.sag * hold).toFixed(2)}px` : "";
        trigger.style.scale = hold ? `${(1 - (1.5 * hold) / (w / 2)).toFixed(4)} ${(1 + hold / (h / 2)).toFixed(4)}` : "";

        const t = trigger.getBoundingClientRect(), list = menu.getBoundingClientRect();
        const edge = below ? t.bottom : t.top, cx = t.left + t.width / 2;
        // The list starts inside the button. Its near edge crosses the gap first and leans back
        // towards the button while the bridge holds.
        const near = lerp(edge - dir * 6, (below ? list.top : list.bottom) - dir * POPUP.pull * b, smooth(0, 0.3, p));
        const far = lerp(edge - dir, below ? list.bottom : list.top, y);
        const reach = dir * (far - edge);
        const hx = lerp(t.width * 0.3, list.width / 2, y), hy = Math.max(Math.abs(far - near) / 2, 0.5);
        // Soft as the list comes out: at full strength inside the button it would swell it, and with
        // none the list would leave as a slab under the button.
        const k = Math.max(POPUP.softness * b * smooth(-12, 60, reach), 0.05);
        // Two facing edges stay bridged while the softness is over twice the gap between them.
        joined = k > 2 * Math.max(dir * (near - edge), 0);
        const radius = parseFloat(view().getComputedStyle(menu).borderTopLeftRadius) || 24;

        const renderer = rendererFor(menu.ownerDocument), win = view(), dpr = win.devicePixelRatio || 1;
        const width = Math.round(win.innerWidth * dpr), height = Math.round(win.innerHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        // settings.css sets the goo's colours on the canvas: color is the frost,
        // text-decoration-color the edge line, outline-color the shadow.
        const style = win.getComputedStyle(canvas);
        const { gl } = renderer, { loc } = renderer.goo;
        begin(renderer, renderer.goo, canvas);
        gl.uniform2f(loc.uSize, width, height);
        gl.uniform1f(loc.uDpr, dpr);
        gl.uniform4f(loc.uButton, cx, (t.top + t.bottom) / 2, t.width / 2, t.height / 2);
        gl.uniform4f(loc.uList, lerp(cx, list.left + list.width / 2, p), (near + far) / 2, hx, hy);
        // Still attached, the list is rounder: surface tension lets go as the neck does.
        gl.uniform1f(loc.uRadius, Math.min(lerp(radius, radius * 1.8, b), hx, hy));
        gl.uniform3f(loc.uNeck, k, cx, t.width * lerp(0.2, 0.6, b));
        gl.uniform4fv(loc.uFill, rgba(style.color));
        gl.uniform4fv(loc.uLine, rgba(style.textDecorationColor));
        gl.uniform1f(loc.uLineWidth, 1.3);
        // The shadow comes out with the list.
        const shadow = rgba(style.outlineColor);
        gl.uniform4f(loc.uShadow, shadow[0], shadow[1], shadow[2], shadow[3] * smooth(0, 48, reach));
        gl.uniform1f(loc.uShadowY, 14);
        gl.uniform1f(loc.uShadowBlur, 34);
        present(renderer, canvas);

        items().forEach((item, i) => {
          const o = saturate((reveal - i * POPUP.itemsGap) / POPUP.itemsFade) * shown;
          item.style.opacity = String(o);
          item.style.translate = o < 1 ? `0 ${((1 - o) * 6).toFixed(2)}px` : "";
        });
      }
      function clearMotion() {
        for (const item of items()) item.style.opacity = item.style.translate = "";
        trigger.style.translate = trigger.style.scale = "";
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      }
      function stop() {
        if (frame) view().cancelAnimationFrame(frame);
        frame = last = 0;
      }
      /** At rest and open: the CSS list takes over from the canvas. */
      function finishOpen() {
        stop();
        clearMotion();
        open.x = shown = 1;
        open.v = bridge.x = bridge.v = 0;
        reveal = Infinity;
        joined = snapped = false;
        menu.setAttribute("data-glass-state", "open");
      }
      function finishClose() {
        stop();
        clearMotion();
        menu.removeAttribute("data-glass-state");
        if (menu.matches(":popover-open")) menu.hidePopover();
        open.x = open.v = bridge.v = shown = reveal = 0;
        bridge.x = 1;
        joined = snapped = false;
      }
      function tick(time) {
        frame = 0;
        if (!animated()) { if (target) finishOpen(); else finishClose(); return; }
        const dt = frameStep(time, last);
        last = time;
        const opening = target === 1;
        const spring = opening ? POPUP.open : POPUP.close;
        let moving = stepSpring(open, target, spring.omega, spring.zeta, dt);
        if (opening) {
          // Held while it starts out; once the neck breaks, what is left of the tension lets go at once.
          const held = open.x < POPUP.detach;
          const pull = held ? POPUP.attach : snapped ? POPUP.letGo : POPUP.thin;
          moving = stepSpring(bridge, held ? 1 : 0, pull.omega, pull.zeta, dt) || moving;
          shown = 1;
          if (open.x > POPUP.itemsAt) reveal += dt;
          moving ||= reveal < (items().length - 1) * POPUP.itemsGap + POPUP.itemsFade;
        } else {
          // Gone once nothing of it shows outside the button.
          if (open.x < 0.004) { finishClose(); return; }
          bridge.x = Math.max(bridge.x, 1 - smooth(...POPUP.rejoin, open.x));
          bridge.v = 0;
          // The options go ahead of the glass, before it draws back past them.
          shown = Math.min(Math.max(0, shown - dt / POPUP.itemsOut), smooth(0.75, 0.95, open.x));
          if (!shown) reveal = 0;
        }
        const wasJoined = joined;
        paint();
        if (opening && wasJoined && !joined) snapped = true;
        if (!opening) snapped = false;
        if (!moving) { finishOpen(); return; }
        frame = view().requestAnimationFrame(tick);
      }
      /** Starts the motion, drawing its first frame now so the CSS list never shows bare. */
      function animate() {
        menu.setAttribute("data-glass-state", "moving");
        paint();
        if (!frame) frame = view().requestAnimationFrame(tick);
      }

      const controller = {
        get open() { return target === 1; },
        show() {
          if (target === 1) return;
          target = 1;
          if (!menu.matches(":popover-open")) {
            menu.showPopover();
            place();
          }
          if (animated()) animate();
          else finishOpen();
        },
        hide(immediate = false) {
          if (!target && !frame) return;
          target = 0;
          if (immediate || !animated() || !menu.matches(":popover-open")) finishClose();
          else animate();
        },
        /** Glass turned off or its renderer lost: settle where the list is going. */
        sync(on) {
          if (on === false && frame) {
            if (target) finishOpen();
            else finishClose();
          }
        },
        destroy() {
          finishClose();
          canvas.remove();
          controls.delete(controller);
        },
      };
      controls.add(controller);
      return controller;
    }

    return {
      slider,
      segment,
      popup,
      /** `on` turns the glass on or off; `mode` ("light" or "dark") is the resolved theme. */
      sync(on, mode) {
        const previous = palette;
        if (mode) palette = mode === "dark" ? PALETTES.dark : PALETTES.light;
        for (const item of controls) item.sync(on, palette !== previous);
      },
      destroy() { for (const item of [...controls]) item.destroy(); },
    };
  },
};
