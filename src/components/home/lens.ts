// Fisheye lens, ported from the reference site's projection (module 67929 + its cube-map shader).
//
// The reference renders the scene into a cube map and, for every screen pixel, finds the ray
// angle θ whose screen radius matches: radius(θ) = mix(focal·tanθ, R·sin(θ/2), amount), with
// focal = H / (2·tan 24°) (a 48° camera) and R = 0.86·hypot(W, H). Tiles also grow by
// 1 + 1.35·amount. Our tiles lie flat on that plane, so the same mapping can be applied
// forward, per vertex, to finely subdivided tile meshes: a flat point at radius r sits at
// θ = atan(r / focal) and lands at radius(θ) on screen. Same picture, no cube map.

export const LENS_CELL_GAIN = 1.35;
const FOV_HALF = (24 * Math.PI) / 180;
const THETA_MAX = 1.48; // widest ray the reference solves for
const MESH = 32; // subdivisions per tile edge: enough for smooth curves

export const lensCellScale = (amount: number) => 1 + LENS_CELL_GAIN * amount;

export function lensOptics(W: number, H: number) {
  return { focal: H / (2 * Math.tan(FOV_HALF)), radius: 0.86 * Math.hypot(W, H) };
}

type Optics = ReturnType<typeof lensOptics>;

/** Screen radius (px from centre) of a flat point at radius `r`. */
export function projectRadius(r: number, amount: number, o: Optics) {
  if (amount <= 0 || r < 1e-6) return r;
  const theta = Math.atan(r / o.focal);
  return r + (o.radius * Math.sin(theta / 2) - r) * amount;
}

/** Flat radius that lands at screen radius `sr` (inverse of projectRadius). */
export function unprojectRadius(sr: number, amount: number, o: Optics) {
  if (amount <= 0) return sr;
  let lo = 0;
  let hi = THETA_MAX;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const flat = o.focal * Math.tan(mid);
    const r = flat + (o.radius * Math.sin(mid / 2) - flat) * amount;
    if (r < sr) lo = mid;
    else hi = mid;
  }
  return o.focal * Math.tan((lo + hi) / 2);
}

/** Point (px from the screen centre, y down) projected through the lens. */
export function projectPoint(x: number, y: number, amount: number, o: Optics): [number, number] {
  const r = Math.hypot(x, y);
  if (r < 1e-6 || amount <= 0) return [x, y];
  const k = projectRadius(r, amount, o) / r;
  return [x * k, y * k];
}

export function unprojectPoint(x: number, y: number, amount: number, o: Optics): [number, number] {
  const r = Math.hypot(x, y);
  if (r < 1e-6 || amount <= 0) return [x, y];
  const k = unprojectRadius(r, amount, o) / r;
  return [x * k, y * k];
}

/** Screen-space box of a flat rect after projection (like the reference's worldRectToScreen). */
export function projectRect(cx: number, cy: number, w: number, h: number, amount: number, o: Optics) {
  const [x, y] = projectPoint(cx, cy, amount, o);
  const [rx, ry] = projectPoint(cx + w / 2, cy, amount, o);
  const [lx, ly] = projectPoint(cx - w / 2, cy, amount, o);
  const [bx, by] = projectPoint(cx, cy + h / 2, amount, o);
  const [tx, ty] = projectPoint(cx, cy - h / 2, amount, o);
  return { x, y, w: Math.hypot(rx - lx, ry - ly), h: Math.hypot(bx - tx, by - ty) };
}

/** Is a flat rect (centre-relative) close enough to the centre to be visible through the lens? */
export function rectInView(cx: number, cy: number, w: number, h: number, W: number, H: number, amount: number, o: Optics) {
  // The projection is radial and monotonic, so testing the rect's point nearest the centre is enough.
  const dx = Math.max(0, Math.abs(cx) - w / 2);
  const dy = Math.max(0, Math.abs(cy) - h / 2);
  const [sx, sy] = projectPoint(dx, dy, amount, o);
  return sx < W / 2 + 2 && sy < H / 2 + 2;
}

export type LensTile = {
  img: HTMLImageElement;
  /** Flat centre, px from the screen centre (y down), and flat size. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  opacity: number;
  /** 0 = greyscale, 1 = full colour */
  colour: number;
  /** Image layer inside the tile, as in the DOM: translate (fraction of tile) then scale. */
  mediaX: number;
  mediaY: number;
  mediaScale: number;
};

