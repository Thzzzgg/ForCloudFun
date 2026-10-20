// WebGL2 小工具：建立 context、載入與編譯 shader、紋理、framebuffer 與全螢幕繪製

// 需要顯示給使用者看的錯誤（例如瀏覽器不支援）
export class UserFacingError extends Error {}

export function createContext(canvas, { preserveDrawingBuffer = false } = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, // 抗鋸齒改由自己的 HDR 多重取樣緩衝處理
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer,
  });
  if (!gl) {
    throw new UserFacingError('您的瀏覽器不支援 WebGL2，請改用最新版的 Chrome、Edge、Firefox 或 Safari。');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new UserFacingError('您的裝置不支援浮點紋理渲染（EXT_color_buffer_float），無法執行 FFT 海洋模擬。');
  }
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.caps = {
    anisoExt: aniso,
    maxAnisotropy: aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0,
    renderer: rendererName(gl),
  };
  return gl;
}

// 顯示卡名稱：Chrome 與 Safari 的 RENDERER 只回傳通用字串，要透過除錯擴充取得實際型號
// （Firefox 的 RENDERER 本身就是型號，而且對這個擴充會發出棄用警告，所以不呼叫）
function rendererName(gl) {
  const renderer = gl.getParameter(gl.RENDERER);
  if (renderer !== 'WebKit WebGL') return renderer;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : renderer;
}

// 讀入所有 shader 原始碼，並展開 #include "檔名"
export async function loadShaderSources(baseUrl, names) {
  const raw = {};
  await Promise.all(names.map(async (name) => {
    const response = await fetch(new URL(name, baseUrl));
    if (!response.ok) throw new Error(`無法載入 shader：${name}（HTTP ${response.status}）`);
    raw[name] = await response.text();
  }));
  const resolveIncludes = (source) => source.replace(/^#include\s+"([^"]+)"\s*$/gm, (_, file) => {
    if (!(file in raw)) throw new Error(`找不到 include 檔案：${file}`);
    return raw[file];
  });
  const sources = {};
  for (const name of names) sources[name] = resolveIncludes(raw[name]);
  return sources;
}

function compileShader(gl, type, source, name) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    const numbered = source.split('\n').map((line, i) => `${String(i + 1).padStart(4)}: ${line}`).join('\n');
    gl.deleteShader(shader);
    throw new Error(`Shader 編譯失敗（${name}）：\n${log}\n${numbered}`);
  }
  return shader;
}

export class Program {
  constructor(gl, vertexSource, fragmentSource, name) {
    this.gl = gl;
    this.name = name;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${name}（vertex）`);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${name}（fragment）`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader 連結失敗（${name}）：${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.uniforms = new Map();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      this.uniforms.set(info.name.replace(/\[0\]$/, ''), {
        location: gl.getUniformLocation(program, info.name),
        type: info.type,
      });
    }
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  // 依 uniform 型別自動選用對應的 gl.uniform* 函式；被編譯器最佳化掉的 uniform 直接略過
  set(name, value) {
    const uniform = this.uniforms.get(name);
    if (!uniform) return this;
    const { gl } = this;
    const loc = uniform.location;
    switch (uniform.type) {
      case gl.FLOAT: gl.uniform1f(loc, value); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(loc, value); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(loc, value); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(loc, value); break;
      case gl.INT:
      case gl.BOOL:
      case gl.SAMPLER_2D: gl.uniform1i(loc, value); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, value); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, value); break;
      default: throw new Error(`不支援的 uniform 型別：${name}`);
    }
    return this;
  }

  tex(name, texture, unit) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture ?? texture);
    return this.set(name, unit);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

const WRAP = { repeat: 'REPEAT', clamp: 'CLAMP_TO_EDGE' };

export function createTexture(gl, {
  width, height, internalFormat, filter = 'linear', wrap = 'clamp', wrapS, wrapT, mipmaps = false, anisotropy = false,
}) {
  const levels = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
  const linear = filter === 'linear';
  const minFilter = linear ? (mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR) : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl[WRAP[wrapS ?? wrap]]);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl[WRAP[wrapT ?? wrap]]);
  if (anisotropy && gl.caps.anisoExt && gl.caps.maxAnisotropy > 1) {
    gl.texParameterf(gl.TEXTURE_2D, gl.caps.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, gl.caps.maxAnisotropy);
  }
  return { texture, width, height, levels };
}

export function generateMipmaps(gl, texture) {
  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.generateMipmap(gl.TEXTURE_2D);
}

export function createFramebuffer(gl, colors, depthRenderbuffer = null) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  colors.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.texture, 0);
  });
  if (depthRenderbuffer) {
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderbuffer);
  }
  gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer 不完整（0x${status.toString(16)}）`);
  }
  return { fbo, width: colors[0].width, height: colors[0].height };
}

export function deleteTextures(gl, textures) {
  for (const t of textures) gl.deleteTexture(t.texture);
}

// 全螢幕三角形：頂點位置由 gl_VertexID 產生，不需要頂點緩衝
const emptyVaos = new WeakMap();
export function drawFullscreen(gl) {
  let vao = emptyVaos.get(gl);
  if (!vao) {
    vao = gl.createVertexArray();
    emptyVaos.set(gl, vao);
  }
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