const VERT = `
attribute vec2 aUv;
uniform vec2 uRes;
uniform vec4 uRect;
uniform float uAmount;
uniform float uFocal;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 p = uRect.xy + (aUv - 0.5) * uRect.zw;
  float r = length(p);
  if (uAmount > 0.0 && r > 1e-4) {
    float theta = atan(r / uFocal);
    float sr = mix(r, uRadius * sin(theta * 0.5), uAmount);
    p *= sr / r;
  }
  vUv = aUv;
  vec2 clip = p / (uRes * 0.5);
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uCover;
uniform vec3 uMedia;
uniform float uColour;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 m = (vUv - 0.5 - uMedia.xy) / uMedia.z + 0.5;
  vec2 uv = 0.5 + (m - 0.5) * uCover;
  vec4 c = texture2D(uTex, uv);
  // Same weights as CSS grayscale(1), so the swap from the DOM tiles is invisible.
  float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 rgb = mix(vec3(g), c.rgb, uColour);
  gl_FragColor = vec4(rgb * uOpacity, uOpacity);
}
`;

type Tex = { tex: WebGLTexture; w: number; h: number; used: number };
const MAX_TEXTURES = 48;

/** Draws tiles through the lens into a transparent canvas laid over the DOM stage. */
export class LensRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private indexCount: number;
  private textures = new Map<string, Tex>();
  private frame = 0;
  private W = 1;
  private H = 1;
  private u: Record<string, WebGLUniformLocation | null> = {};

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return null;
    try {
      return new LensRenderer(canvas, gl);
    } catch (err) {
      console.warn("Fisheye unavailable:", err);
      return null;
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    this.program = program;
    gl.useProgram(program);
    for (const name of ["uRes", "uRect", "uAmount", "uFocal", "uRadius", "uTex", "uCover", "uMedia", "uColour", "uOpacity"]) {
      this.u[name] = gl.getUniformLocation(program, name);
    }

    // One subdivided unit quad, shared by every tile.
    const verts: number[] = [];
    for (let j = 0; j <= MESH; j++) for (let i = 0; i <= MESH; i++) verts.push(i / MESH, j / MESH);
    const idx: number[] = [];
    for (let j = 0; j < MESH; j++) {
      for (let i = 0; i < MESH; i++) {
        const a = j * (MESH + 1) + i;
        const b = a + 1;
        const c = a + MESH + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.indexCount = idx.length;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.uniform1i(this.u.uTex, 0);
  }

  setSize(W: number, H: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = W;
    this.H = H;
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  private texture(img: HTMLImageElement): Tex | null {
    if (!img.complete || !img.naturalWidth) return null;
    const key = img.currentSrc || img.src;
    let t = this.textures.get(key);
    if (!t) {
      const gl = this.gl;
      const tex = gl.createTexture();
      if (!tex) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, w: img.naturalWidth, h: img.naturalHeight, used: 0 };
      this.textures.set(key, t);
      this.evict();
    }
    t.used = this.frame;
    return t;
  }

  private evict() {
    if (this.textures.size <= MAX_TEXTURES) return;
    const oldest = [...this.textures.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, t] of oldest.slice(0, this.textures.size - MAX_TEXTURES)) {
      this.gl.deleteTexture(t.tex);
      this.textures.delete(key);
    }
  }

  /** Draw tiles in order (later on top). */
  draw(tiles: LensTile[], amount: number) {
    const gl = this.gl;
    this.frame++;
    const o = lensOptics(this.W, this.H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uRes, this.W, this.H);
    gl.uniform1f(this.u.uAmount, amount);
    gl.uniform1f(this.u.uFocal, o.focal);
    gl.uniform1f(this.u.uRadius, o.radius);
    gl.activeTexture(gl.TEXTURE0);
    for (const t of tiles) {
      if (t.opacity <= 0.002) continue;
      const tex = this.texture(t.img);
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      const tileAspect = t.w / t.h;
      const imgAspect = tex.w / tex.h;
      if (imgAspect > tileAspect) gl.uniform2f(this.u.uCover, tileAspect / imgAspect, 1);
      else gl.uniform2f(this.u.uCover, 1, imgAspect / tileAspect);
      gl.uniform4f(this.u.uRect, t.cx, t.cy, t.w, t.h);
      gl.uniform3f(this.u.uMedia, t.mediaX, t.mediaY, t.mediaScale);
      gl.uniform1f(this.u.uColour, t.colour);
      gl.uniform1f(this.u.uOpacity, t.opacity);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  clear() {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  dispose() {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    this.textures.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
